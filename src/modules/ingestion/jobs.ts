import { fetchCeipalApplicants, mapCeipalApplicantToCandidate, getCeipalCreatedOn } from '../ats';
import { ensureProvidersInitialized, getProviderRegistry } from '../providers';
import { getSharedGraphClient } from '../providers/graph';
import type { ProviderCallResult } from '../providers/types';
import { MicrosoftGraphEmailParser } from '../email';
import { getSupabaseAdminClient, isSupabaseConfigured } from '../persistence';
import { extractCandidateFromDocument } from '../../features/candidate-management/application/candidate-extraction';
import { deduceRoles } from '../../features/candidate-management/application/role-deduction';
import { recordSyncFailure, createSyncRun, completeSyncRun, failSyncRun, upsertCandidateFromEmailFull, batchUpsertCandidatesFromATS, DEFAULT_TENANT_ID, mapToCandidateRow } from './index';
import { fetchWithRetry } from './fetch-with-retry';
import {
  computeFileHash,
  isAlreadyProcessed,
  checkExistingFingerprints,
  loadRecentFingerprints,
  recordFingerprint,
  recordFingerprintBatch,
} from '../../features/candidate-management/infrastructure/fingerprint-repository';
import {
  getLastCandidateUpdateBySource,
} from '../../features/candidate-management/infrastructure/candidate-repository';
import {
  uploadFileToStorage,
} from '../../features/candidate-management/infrastructure/storage';
import {
  createImportBatch,
  updateImportBatch,
  processImportChunk,
} from '../../features/candidate-management/infrastructure/import-batch-repository';

export interface SchedulerJob {
  name: string;
  run(): Promise<void>;
}

/**
 * Graph provider gate for ingestion jobs. Returns `'available'` when the
 * provider is registered and in `'normal'` or `'degraded'` mode;
 * `'kill_switched'` when explicitly disabled; `'unavailable'` when the
 * provider wasn't registered at all (init failed or env missing).
 *
 * Review patch B7/E4: the pre-patch check only compared against
 * `'kill_switched'`, so a `null` mode (unregistered) fell through and
 * downstream `requireGraph()` threw, producing a dirty `failSyncRun`
 * instead of a clean skip.
 */
function assessGraphAvailability(): 'available' | 'kill_switched' | 'unavailable' {
  const mode = getProviderRegistry().getMode('graph');
  if (mode === null) return 'unavailable';
  if (mode === 'kill_switched') return 'kill_switched';
  return 'available';
}

export type SchedulerRegistration = {
  jobKey: string;
  scheduleName: string;
  cronExpression: string;
  enabled?: boolean;
  tenantId?: string; // P2: explicit tenant scoping; falls back to DEFAULT_TENANT_ID when absent
  policyFamily?: string;
  policyKey?: string;
};

export class EmailIngestionJob implements SchedulerJob {
  name = 'EmailIngestionJob';
  private parser = new MicrosoftGraphEmailParser();
  private get inboxAddresses(): string[] {
    const env = process.env.CBL_SUBMISSION_INBOXES;
    if (env) return env.split(',').map((s) => s.trim()).filter(Boolean);
    return ['submissions-inbox@cblsolutions.com'];
  }

  async run() {
    const runId = await createSyncRun('email');
    try {
      // Graph is registered by `ensureProvidersInitialized` — wiring its health
      // hooks and kill-switch restore. The email parser fails fast if the Graph
      // client isn't built (no env), so the init has to run first.
      try {
        await ensureProvidersInitialized();
      } catch (initErr) {
        console.error(
          '[EmailIngestionJob] ensureProvidersInitialized failed (non-fatal):',
          initErr instanceof Error ? initErr.message : initErr,
        );
      }

      const graphStatus = assessGraphAvailability();
      if (graphStatus !== 'available') {
        const reason = graphStatus === 'kill_switched'
          ? 'graph provider kill_switched'
          : 'graph provider unregistered (init failed or Entra env missing)';
        console.warn(`[EmailIngestionJob] Skipping run — ${reason}`);
        await completeSyncRun(runId, { succeeded: 0, failed: 0, total: 0 });
        return;
      }

      // Fingerprint gate: safety net for any emails that slip past the isRead filter
      const processedIds = await loadRecentFingerprints(DEFAULT_TENANT_ID, 'email_message_id', 3650);

      // Stream-process: each email is parsed → persisted → marked read one at a time.
      // This avoids OOM from holding 500 emails+attachments in memory.
      const { processed, skipped, failed } = await this.parser.processInbox(
        this.inboxAddresses,
        processedIds,
        async (record) => {
          const result = await upsertCandidateFromEmailFull(record);
          await recordFingerprint({ tenantId: DEFAULT_TENANT_ID, type: 'email_message_id', hash: record.id, source: 'email' });

          // Record file_sha256 for each attachment so OneDrive ingestion
          // can skip the same PDF without paying for LLM extraction again.
          for (const att of record.attachments ?? []) {
            if (att.content?.length) {
              const fileHash = computeFileHash(att.content);
              await recordFingerprint({ tenantId: DEFAULT_TENANT_ID, type: 'file_sha256', hash: fileHash, source: 'email' }).catch(() => {});
            }
          }

          if (result === 'dedup_skip') {
            console.log(`[EmailIngestionJob] Dedup skip for ${record.subject}`);
          }
        },
      );

      console.log(`[EmailIngestionJob] Complete: ${processed} processed, ${skipped} skipped, ${failed} failed`);
      await completeSyncRun(runId, { succeeded: processed, failed, total: processed + skipped + failed });
    } catch (err) {
      recordSyncFailure('email', 'polling', err, runId);
      await failSyncRun(runId, err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
  }
}

/**
 * Ceipal ATS ingestion — polls all applicants (or incremental since last run).
 * Set CEIPAL_API_KEY, CEIPAL_USERNAME, CEIPAL_PASSWORD, CEIPAL_ENDPOINT_KEY in Render.
 */
export class CeipalIngestionJob implements SchedulerJob {
  name = 'CeipalIngestionJob';

  async run(params?: { startPage?: number; maxPages?: number; since?: Date }) {
    const runId = await createSyncRun('ceipal');
    try {
      // Lazy provider init — idempotent. Wires Ceipal into the registry and
      // attaches PostgresHealthEventStore before the first outbound call.
      try {
        await ensureProvidersInitialized();
      } catch (initErr) {
        console.error(
          '[CeipalIngestionJob] ensureProvidersInitialized failed (non-fatal):',
          initErr instanceof Error ? initErr.message : initErr,
        );
      }

      // Review patch H-4: honor the kill-switch mode restored from
      // provider_routing_policies. Previously the restored `mode` was
      // observability-only — this check makes architecture.md §19 real by
      // refusing outbound traffic when an operator (or auto-trigger) has
      // flipped Ceipal to kill_switched.
      const ceipalMode = getProviderRegistry().getMode('ceipal');
      if (ceipalMode === 'kill_switched') {
        const reason = 'provider_routing_policies.mode=kill_switched';
        console.warn(`[CeipalIngestionJob] Skipping run — ${reason}`);
        await completeSyncRun(runId, { succeeded: 0, failed: 0, total: 0 });
        return;
      }

      const startPage = params?.startPage ?? 1;
      const maxPages = params?.maxPages ?? 50;

      let since = params?.since;
      if (!since && !(params?.startPage && params.startPage > 1)) {
        try {
          since = await getLastCandidateUpdateBySource('ceipal');
        } catch (err) {
          console.warn('[CeipalIngestionJob] Could not load last sync timestamp, performing full fetch:', err instanceof Error ? err.message : err);
        }
      }

      // Page-by-page fetch with per-page fingerprint check and early exit
      const PAGE_SIZE = 50;
      let page = startPage;
      const endPage = startPage + maxPages - 1;
      let consecutiveSkippedPages = 0;
      let totalFetched = 0;
      let totalNew = 0;
      let totalInserted = 0;
      let totalFailed = 0;

      while (page <= endPage) {
        const applicants = await fetchCeipalApplicants({ startPage: page, maxPages: 1, since });
        if (applicants.length === 0) break;
        totalFetched += applicants.length;

        const candidates = applicants.map(mapCeipalApplicantToCandidate);

        // Targeted fingerprint check for this page only
        const pageHashes = candidates
          .map((c) => {
            const id = (c as Record<string, unknown>).ceipalId as string | undefined;
            return id ? `ceipal:${id}` : null;
          })
          .filter((h): h is string => h !== null);

        // Review patch M-7: Ceipal fingerprints are now namespaced under
        // `ceipal_applicant_id`. Existing rows were backfilled by the
        // 2026-04-17 hardening migration.
        const existing = await checkExistingFingerprints(DEFAULT_TENANT_ID, 'ceipal_applicant_id', pageHashes);

        const newCandidates = candidates.filter((c) => {
          const ceipalId = (c as Record<string, unknown>).ceipalId as string | undefined;
          if (!ceipalId) return true;
          return !existing.has(`ceipal:${ceipalId}`);
        });

        if (newCandidates.length === 0) {
          consecutiveSkippedPages++;
          if (consecutiveSkippedPages >= 3) {
            console.log(`[CeipalIngestionJob] 3 consecutive pages with 0 new records — stopping at page ${page}`);
            break;
          }
        } else {
          consecutiveSkippedPages = 0;
          totalNew += newCandidates.length;

          const { inserted, failed } = await batchUpsertCandidatesFromATS(newCandidates);
          totalInserted += inserted;
          totalFailed += failed;

          // Record fingerprints for newly processed candidates
          const fpEntries = newCandidates
            .filter((c) => (c as Record<string, unknown>).ceipalId)
            .map((c) => ({
              tenantId: DEFAULT_TENANT_ID,
              type: 'ceipal_applicant_id' as const,
              hash: `ceipal:${(c as Record<string, unknown>).ceipalId}`,
              source: 'ceipal' as const,
            }));
          if (fpEntries.length > 0) {
            try {
              await recordFingerprintBatch(fpEntries);
            } catch (fpErr) {
              console.error('[CeipalIngestionJob] Fingerprint batch recording failed:', fpErr instanceof Error ? fpErr.message : fpErr);
              recordSyncFailure('ceipal', 'fingerprint-batch', fpErr, runId);
            }
          }
        }

        // Stop if partial page (last page of results)
        if (applicants.length < PAGE_SIZE) break;
        page++;
      }

      console.log(`[CeipalIngestionJob] Done: ${totalNew} new of ${totalFetched} fetched (${page - startPage + 1} pages scanned), ${totalInserted} upserted, ${totalFailed} failed`);
      await completeSyncRun(runId, { succeeded: totalInserted, failed: totalFailed, total: totalFetched });
    } catch (err) {
      recordSyncFailure('ceipal', 'polling', err, runId);
      await failSyncRun(runId, err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
  }
}

/**
 * OneDrive resume poller — checks a configured OneDrive folder for new PDF files,
 * downloads them, extracts candidate data via LLM, and persists to the database.
 *
 * Env vars:
 *   CBL_ONEDRIVE_USER — mailbox/UPN owning the drive (default: vivek@cblsolutions.com)
 *   CBL_ONEDRIVE_RESUME_PATH — folder path relative to drive root (default: CBLAeroCons/Resumes)
 *
 * Uses the same Azure app registration as email ingestion (CBL_SSO_* credentials).
 * Requires Files.ReadWrite.All application permission in Azure AD.
 *
 * Dedup: files are deleted from OneDrive after successful processing.
 * Supabase Storage is the source of truth — the PDF is stored there before deletion.
 * OneDrive folder acts as an inbox: any file present = unprocessed.
 */
export class OneDriveResumePollerJob implements SchedulerJob {
  name = 'OneDriveResumePollerJob';

  private get driveUser(): string {
    return process.env.CBL_ONEDRIVE_USER?.trim() || 'vivek@cblsolutions.com';
  }

  private get folderPath(): string {
    return process.env.CBL_ONEDRIVE_RESUME_PATH?.trim() || 'CBLAeroCons/Resumes';
  }

  /** Skip files whose names strongly indicate non-resume content (job descriptions, payrates, etc.) */
  private static NON_RESUME_PATTERNS = [
    /\bJD\b/i, /\bjob.?desc/i, /\bjob.?post/i, /\bjob.?listing/i,
    /\bpayrate/i, /\bpay.?rate/i, /\bsalary/i, /\bcompensation/i,
    /\bcontract.?rate/i, /\brate.?sheet/i, /\brate.?card/i,
    /\binvoice/i, /\bpurchase.?order/i, /\bPO\b/,
    /\bpolicy/i, /\bprocedure/i, /\bhandbook/i, /\bmanual/i,
    /\bnda\b/i, /\bagreement\b/i, /\bcontract\b/i,
    /\borg.?chart/i, /\bflyer/i, /\bbrochure/i,
    /\btemplate/i, /\bblank.?form/i,
  ];

  private isLikelyResume(filename: string): boolean {
    return !OneDriveResumePollerJob.NON_RESUME_PATTERNS.some((p) => p.test(filename));
  }

  async run() {
   const runId = await createSyncRun('onedrive');
   try {
    try {
      await ensureProvidersInitialized();
    } catch (initErr) {
      console.error(
        '[OneDrivePoller] ensureProvidersInitialized failed (non-fatal):',
        initErr instanceof Error ? initErr.message : initErr,
      );
    }

    const graphStatus = assessGraphAvailability();
    if (graphStatus !== 'available') {
      const reason = graphStatus === 'kill_switched'
        ? 'graph provider kill_switched'
        : 'graph provider unregistered (init failed or Entra env missing)';
      console.warn(`[OneDrivePoller] Skipping run — ${reason}`);
      await completeSyncRun(runId, { succeeded: 0, failed: 0, total: 0 });
      return;
    }

    const graph = getSharedGraphClient();
    if (!graph) {
      throw new Error('Graph client not configured — cannot poll OneDrive');
    }

    const allFiles = await this.listPdfFiles(graph);

    // Filter out non-resume files by filename before downloading
    const skippedNames: string[] = [];
    const files = allFiles.filter((f) => {
      if (this.isLikelyResume(f.name)) return true;
      skippedNames.push(f.name);
      return false;
    });
    if (skippedNames.length > 0) {
      console.log(`[OneDrivePoller] Skipped ${skippedNames.length} non-resume files: ${skippedNames.slice(0, 5).join(', ')}${skippedNames.length > 5 ? '...' : ''}`);
      // Delete skipped files from OneDrive — they're not resumes
      for (const name of skippedNames) {
        const file = allFiles.find((f) => f.name === name);
        if (file) await this.deleteFromOneDrive(graph, file.id, file.name);
      }
    }

    if (files.length === 0) {
      console.log('[OneDrivePoller] No PDF files found in folder');
      await completeSyncRun(runId, { succeeded: 0, failed: 0, total: 0 });
      return;
    }

    console.log(`[OneDrivePoller] ${files.length} PDF files to process`);

    let batchId: string | null = null;

    if (isSupabaseConfigured()) {
      try {
        const batch = await createImportBatch({
          tenantId: 'cbl-aero',
          source: 'resume_upload',
          status: 'processing',
          totalRows: files.length,
          createdByActorId: 'system:onedrive-poller',
        });
        batchId = batch.id;
      } catch (batchErr) {
        console.error('[OneDrivePoller] Failed to create import batch:', batchErr instanceof Error ? batchErr.message : batchErr);
      }
    }

    let imported = 0;
    let failed = 0;
    let skipped = 0;
    const PARALLEL_CHUNK = 10;

    for (let start = 0; start < files.length; start += PARALLEL_CHUNK) {
      const chunk = files.slice(start, start + PARALLEL_CHUNK);

      const chunkResults = await Promise.all(
        chunk.map(async (file) => {
          try {
            const buffer = await this.downloadFile(file.downloadUrl);

            // Fingerprint gate: skip LLM extraction if this exact file was already processed
            const fileHash = computeFileHash(buffer);
            if (await isAlreadyProcessed(DEFAULT_TENANT_ID, 'file_sha256', fileHash)) {
              console.log(JSON.stringify({ event: 'fingerprint_hit', type: 'file_sha256', source: 'onedrive', tenantId: DEFAULT_TENANT_ID, hash: fileHash.slice(0, 12) }));
              await this.deleteFromOneDrive(graph, file.id, file.name);
              return { status: 'skipped' as const, file };
            }

            // Store PDF in Supabase Storage (source of truth) before extraction
            const fileId = crypto.randomUUID().slice(0, 8);
            const storagePath = `resume-uploads/cbl-aero/${batchId ?? fileId}/${fileId}`;
            const storage = await uploadFileToStorage(buffer, file.name, storagePath);
            const storageUrl = storage.url;
            if (storage.warning) {
              console.warn(`[OneDrivePoller] ${file.name}: ${storage.warning}`);
            }

            const result = await extractCandidateFromDocument(buffer, 'pdf', {
              source: 'resume_upload',
              tenantId: 'cbl-aero',
              batchId: batchId ?? undefined,
            });

            if (result.error || !result.extraction) {
              console.warn(`[OneDrivePoller] Extraction failed for ${file.name}: ${result.error}`);
              await recordFingerprint({ tenantId: DEFAULT_TENANT_ID, type: 'file_sha256', hash: fileHash, source: 'onedrive', status: 'failed' });
              recordSyncFailure('onedrive', file.name, result.error ?? 'Extraction returned no data', runId);
              if (storageUrl) {
                await this.deleteFromOneDrive(graph, file.id, file.name);
              } else {
                console.warn(`[OneDrivePoller] Keeping ${file.name} in OneDrive — storage backup failed`);
              }
              return { status: 'failed' as const, file };
            }

            const ext = result.extraction;
            await recordFingerprint({ tenantId: DEFAULT_TENANT_ID, type: 'file_sha256', hash: fileHash, source: 'onedrive' });
            console.log(`[OneDrivePoller] Processed ${file.name} → ${ext.firstName} ${ext.lastName}`);

            if (storageUrl) {
              await this.deleteFromOneDrive(graph, file.id, file.name);
            } else {
              console.warn(`[OneDrivePoller] Keeping ${file.name} in OneDrive — no storage backup`);
            }

            return { status: 'ok' as const, file, extraction: ext, storageUrl };
          } catch (err) {
            recordSyncFailure('onedrive', file.name, err, runId);
            return { status: 'failed' as const, file, storageUrl: '' };
          }
        })
      );

      // Batch-persist successful extractions via single RPC call per chunk
      const successes = chunkResults.filter((r) => r.status === 'ok' && r.extraction);
      const chunkSkipped = chunkResults.filter((r) => r.status === 'skipped').length;
      const chunkFailed = chunkResults.filter((r) => r.status === 'failed').length;
      skipped += chunkSkipped;
      failed += chunkFailed;

      if (isSupabaseConfigured() && batchId && successes.length > 0) {
        const candidateRows = successes.map((r, i) => {
          const ext = r.extraction!;
          const baseRow = mapToCandidateRow({ ...ext }, 'resume_upload');
          return {
            ...baseRow,
            row_number: imported + i + 1,
            raw_data: ext,
            source_batch_id: batchId,
            resume_url: r.storageUrl || null,
          };
        });

        try {
          await processImportChunk({
            batchId,
            candidates: candidateRows,
            errorRows: [],
            totalImported: imported,
            totalSkipped: 0,
            totalErrors: failed,
          });
          imported += successes.length;
        } catch (rpcErr) {
          console.error(`[OneDrivePoller] RPC failed for chunk:`, rpcErr instanceof Error ? rpcErr.message : rpcErr);
          failed += successes.length;
        }
      } else {
        imported += successes.length;
      }

      console.log(`[OneDrivePoller] Chunk ${Math.floor(start / PARALLEL_CHUNK) + 1}: ${successes.length} ok, ${chunkFailed} failed`);
    }

    if (isSupabaseConfigured() && batchId) {
      await updateImportBatch(batchId, {
        status: 'complete',
        imported,
        errors: failed,
        completedAt: new Date().toISOString(),
      });
    }

    // Clean up empty subfolders after processing
    await this.deleteEmptySubfolders(graph);

    console.log(`[OneDrivePoller] Complete: ${imported} imported, ${skipped} skipped, ${failed} failed out of ${files.length} files`);
    await completeSyncRun(runId, { succeeded: imported + skipped, failed, total: files.length });
   } catch (err) {
    recordSyncFailure('onedrive', 'polling', err, runId);
    await failSyncRun(runId, err instanceof Error ? (err.stack ?? err.message) : String(err));
   }
  }

  /** Max files to process per cron invocation — 500 files × 10 parallel ≈ 3.3 min, under Render's 5-min timeout */
  private static MAX_FILES_PER_RUN = 500;
  /** Graph API page size */
  private static PAGE_SIZE = 200;

  private async listPdfFiles(graph: import('../providers/graph').GraphProviderClient): Promise<Array<{ id: string; name: string; size: number; downloadUrl: string }>> {
    type GraphItem = {
      id: string;
      name: string;
      size: number;
      file?: { mimeType: string };
      folder?: { childCount: number };
      '@microsoft.graph.downloadUrl'?: string;
    };

    const allPdfs: Array<{ id: string; name: string; size: number; downloadUrl: string }> = [];
    const user = encodeURIComponent(this.driveUser);

    // BFS queue of folder paths to scan (starts with the configured root folder)
    const folderQueue: string[] = [
      `/users/${user}/drive/root:/${this.folderPath}:/children?$top=${OneDriveResumePollerJob.PAGE_SIZE}`,
    ];

    while (folderQueue.length > 0 && allPdfs.length < OneDriveResumePollerJob.MAX_FILES_PER_RUN) {
      let nextPath: string | null = folderQueue.shift()!;

      // Paginate through all items in this folder
      type FolderPage = { value: GraphItem[]; '@odata.nextLink'?: string };
      while (nextPath && allPdfs.length < OneDriveResumePollerJob.MAX_FILES_PER_RUN) {
        const result: ProviderCallResult<FolderPage> = await graph.get<FolderPage>(nextPath);
        if (!result.ok) {
          console.warn(`[OneDrivePoller] Folder listing failed (${result.status}): ${result.error ?? ''}`);
          break;
        }
        const data: FolderPage | null = result.data;

        for (const item of data?.value ?? []) {
          // Queue subfolders for recursive scanning
          if (item.folder) {
            folderQueue.push(
              `/users/${user}/drive/items/${item.id}/children?$top=${OneDriveResumePollerJob.PAGE_SIZE}`
            );
            continue;
          }

          if (item.file && item.name.toLowerCase().endsWith('.pdf') && item['@microsoft.graph.downloadUrl']) {
            allPdfs.push({
              id: item.id,
              name: item.name,
              size: item.size,
              downloadUrl: item['@microsoft.graph.downloadUrl'],
            });
          }
        }

        // Empty-string nextLink would loop forever (review finding E6) —
        // treat it as end-of-pagination alongside null/undefined.
        const rawNext = data?.['@odata.nextLink'];
        nextPath = rawNext && rawNext.length > 0 ? rawNext : null;
      }
    }

    if (allPdfs.length >= OneDriveResumePollerJob.MAX_FILES_PER_RUN) {
      console.log(`[OneDrivePoller] ${allPdfs.length} PDFs found, capping to ${OneDriveResumePollerJob.MAX_FILES_PER_RUN} for this run`);
      return allPdfs.slice(0, OneDriveResumePollerJob.MAX_FILES_PER_RUN);
    }

    return allPdfs;
  }

  private async downloadFile(downloadUrl: string): Promise<Buffer> {
    const response = await fetchWithRetry(downloadUrl);
    if (!response.ok) {
      throw new Error(`File download failed (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async deleteFromOneDrive(graph: import('../providers/graph').GraphProviderClient, fileId: string, filename: string): Promise<void> {
    const user = encodeURIComponent(this.driveUser);
    const path = `/users/${user}/drive/items/${fileId}`;

    const result = await graph.delete(path);

    // Graph returns 204 No Content on success; BaseProviderClient surfaces
    // that as ok=true (any 2xx counts). Explicit 204 guard preserved for
    // parity with the legacy fetchWithRetry log line.
    if (result.ok || result.status === 204) {
      console.log(`[OneDrivePoller] Deleted ${filename} from OneDrive`);
    } else {
      console.warn(`[OneDrivePoller] Failed to delete ${filename} from OneDrive (${result.status})`);
    }
  }

  /**
   * Walk subfolders of the configured root and delete any that are empty.
   * Processes deepest folders first (reverse BFS) so parent folders become
   * empty after their children are removed.
   */
  private async deleteEmptySubfolders(graph: import('../providers/graph').GraphProviderClient): Promise<void> {
    const user = encodeURIComponent(this.driveUser);
    const rootPath = `/users/${user}/drive/root:/${this.folderPath}:/children?$top=${OneDriveResumePollerJob.PAGE_SIZE}`;

    type FolderEntry = { id: string; name: string };

    // BFS to collect all subfolder IDs (not the root itself)
    const folderQueue: string[] = [rootPath];
    const allSubfolders: FolderEntry[] = [];

    while (folderQueue.length > 0) {
      const nextPath = folderQueue.shift()!;
      const result = await graph.get<{
        value: Array<{ id: string; name: string; folder?: { childCount: number } }>;
        '@odata.nextLink'?: string;
      }>(nextPath);
      if (!result.ok) continue;
      const data = result.data;

      for (const item of data?.value ?? []) {
        if (item.folder) {
          allSubfolders.push({ id: item.id, name: item.name });
          folderQueue.push(
            `/users/${user}/drive/items/${item.id}/children?$top=${OneDriveResumePollerJob.PAGE_SIZE}`
          );
        }
      }

      const rawNext = data?.['@odata.nextLink'];
      if (rawNext && rawNext.length > 0) {
        folderQueue.push(rawNext);
      }
    }

    if (allSubfolders.length === 0) return;

    // Delete deepest first (reverse order since BFS goes top-down)
    for (const folder of allSubfolders.reverse()) {
      const checkResult = await graph.get<{ value: unknown[] }>(
        `/users/${user}/drive/items/${folder.id}/children?$top=1`,
      );
      if (!checkResult.ok) continue;
      if ((checkResult.data?.value ?? []).length > 0) continue;

      // Folder is empty — delete it
      const delResult = await graph.delete(`/users/${user}/drive/items/${folder.id}`);

      if (delResult.ok || delResult.status === 204) {
        console.log(`[OneDrivePoller] Deleted empty subfolder: ${folder.name}`);
      } else {
        console.warn(`[OneDrivePoller] Failed to delete subfolder ${folder.name} (${delResult.status})`);
      }
    }
  }
}

/**
 * OneDrive Word → PDF converter. Recruiters upload `.doc`/`.docx` resumes
 * alongside PDFs into the same OneDrive folder tree. This job runs ahead of
 * `OneDriveResumePollerJob` and asks Microsoft Graph for a PDF rendition of
 * each Word file.
 *
 * Output layout per recruiter folder (level 1 under `CBL_ONEDRIVE_RESUME_PATH`):
 *   <recruiter>/
 *     pdfs/                                ← all converted PDFs land here, flat
 *       Upload-6AprilA&P-johnresume.pdf    ← name encodes the original subpath
 *     converted/                           ← mirrors the original folder tree
 *       Upload/6 April A&P/john resume.docx
 *
 * - Spaces stripped from each path segment when building the flat PDF name; segments joined with `-`.
 * - Conversion delegated to Graph — no LibreOffice/Chromium on Render.
 * - Idempotent: a flat name already in `pdfs/` skips the conversion step (the original is still moved).
 * - Anything already inside `converted/` or `pdfs/` is excluded from input scanning so re-runs never reprocess output.
 *
 * The job avoids "expected" 404/409 probes against Graph so the provider's
 * shared error-rate gauge stays clean — folder existence is determined from
 * the folder listings we already paginate through.
 */
export class OneDriveWordToPdfJob implements SchedulerJob {
  name = 'OneDriveWordToPdfJob';

  private get driveUser(): string {
    return process.env.CBL_ONEDRIVE_USER?.trim() || 'vivek@cblsolutions.com';
  }

  private get folderPath(): string {
    return process.env.CBL_ONEDRIVE_RESUME_PATH?.trim() || 'CBLAeroCons/Resumes';
  }

  private static GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
  private static MAX_FILES_PER_RUN = 200;
  private static PAGE_SIZE = 200;
  private static PDFS_FOLDER_NAME = 'pdfs';
  private static CONVERTED_FOLDER_NAME = 'converted';
  /** Graph PDF rendition has practical limits around a few hundred MB; resume docs sit well under this. Skip oversized files for manual review. */
  private static MAX_DOC_BYTES = 50 * 1024 * 1024;

  async run() {
    const runId = await createSyncRun('onedrive-word-to-pdf');
    try {
      try {
        await ensureProvidersInitialized();
      } catch (initErr) {
        console.error(
          '[OneDriveWordToPdf] ensureProvidersInitialized failed (non-fatal):',
          initErr instanceof Error ? initErr.message : initErr,
        );
      }

      const graphStatus = assessGraphAvailability();
      if (graphStatus !== 'available') {
        const reason = graphStatus === 'kill_switched'
          ? 'graph provider kill_switched'
          : 'graph provider unregistered (init failed or Entra env missing)';
        console.warn(`[OneDriveWordToPdf] Skipping run — ${reason}`);
        await completeSyncRun(runId, { succeeded: 0, failed: 0, total: 0 });
        return;
      }

      const graph = getSharedGraphClient();
      if (!graph) throw new Error('Graph client not configured — cannot convert OneDrive docs');

      const rootId = await this.resolveRootId(graph);
      if (!rootId) {
        throw new Error(`Could not resolve root folder: ${this.folderPath}`);
      }

      const { files, recruiterChildren } = await this.scanInputTree(graph, rootId);
      if (files.length === 0) {
        console.log('[OneDriveWordToPdf] No Word files to convert');
        await completeSyncRun(runId, { succeeded: 0, failed: 0, total: 0 });
        return;
      }

      console.log(`[OneDriveWordToPdf] ${files.length} Word files to process`);

      // Per-recruiter context, lazily initialized when its first file is touched.
      // Holds: pdfs/ folder ID + names of PDFs already there (idempotency without 404 probes),
      //        converted/ folder ID + path→ID cache for the existing mirror tree.
      const recruiterCtx = new Map<string, RecruiterCtx>();

      let converted = 0;
      let alreadyHadPdf = 0;
      let failed = 0;

      for (const file of files) {
        try {
          if (file.size > OneDriveWordToPdfJob.MAX_DOC_BYTES) {
            console.warn(`[OneDriveWordToPdf] Skipping ${file.name} — exceeds ${OneDriveWordToPdfJob.MAX_DOC_BYTES} byte limit (${file.size})`);
            failed++;
            continue;
          }

          let ctx = recruiterCtx.get(file.recruiterFolderId);
          if (!ctx) {
            ctx = await this.initRecruiterCtx(graph, file.recruiterFolderId, recruiterChildren.get(file.recruiterFolderId) ?? []);
            recruiterCtx.set(file.recruiterFolderId, ctx);
          }

          const flatPdfName = computeFlatPdfName(file.relativePath, file.name);

          if (ctx.pdfsContents.has(flatPdfName.toLowerCase())) {
            alreadyHadPdf++;
            console.log(`[OneDriveWordToPdf] PDF already in pdfs/ for ${file.name} — moving original only`);
          } else {
            const pdfsId = await this.ensurePdfsFolder(graph, ctx);
            const pdfBuffer = await this.fetchPdfRendition(graph, file.id);
            await this.uploadFile(graph, pdfsId, flatPdfName, pdfBuffer, 'application/pdf');
            ctx.pdfsContents.add(flatPdfName.toLowerCase());
            converted++;
            console.log(`[OneDriveWordToPdf] Converted ${file.name} → pdfs/${flatPdfName}`);
          }

          const targetParentId = await this.ensureConvertedPath(graph, ctx, file.relativePath);
          await this.moveItem(graph, file.id, targetParentId, file.name);
        } catch (err) {
          failed++;
          console.error(`[OneDriveWordToPdf] Failed for ${file.name}:`, err instanceof Error ? err.message : err);
          recordSyncFailure('onedrive-word-to-pdf', file.name, err, runId);
        }
      }

      console.log(`[OneDriveWordToPdf] Complete: ${converted} converted, ${alreadyHadPdf} already had PDF, ${failed} failed of ${files.length}`);
      await completeSyncRun(runId, { succeeded: converted + alreadyHadPdf, failed, total: files.length });
    } catch (err) {
      recordSyncFailure('onedrive-word-to-pdf', 'job', err, runId);
      await failSyncRun(runId, err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
  }

  private async resolveRootId(graph: import('../providers/graph').GraphProviderClient): Promise<string | null> {
    const user = encodeURIComponent(this.driveUser);
    const result = await graph.get<{ id: string }>(`/users/${user}/drive/root:/${this.folderPath}`);
    if (!result.ok || !result.data?.id) {
      console.warn(`[OneDriveWordToPdf] Root folder lookup failed (${result.status}): ${result.error ?? ''}`);
      return null;
    }
    return result.data.id;
  }

  /**
   * BFS the configured root and return:
   *   - `files`: every `.doc`/`.docx` paired with its containing folder ID,
   *     its recruiter folder ID (immediate child of root), and the relative
   *     path (segments) from the recruiter down to the file's parent.
   *   - `recruiterChildren`: map of recruiter folder ID → list of its
   *     immediate children. Used to discover existing `pdfs/`/`converted/`
   *     folders without a separate path-lookup probe.
   *
   * Files at the root level (no recruiter) fall back to the root ID. The
   * BFS skips the `pdfs/` and `converted/` output folders entirely so a
   * re-run never reprocesses its own output.
   */
  private async scanInputTree(
    graph: import('../providers/graph').GraphProviderClient,
    rootId: string,
  ): Promise<{
    files: Array<{ id: string; name: string; size: number; parentId: string; recruiterFolderId: string; relativePath: string[] }>;
    recruiterChildren: Map<string, ChildItem[]>;
  }> {
    type GraphItem = { id: string; name: string; size: number; file?: { mimeType: string }; folder?: { childCount: number } };
    type FolderPage = { value: GraphItem[]; '@odata.nextLink'?: string };
    type QueueEntry = { url: string; folderId: string; recruiterFolderId: string; relativePath: string[]; isRoot: boolean };

    const user = encodeURIComponent(this.driveUser);
    const out: Array<{ id: string; name: string; size: number; parentId: string; recruiterFolderId: string; relativePath: string[] }> = [];
    const recruiterChildren = new Map<string, ChildItem[]>();

    const queue: QueueEntry[] = [
      {
        url: `/users/${user}/drive/items/${rootId}/children?$top=${OneDriveWordToPdfJob.PAGE_SIZE}`,
        folderId: rootId,
        recruiterFolderId: rootId,
        relativePath: [],
        isRoot: true,
      },
    ];

    // Root falls back to itself when files sit at the very top level.
    recruiterChildren.set(rootId, []);

    while (queue.length > 0 && out.length < OneDriveWordToPdfJob.MAX_FILES_PER_RUN) {
      const entry = queue.shift()!;
      let nextUrl: string | null = entry.url;

      while (nextUrl && out.length < OneDriveWordToPdfJob.MAX_FILES_PER_RUN) {
        const result: ProviderCallResult<FolderPage> = await graph.get<FolderPage>(nextUrl);
        if (!result.ok) {
          console.warn(`[OneDriveWordToPdf] Folder listing failed (${result.status}): ${result.error ?? ''}`);
          break;
        }

        for (const item of result.data?.value ?? []) {
          // When listing a recruiter folder, capture its top-level children
          // so we can discover existing pdfs/ and converted/ without probing.
          if (entry.folderId === entry.recruiterFolderId && !entry.isRoot) {
            const list = recruiterChildren.get(entry.recruiterFolderId) ?? [];
            list.push({ id: item.id, name: item.name, isFolder: !!item.folder });
            recruiterChildren.set(entry.recruiterFolderId, list);
          }

          if (item.folder) {
            const lower = item.name.toLowerCase();
            // Skip our own output folders so re-runs are safe.
            if (lower === OneDriveWordToPdfJob.CONVERTED_FOLDER_NAME) continue;
            if (lower === OneDriveWordToPdfJob.PDFS_FOLDER_NAME) continue;

            const isFirstLevel = entry.isRoot;
            const recruiterFolderId = isFirstLevel ? item.id : entry.recruiterFolderId;
            const childRelativePath = isFirstLevel ? [] : [...entry.relativePath, item.name];

            if (isFirstLevel) recruiterChildren.set(item.id, []);

            queue.push({
              url: `/users/${user}/drive/items/${item.id}/children?$top=${OneDriveWordToPdfJob.PAGE_SIZE}`,
              folderId: item.id,
              recruiterFolderId,
              relativePath: childRelativePath,
              isRoot: false,
            });
            continue;
          }

          if (item.file && /\.docx?$/i.test(item.name)) {
            out.push({
              id: item.id,
              name: item.name,
              size: item.size,
              parentId: entry.folderId,
              recruiterFolderId: entry.recruiterFolderId,
              relativePath: entry.relativePath,
            });
          }
        }

        const rawNext = result.data?.['@odata.nextLink'];
        nextUrl = rawNext && rawNext.length > 0 ? rawNext : null;
      }
    }

    if (out.length >= OneDriveWordToPdfJob.MAX_FILES_PER_RUN) {
      console.log(`[OneDriveWordToPdf] Capping at ${OneDriveWordToPdfJob.MAX_FILES_PER_RUN} files for this run`);
    }
    return { files: out, recruiterChildren };
  }

  /**
   * Build the per-recruiter context: discover existing pdfs/ + converted/
   * folder IDs from the captured child listing, list pdfs/ contents (so
   * idempotency checks happen in-memory), and walk any existing converted/
   * subtree to populate the path→ID cache.
   *
   * All API calls here return 200; nothing trips the provider error rate.
   */
  private async initRecruiterCtx(
    graph: import('../providers/graph').GraphProviderClient,
    recruiterFolderId: string,
    children: ChildItem[],
  ): Promise<RecruiterCtx> {
    const pdfsChild = children.find((c) => c.isFolder && c.name.toLowerCase() === OneDriveWordToPdfJob.PDFS_FOLDER_NAME);
    const convertedChild = children.find((c) => c.isFolder && c.name.toLowerCase() === OneDriveWordToPdfJob.CONVERTED_FOLDER_NAME);

    const pdfsContents = new Set<string>();
    if (pdfsChild) {
      const names = await this.listFolderItemNames(graph, pdfsChild.id);
      for (const n of names) pdfsContents.add(n.toLowerCase());
    }

    const convertedPathCache = new Map<string, string>();
    if (convertedChild) {
      convertedPathCache.set('', convertedChild.id);
      await this.walkConvertedTree(graph, convertedChild.id, [], convertedPathCache);
    }

    return {
      recruiterFolderId,
      pdfsId: pdfsChild?.id,
      pdfsContents,
      convertedId: convertedChild?.id,
      convertedPathCache,
    };
  }

  /** List a folder's children's names. All-200 path; pagination handled. */
  private async listFolderItemNames(
    graph: import('../providers/graph').GraphProviderClient,
    folderId: string,
  ): Promise<string[]> {
    const user = encodeURIComponent(this.driveUser);
    type Page = { value: Array<{ name: string }>; '@odata.nextLink'?: string };
    let url: string | null = `/users/${user}/drive/items/${folderId}/children?$top=${OneDriveWordToPdfJob.PAGE_SIZE}&$select=name`;
    const out: string[] = [];
    while (url) {
      const result: ProviderCallResult<Page> = await graph.get<Page>(url);
      if (!result.ok) {
        console.warn(`[OneDriveWordToPdf] Listing children failed (${result.status}): ${result.error ?? ''}`);
        return out;
      }
      for (const item of result.data?.value ?? []) out.push(item.name);
      const next = result.data?.['@odata.nextLink'];
      url = next && next.length > 0 ? next : null;
    }
    return out;
  }

  /** Recursively walk an existing converted/ tree to populate the path cache. */
  private async walkConvertedTree(
    graph: import('../providers/graph').GraphProviderClient,
    folderId: string,
    pathSoFar: string[],
    cache: Map<string, string>,
  ): Promise<void> {
    const user = encodeURIComponent(this.driveUser);
    type Page = { value: Array<{ id: string; name: string; folder?: object }>; '@odata.nextLink'?: string };
    let url: string | null = `/users/${user}/drive/items/${folderId}/children?$top=${OneDriveWordToPdfJob.PAGE_SIZE}&$select=id,name,folder`;
    while (url) {
      const result: ProviderCallResult<Page> = await graph.get<Page>(url);
      if (!result.ok) return;
      for (const item of result.data?.value ?? []) {
        if (item.folder) {
          const childPath = [...pathSoFar, item.name];
          cache.set(childPath.join('/'), item.id);
          await this.walkConvertedTree(graph, item.id, childPath, cache);
        }
      }
      const next = result.data?.['@odata.nextLink'];
      url = next && next.length > 0 ? next : null;
    }
  }

  private async ensurePdfsFolder(
    graph: import('../providers/graph').GraphProviderClient,
    ctx: RecruiterCtx,
  ): Promise<string> {
    if (ctx.pdfsId) return ctx.pdfsId;
    const id = await this.createFolder(graph, ctx.recruiterFolderId, OneDriveWordToPdfJob.PDFS_FOLDER_NAME);
    ctx.pdfsId = id;
    return id;
  }

  /**
   * Walk the relative path under converted/, creating any missing segments.
   * Each create call hits a folder we *know* doesn't exist (cache miss),
   * so we never see 409.
   */
  private async ensureConvertedPath(
    graph: import('../providers/graph').GraphProviderClient,
    ctx: RecruiterCtx,
    relativePath: string[],
  ): Promise<string> {
    const cacheKey = relativePath.join('/');
    const cached = ctx.convertedPathCache.get(cacheKey);
    if (cached) return cached;

    if (!ctx.convertedId) {
      ctx.convertedId = await this.createFolder(graph, ctx.recruiterFolderId, OneDriveWordToPdfJob.CONVERTED_FOLDER_NAME);
      ctx.convertedPathCache.set('', ctx.convertedId);
    }

    let cur = ctx.convertedId;
    let curPath = '';
    for (const seg of relativePath) {
      curPath = curPath ? `${curPath}/${seg}` : seg;
      let segId = ctx.convertedPathCache.get(curPath);
      if (!segId) {
        segId = await this.createFolder(graph, cur, seg);
        ctx.convertedPathCache.set(curPath, segId);
      }
      cur = segId;
    }
    return cur;
  }

  private async createFolder(
    graph: import('../providers/graph').GraphProviderClient,
    parentId: string,
    name: string,
  ): Promise<string> {
    const user = encodeURIComponent(this.driveUser);
    const result = await graph.post<{ id: string }>(
      `/users/${user}/drive/items/${parentId}/children`,
      { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
    );
    if (result.ok && result.data?.id) return result.data.id;
    throw new Error(`Could not create folder ${name} under ${parentId} (${result.status}): ${result.error ?? ''}`);
  }

  /**
   * Fetch the PDF rendition of a Word doc. Graph returns a 302 to a
   * pre-signed download URL; `fetch()` follows the redirect transparently.
   * Bypasses `GraphProviderClient` because the response is binary.
   */
  private async fetchPdfRendition(
    graph: import('../providers/graph').GraphProviderClient,
    itemId: string,
  ): Promise<Buffer> {
    const user = encodeURIComponent(this.driveUser);
    const url = `${OneDriveWordToPdfJob.GRAPH_BASE}/users/${user}/drive/items/${itemId}/content?format=pdf`;
    const token = await graph.getAccessToken();
    const response = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`PDF rendition failed (${response.status}): ${await response.text().catch(() => '')}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /** Simple PUT upload (good for files up to ~250MB per Graph). PDFs from resumes sit far below this. */
  private async uploadFile(
    graph: import('../providers/graph').GraphProviderClient,
    parentId: string,
    name: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const user = encodeURIComponent(this.driveUser);
    const encodedName = encodeURIComponent(name);
    const url = `${OneDriveWordToPdfJob.GRAPH_BASE}/users/${user}/drive/items/${parentId}:/${encodedName}:/content`;
    const token = await graph.getAccessToken();
    const response = await fetchWithRetry(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      // Cast: Node fetch accepts Buffer but the DOM lib types don't list it.
      body: buffer as unknown as BodyInit,
    });
    if (!response.ok) {
      throw new Error(`Upload of ${name} failed (${response.status}): ${await response.text().catch(() => '')}`);
    }
  }

  private async moveItem(
    graph: import('../providers/graph').GraphProviderClient,
    itemId: string,
    newParentId: string,
    filename: string,
  ): Promise<void> {
    const user = encodeURIComponent(this.driveUser);
    const result = await graph.patch(`/users/${user}/drive/items/${itemId}`, {
      parentReference: { id: newParentId },
    });
    if (!result.ok) {
      throw new Error(`Move of ${filename} failed (${result.status}): ${result.error ?? ''}`);
    }
    console.log(`[OneDriveWordToPdf] Moved ${filename} → converted/`);
  }
}

type ChildItem = { id: string; name: string; isFolder: boolean };

type RecruiterCtx = {
  recruiterFolderId: string;
  pdfsId?: string;
  /** Lower-cased flat PDF basenames already present in pdfs/. */
  pdfsContents: Set<string>;
  convertedId?: string;
  /** Path (segments joined by '/') → folder ID for the existing converted/ tree. Empty key = the converted/ root itself. */
  convertedPathCache: Map<string, string>;
};

/**
 * Build the flat PDF name from the path segments + original filename.
 * Spaces stripped from each segment and from the basename; segments and
 * basename joined by `-`; `.pdf` extension always.
 *
 *   ([], 'john resume.docx')                   → 'johnresume.pdf'
 *   (['Upload', '6 April A&P'], 'jr.docx')     → 'Upload-6AprilA&P-jr.pdf'
 */
export function computeFlatPdfName(relativePath: string[], filename: string): string {
  const ext = filename.match(/\.docx?$/i)?.[0] ?? '';
  const baseNoExt = ext ? filename.slice(0, filename.length - ext.length) : filename;
  const parts = [...relativePath, baseNoExt].map((s) => s.replace(/\s+/g, ''));
  return `${parts.join('-')}.pdf`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class SavedSearchDigestJob implements SchedulerJob {
  name = 'SavedSearchDigestJob';

  async run() {
    const runId = await createSyncRun('saved_search_digest');
    let succeeded = 0;
    let failed = 0;
    try {
      const { listDigestEnabledSearches } = await import(
        '../../features/candidate-management/infrastructure/saved-search-repository'
      );
      const { listCandidates } = await import(
        '../../features/candidate-management/infrastructure/candidate-repository'
      );

      try {
        await ensureProvidersInitialized();
      } catch (initErr) {
        console.error(
          '[SavedSearchDigestJob] ensureProvidersInitialized failed (non-fatal):',
          initErr instanceof Error ? initErr.message : initErr,
        );
      }

      const graphStatus = assessGraphAvailability();
      if (graphStatus !== 'available') {
        const reason = graphStatus === 'kill_switched'
          ? 'graph provider kill_switched'
          : 'graph provider unregistered (init failed or Entra env missing)';
        console.warn(`[SavedSearchDigestJob] Skipping run — ${reason}`);
        await completeSyncRun(runId, { succeeded: 0, failed: 0, total: 0 });
        return;
      }

      const graph = getSharedGraphClient();
      if (!graph) {
        throw new Error('Graph client not configured — cannot send digest');
      }

      const MAX_DIGESTS_PER_RUN = 100;
      const INTER_SEND_DELAY_MS = 500;
      const allSearches = await listDigestEnabledSearches();
      const searches = allSearches.slice(0, MAX_DIGESTS_PER_RUN);
      if (allSearches.length > MAX_DIGESTS_PER_RUN) {
        console.warn(`[SavedSearchDigestJob] ${allSearches.length} digests enabled; processing first ${MAX_DIGESTS_PER_RUN}`);
      }
      console.log(`[SavedSearchDigestJob] Processing ${searches.length} digest-enabled saved searches`);

      for (const search of searches) {
        try {
          const params = {
            tenantId: search.tenantId,
            ...(search.filters as Record<string, string | boolean | undefined>),
            limit: 5,
          };

          const result = await listCandidates(params as Parameters<typeof listCandidates>[0]);
          if (result.items.length === 0) {
            console.log(`[SavedSearchDigestJob] No candidates for "${search.name}" — skipping email`);
            succeeded++;
            continue;
          }

          const rows = result.items.map((c, i) => {
            const skills = Array.isArray(c.skills)
              ? c.skills.slice(0, 3).map((s) => escapeHtml(typeof s === 'string' ? s : JSON.stringify(s))).join(', ')
              : '';
            const name = escapeHtml(`${c.firstName ?? ''} ${c.lastName ?? ''}`.trim());
            const title = escapeHtml(c.jobTitle ?? '—');
            const loc = escapeHtml(c.location ?? '—');
            const avail = escapeHtml(c.availabilityStatus);
            return `<tr>
              <td style="padding:6px;border:1px solid #e5e7eb">${i + 1}</td>
              <td style="padding:6px;border:1px solid #e5e7eb">${name}</td>
              <td style="padding:6px;border:1px solid #e5e7eb">${title}</td>
              <td style="padding:6px;border:1px solid #e5e7eb">${loc}</td>
              <td style="padding:6px;border:1px solid #e5e7eb">${avail}</td>
              <td style="padding:6px;border:1px solid #e5e7eb">${skills || '—'}</td>
            </tr>`;
          }).join('\n');

          const date = new Date().toISOString().slice(0, 10);
          const safeName = escapeHtml(search.name);
          const html = `
            <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
              <h2 style="color:#1f2937">CBL Aero Daily Digest: &quot;${safeName}&quot;</h2>
              <p style="color:#6b7280">Top ${result.items.length} candidates matching your saved search — ${date}</p>
              <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead><tr style="background:#f9fafb">
                  <th style="padding:6px;border:1px solid #e5e7eb;text-align:left">#</th>
                  <th style="padding:6px;border:1px solid #e5e7eb;text-align:left">Name</th>
                  <th style="padding:6px;border:1px solid #e5e7eb;text-align:left">Job Title</th>
                  <th style="padding:6px;border:1px solid #e5e7eb;text-align:left">Location</th>
                  <th style="padding:6px;border:1px solid #e5e7eb;text-align:left">Availability</th>
                  <th style="padding:6px;border:1px solid #e5e7eb;text-align:left">Skills</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
              <p style="margin-top:16px;color:#9ca3af;font-size:12px">— CBL Aero Recruiting Platform</p>
            </div>`;

          // Send email via Microsoft Graph — routes through the provider
          // framework (auth, retry on 5xx/429, structured logging, health).
          const senderAddress = process.env.CBL_DIGEST_SENDER ?? 'submissions-inbox@cblsolutions.com';
          const sendPath = `/users/${senderAddress}/sendMail`;
          const sendResult = await graph.post(sendPath, {
            message: {
              subject: `CBL Aero Daily Digest: "${search.name}" — ${date}`,
              body: { contentType: 'HTML', content: html },
              toRecipients: [{ emailAddress: { address: search.actorEmail } }],
            },
          });

          // Graph sendMail returns 202 Accepted on success (empty body).
          // BaseProviderClient treats any 2xx as ok — no special-case needed.
          if (!sendResult.ok) {
            throw new Error(`Graph sendMail failed (${sendResult.status}): ${sendResult.error ?? 'unknown error'}`);
          }

          console.log(`[SavedSearchDigestJob] Sent digest for "${search.name}" to ${search.actorEmail}`);
          succeeded++;
          // Throttle between sends to avoid Graph API rate limits
          await new Promise((r) => setTimeout(r, INTER_SEND_DELAY_MS));
        } catch (err) {
          console.error(`[SavedSearchDigestJob] Failed for search "${search.name}":`, err);
          failed++;
          recordSyncFailure('saved_search_digest', search.id, err, runId);
        }
      }
      await completeSyncRun(runId, { succeeded, failed, total: searches.length });
    } catch (err) {
      console.error('[SavedSearchDigestJob] Fatal error:', err);
      await failSyncRun(runId, err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
  }
}

// Story 2.5: Dedup worker — processes pending_dedup candidates
export class DedupWorkerJob implements SchedulerJob {
  name = 'DedupWorkerJob';

  async run(): Promise<void> {
    const { computeIdentityHash } = await import('../../features/candidate-management/infrastructure/fingerprint-repository');
    const { computeIdentityConfidence, routeDedupDecision } = await import('../../features/candidate-management/application/dedup-scoring');
    const { selectWinner, computeMergedFields, computeFieldDiffs } = await import('../../features/candidate-management/application/dedup-merge');
    const {
      listPendingDedupCandidates,
      findIdentityMatches,
      findRawFieldMatches,
      loadCandidateForDedup,
      callMergeCandidatesRpc,
      createReviewItem,
      recordDedupDecision,
      updateCandidateIngestionState,
    } = await import('../../features/candidate-management/infrastructure/dedup-repository');

    const runId = await createSyncRun('dedup');
    try {
      const candidates = await listPendingDedupCandidates(DEFAULT_TENANT_ID, 100);
      if (candidates.length === 0) {
        console.log('[DedupWorkerJob] No pending_dedup candidates');
        await completeSyncRun(runId, { succeeded: 0, failed: 0, total: 0 });
        return;
      }

      let autoMerged = 0, sentToReview = 0, keptSeparate = 0, errors = 0;

      for (const candidate of candidates) {
        try {
          // Compute identity hash for this candidate
          const identityHash = computeIdentityHash(
            candidate.email,
            candidate.firstName,
            candidate.lastName,
            candidate.phone,
          );

          let bestMatch: { matchedCandidate: import('../../features/candidate-management/contracts/dedup').CandidateForDedup; confidence: import('../../features/candidate-management/contracts/dedup').ConfidenceResult } | null = null;

          // Pass 1: Fingerprint hash lookup (fast — email exact or name+phone exact)
          if (identityHash) {
            const matchedIds = await findIdentityMatches(DEFAULT_TENANT_ID, identityHash, candidate.id);
            for (const matchId of matchedIds) {
              const matched = await loadCandidateForDedup(DEFAULT_TENANT_ID, matchId);
              if (!matched || matched.ingestionState === 'merged') continue;
              const confidence = computeIdentityConfidence(candidate, matched);
              if (!bestMatch || confidence.score > bestMatch.confidence.score) {
                bestMatch = { matchedCandidate: matched, confidence };
              }
            }
          }

          // Pass 2: Raw field query for phone/name matches (catches borderline cases)
          if (!bestMatch || bestMatch.confidence.score < 70) {
            const normalizedPhone = (candidate.phone ?? '').replace(/\D/g, '');
            const rawMatches = await findRawFieldMatches(
              DEFAULT_TENANT_ID,
              normalizedPhone,
              candidate.firstName ?? '',
              candidate.lastName ?? '',
              candidate.id,
            );
            for (const matched of rawMatches) {
              if (matched.ingestionState === 'merged') continue;
              const confidence = computeIdentityConfidence(candidate, matched);
              if (!bestMatch || confidence.score > bestMatch.confidence.score) {
                bestMatch = { matchedCandidate: matched, confidence };
              }
            }
          }

          // Route the decision
          if (!bestMatch || bestMatch.confidence.score === 0) {
            // No match — promote to active
            await updateCandidateIngestionState(candidate.id, 'active');
            // Record identity fingerprint for future matching
            if (identityHash) {
              await recordFingerprint({
                tenantId: DEFAULT_TENANT_ID,
                type: 'candidate_identity',
                hash: identityHash,
                source: 'dedup',
                candidateId: candidate.id,
              });
            }
            keptSeparate++;
            continue;
          }

          const route = routeDedupDecision(bestMatch.confidence.score);

          if (route === 'auto_merge') {
            const { winner, loser } = selectWinner(candidate, bestMatch.matchedCandidate);
            const mergedFields = computeMergedFields(winner, loser);
            await callMergeCandidatesRpc(winner.id, loser.id, mergedFields, {
              decision_type: 'auto_merge',
              confidence_score: bestMatch.confidence.score,
              rationale: bestMatch.confidence.rationale,
            });
            // Promote winner out of pending_dedup so it's not re-processed
            await updateCandidateIngestionState(winner.id, 'active');
            // H2 fix: record fingerprint for WINNER (merge RPC migrates loser's fingerprints to winner)
            if (identityHash) {
              await recordFingerprint({
                tenantId: DEFAULT_TENANT_ID,
                type: 'candidate_identity',
                hash: identityHash,
                source: 'dedup',
                candidateId: winner.id,
              }).catch(() => {});
            }
            autoMerged++;
          } else if (route === 'manual_review') {
            const fieldDiffs = computeFieldDiffs(candidate, bestMatch.matchedCandidate);
            await createReviewItem(
              DEFAULT_TENANT_ID,
              candidate.id,
              bestMatch.matchedCandidate.id,
              bestMatch.confidence.score,
              fieldDiffs,
            );
            await updateCandidateIngestionState(candidate.id, 'pending_review');
            // M4 fix: record audit for manual_review routing (AC5 requires every decision logged)
            await recordDedupDecision({
              tenantId: DEFAULT_TENANT_ID,
              candidateAId: candidate.id,
              candidateBId: bestMatch.matchedCandidate.id,
              decisionType: 'keep_separate', // routed to review, not yet merged
              confidenceScore: bestMatch.confidence.score,
              rationale: `Routed to manual review: ${bestMatch.confidence.rationale}`,
            });
            // Record fingerprint for candidate being processed
            if (identityHash) {
              await recordFingerprint({
                tenantId: DEFAULT_TENANT_ID,
                type: 'candidate_identity',
                hash: identityHash,
                source: 'dedup',
                candidateId: candidate.id,
              }).catch(() => {});
            }
            sentToReview++;
          } else {
            // keep_separate
            await updateCandidateIngestionState(candidate.id, 'active');
            await recordDedupDecision({
              tenantId: DEFAULT_TENANT_ID,
              candidateAId: candidate.id,
              candidateBId: bestMatch.matchedCandidate.id,
              decisionType: 'keep_separate',
              confidenceScore: bestMatch.confidence.score,
              rationale: bestMatch.confidence.rationale,
            });
            // Record fingerprint for candidate being processed
            if (identityHash) {
              await recordFingerprint({
                tenantId: DEFAULT_TENANT_ID,
                type: 'candidate_identity',
                hash: identityHash,
                source: 'dedup',
                candidateId: candidate.id,
              }).catch(() => {});
            }
            keptSeparate++;
          }
        } catch (err) {
          errors++;
          console.error(`[DedupWorkerJob] Error processing candidate ${candidate.id}:`, err instanceof Error ? err.message : err);
          recordSyncFailure('dedup', candidate.id, err, runId);
        }
      }

      console.log(JSON.stringify({
        level: 'info',
        module: 'DedupWorkerJob',
        action: 'batch_complete',
        processed: candidates.length,
        autoMerged,
        sentToReview,
        keptSeparate,
        errors,
      }));
      await completeSyncRun(runId, { succeeded: candidates.length - errors, failed: errors, total: candidates.length });
    } catch (err) {
      console.error('[DedupWorkerJob] Fatal error:', err);
      await failSyncRun(runId, err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
  }
}

export class RoleDeductionEnrichmentJob implements SchedulerJob {
  name = 'RoleDeductionEnrichmentJob';

  async run(): Promise<void> {
    if (!isSupabaseConfigured()) {
      console.log('[RoleDeductionEnrichmentJob] Supabase not configured — skipping');
      return;
    }

    const runId = await createSyncRun('role-enrichment');
    let processed = 0;
    let rolesAssigned = 0;
    let errors = 0;

    try {
      const db = getSupabaseAdminClient();
      const BATCH_SIZE = 100;
      const MAX_CONSECUTIVE_ERRORS = 10;
      let consecutiveErrors = 0;

      // H4 fix: Exclude candidates that already failed role deduction (have metadata with error)
      // Only pick up candidates with truly empty deduced_roles and active state
      const { data: candidates, error: fetchError } = await db
        .from('candidates')
        .select('id, tenant_id, job_title, skills, certifications, aircraft_experience, deduced_roles, role_deduction_metadata')
        .filter('deduced_roles', 'eq', '[]')
        .eq('ingestion_state', 'active')
        .or('role_deduction_metadata.eq.{},role_deduction_metadata->deducedAt.is.null')
        .limit(BATCH_SIZE);

      if (fetchError) {
        throw new Error(`Failed to fetch candidates: ${fetchError.message}`);
      }

      if (!candidates || candidates.length === 0) {
        console.log('[RoleDeductionEnrichmentJob] No candidates need role enrichment');
        await completeSyncRun(runId, { succeeded: 0, failed: 0, total: 0 });
        return;
      }

      console.log(`[RoleDeductionEnrichmentJob] Processing ${candidates.length} candidates`);

      for (const candidate of candidates) {
        try {
          const result = await deduceRoles(
            {
              jobTitle: candidate.job_title,
              skills: Array.isArray(candidate.skills) ? candidate.skills : [],
              certifications: Array.isArray(candidate.certifications) ? candidate.certifications : [],
              aircraftExperience: Array.isArray(candidate.aircraft_experience) ? candidate.aircraft_experience : [],
            },
            candidate.tenant_id,
          );

          // M8 fix: Use repository-style update (still direct DB for now, but with proper error handling)
          const { error: updateError } = await db
            .from('candidates')
            .update({
              deduced_roles: result.roles,
              role_deduction_metadata: result.metadata,
              updated_at: new Date().toISOString(),
            })
            .eq('id', candidate.id);

          if (updateError) {
            console.error(`[RoleDeductionEnrichmentJob] Update failed for ${candidate.id}:`, updateError.message);
            errors++;
            consecutiveErrors++;
            continue;
          }

          consecutiveErrors = 0;
          processed++;
          if (result.roles.length > 0) rolesAssigned++;
        } catch (err) {
          errors++;
          consecutiveErrors++;
          console.error(`[RoleDeductionEnrichmentJob] Error processing candidate ${candidate.id}:`, err instanceof Error ? err.message : err);
          recordSyncFailure('role-enrichment', candidate.id, err instanceof Error ? err : new Error(String(err)), runId ?? undefined);

          // H4 fix: Mark candidate with failed metadata so it's excluded from next batch
          try {
            await db.from('candidates').update({
              role_deduction_metadata: {
                source: 'llm',
                confidence: 0,
                rawJobTitle: candidate.job_title,
                rawSkills: [],
                deducedAt: new Date().toISOString(),
                error: err instanceof Error ? err.message : String(err),
              },
            }).eq('id', candidate.id);
          } catch { /* non-fatal metadata update */ }

          // H4 fix: circuit breaker — stop if too many consecutive failures
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.error(`[RoleDeductionEnrichmentJob] ${MAX_CONSECUTIVE_ERRORS} consecutive errors — halting batch`);
            break;
          }
        }
      }

      // M10 fix: correct alreadyClassified calculation
      const skipped = candidates.length - processed - errors;
      console.log(JSON.stringify({
        level: 'info',
        module: 'RoleDeductionEnrichmentJob',
        action: 'batch_complete',
        processed,
        rolesAssigned,
        skipped: Math.max(0, skipped),
        errors,
        timestamp: new Date().toISOString(),
      }));

      await completeSyncRun(runId, { succeeded: processed, failed: errors, total: candidates.length });
    } catch (err) {
      console.error('[RoleDeductionEnrichmentJob] Fatal error:', err);
      await failSyncRun(runId, err instanceof Error ? err.message : String(err));
    }
  }
}

// Story 2.6: Availability refresh job — recalculates availability state for stale candidates
export class CandidateAvailabilityRefreshJob implements SchedulerJob {
  name = 'CandidateAvailabilityRefreshJob';

  async run(): Promise<void> {
    if (!isSupabaseConfigured()) {
      console.log('[AvailabilityRefresh] Supabase not configured — skipping');
      return;
    }

    const runId = await createSyncRun('availability-refresh');
    let processed = 0;
    let stateChanged = 0;
    let unchanged = 0;
    let errors = 0;

    try {
      const { computeAvailabilityState } = await import(
        '../../features/candidate-management/application/availability-scoring'
      );
      const { updateAvailabilityStatus } = await import(
        '../../features/candidate-management/infrastructure/availability-repository'
      );

      const db = getSupabaseAdminClient();

      // Read refresh interval from policy_registry
      let intervalHours = 4;
      try {
        const { data: policyData } = await db
          .schema('cblaero_app')
          .from('policy_registry')
          .select('id')
          .eq('family', 'refresh_cadences')
          .eq('key', 'candidate_availability')
          .maybeSingle();

        if (policyData) {
          const { data: versionData } = await db
            .schema('cblaero_app')
            .from('policy_versions')
            .select('value')
            .eq('policy_id', policyData.id)
            .lte('effective_from', new Date().toISOString())
            .order('effective_from', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (versionData?.value && typeof versionData.value === 'object' && 'interval_hours' in versionData.value) {
            intervalHours = (versionData.value as { interval_hours: number }).interval_hours;
          }
        }
      } catch {
        console.warn('[AvailabilityRefresh] Failed to read policy — using default 4h interval');
      }

      const cutoff = new Date(Date.now() - intervalHours * 60 * 60 * 1000).toISOString();

      // Query candidates where availability_last_signal_at is null or older than interval
      const { data: candidates, error: fetchError } = await db
        .from('candidates')
        .select('id, tenant_id, availability_status')
        .eq('ingestion_state', 'active')
        .or(`availability_last_signal_at.is.null,availability_last_signal_at.lt.${cutoff}`)
        .limit(200);

      if (fetchError) throw new Error(`Failed to fetch stale candidates: ${fetchError.message}`);

      if (!candidates || candidates.length === 0) {
        console.log('[AvailabilityRefresh] No candidates need refresh');
        await completeSyncRun(runId, { succeeded: 0, failed: 0, total: 0 });
        return;
      }

      console.log(`[AvailabilityRefresh] Processing ${candidates.length} candidates (interval: ${intervalHours}h)`);

      // Process in parallel sub-batches of 10 to avoid overwhelming the DB
      const PARALLEL_CHUNK = 10;
      for (let i = 0; i < candidates.length; i += PARALLEL_CHUNK) {
        const chunk = candidates.slice(i, i + PARALLEL_CHUNK);
        const results = await Promise.allSettled(
          chunk.map(async (candidate) => {
            const newState = await computeAvailabilityState(candidate.tenant_id, candidate.id);
            await updateAvailabilityStatus(candidate.tenant_id, candidate.id, newState, 'system');
            return { previousState: candidate.availability_status, newState };
          }),
        );

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          if (result.status === 'fulfilled') {
            processed++;
            if (result.value.previousState !== result.value.newState) {
              stateChanged++;
            } else {
              unchanged++;
            }
          } else {
            errors++;
            console.error(`[AvailabilityRefresh] Error for candidate ${chunk[j].id}:`, result.reason instanceof Error ? result.reason.message : result.reason);
            recordSyncFailure('availability-refresh', chunk[j].id, result.reason, runId);
          }
        }
      }

      console.log(JSON.stringify({
        level: 'info',
        module: 'CandidateAvailabilityRefreshJob',
        action: 'batch_complete',
        processed,
        stateChanged,
        unchanged,
        errors,
      }));

      await completeSyncRun(runId, { succeeded: processed, failed: errors, total: candidates.length });
    } catch (err) {
      console.error('[AvailabilityRefresh] Fatal error:', err);
      await failSyncRun(runId, err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
  }
}

export function registerIngestionJobs(scheduler: { register(job: SchedulerJob, metadata?: SchedulerRegistration): void }) {
  // DN5: All jobs carry policyFamily/policyKey so cadences are versioned and auditable
  scheduler.register(new CeipalIngestionJob(), {
    jobKey: 'ceipal-sync',
    scheduleName: 'CEIPAL ATS Candidate Sync',
    cronExpression: '0 * * * *',
    policyFamily: 'ingestion_schedules',
    policyKey: 'ceipal_sync',
  });
  scheduler.register(new EmailIngestionJob(), {
    jobKey: 'email-sync',
    scheduleName: 'Email Inbox Resume Ingestion',
    cronExpression: '*/15 * * * *',
    policyFamily: 'ingestion_schedules',
    policyKey: 'email_sync',
  });
  // Convert recruiter-uploaded Word docs to PDF before the poller runs so
  // they show up as PDFs in the same OneDrive tree.
  scheduler.register(new OneDriveWordToPdfJob(), {
    jobKey: 'onedrive-word-to-pdf',
    scheduleName: 'OneDrive Word → PDF Conversion',
    cronExpression: '*/30 * * * *',
    policyFamily: 'ingestion_schedules',
    policyKey: 'onedrive_word_to_pdf',
  });
  scheduler.register(new OneDriveResumePollerJob(), {
    jobKey: 'onedrive-sync',
    scheduleName: 'OneDrive Resume Sync',
    cronExpression: '0 */4 * * *',
    policyFamily: 'ingestion_schedules',
    policyKey: 'onedrive_sync',
  });
  scheduler.register(new SavedSearchDigestJob(), {
    jobKey: 'saved-search-digest',
    scheduleName: 'Saved Search Digest',
    cronExpression: '0 6 * * *',
    policyFamily: 'ingestion_schedules',
    policyKey: 'saved_search_digest',
  });
  scheduler.register(new DedupWorkerJob(), {
    jobKey: 'dedup',
    scheduleName: 'Duplicate Candidate Detection',
    cronExpression: '*/15 * * * *',
    policyFamily: 'ingestion_schedules',
    policyKey: 'dedup',
  });
  scheduler.register(new RoleDeductionEnrichmentJob(), {
    jobKey: 'role-enrichment',
    scheduleName: 'Role & Title Enrichment',
    cronExpression: '0 3 * * *',
    policyFamily: 'ingestion_schedules',
    policyKey: 'role_enrichment',
  });
  scheduler.register(new CandidateAvailabilityRefreshJob(), {
    jobKey: 'availability-refresh',
    scheduleName: 'Candidate Availability Refresh',
    cronExpression: '0 */4 * * *',
    policyFamily: 'refresh_cadences',
    policyKey: 'candidate_availability',
  });
}

// GlobalScheduler stub removed — deferred to Story 2.7. Use registerIngestionJobs() with a real scheduler.
