import { fetchCeipalApplicants, mapCeipalApplicantToCandidate } from '../ats';
import { MicrosoftGraphEmailParser } from '../email';
import { acquireGraphToken } from '../email/graph-auth';
import { getSupabaseAdminClient, isSupabaseConfigured } from '../persistence';
import { extractCandidateFromDocument } from '../../features/candidate-management/application/candidate-extraction';
import { deduceRoles } from '../../features/candidate-management/application/role-deduction';
import { recordSyncFailure, createSyncRun, completeSyncRun, failSyncRun, upsertCandidateFromEmailFull, batchUpsertCandidatesFromATS, DEFAULT_TENANT_ID, mapToCandidateRow } from './index';
import { fetchWithRetry } from './fetch-with-retry';
import {
  computeFileHash,
  isAlreadyProcessed,
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
      const startPage = params?.startPage ?? 1;
      const maxPages = params?.maxPages ?? 50;

      // Explicit since param takes priority; fall back to DB-backed last update timestamp.
      // This ensures daily-sync works even without an explicit since param, and avoids
      // the stale instance-level lastRunAt problem on serverless cold starts.
      let since = params?.since;
      // Only skip incremental filter when an explicit non-default startPage is provided (resume scenario)
      if (!since && !(params?.startPage && params.startPage > 1)) {
        try {
          since = await getLastCandidateUpdateBySource('ceipal');
        } catch (err) {
          console.warn('[CeipalIngestionJob] Could not load last sync timestamp, performing full fetch:', err instanceof Error ? err.message : err);
        }
      }

      const applicants = await fetchCeipalApplicants({
        startPage,
        maxPages,
        since,
      });

      console.log(`[CeipalIngestionJob] Fetched ${applicants.length} applicants (page ${startPage}, maxPages ${maxPages}${since ? `, since ${since.toISOString()}` : ''})`);

      if (applicants.length === 0) {
        await completeSyncRun(runId, { succeeded: 0, failed: 0, total: 0 });
        return;
      }

      const candidates = applicants.map(mapCeipalApplicantToCandidate);

      // Fingerprint gate: filter out already-processed applicants
      const knownFingerprints = await loadRecentFingerprints(DEFAULT_TENANT_ID, 'ats_external_id');
      const newCandidates = candidates.filter((c) => {
        const ceipalId = (c as Record<string, unknown>).ceipalId;
        if (!ceipalId) return true; // No stable ID — cannot fingerprint, fall through to upsert dedup
        const extId = `ceipal:${ceipalId}`;
        if (knownFingerprints.has(extId)) {
          console.log(JSON.stringify({ event: 'fingerprint_hit', type: 'ats_external_id', source: 'ceipal', tenantId: DEFAULT_TENANT_ID, hash: extId.slice(0, 12) }));
          return false;
        }
        return true;
      });

      if (newCandidates.length === 0) {
        console.log(`[CeipalIngestionJob] All ${candidates.length} applicants already fingerprinted — skipping`);
        await completeSyncRun(runId, { succeeded: 0, failed: 0, total: candidates.length });
        return;
      }

      console.log(`[CeipalIngestionJob] ${newCandidates.length} new of ${candidates.length} total (${candidates.length - newCandidates.length} skipped via fingerprint)`);
      const { inserted, failed } = await batchUpsertCandidatesFromATS(newCandidates);

      // Record fingerprints in batch — only for candidates with stable ceipalId
      const fingerprintEntries = newCandidates
        .filter((c) => (c as Record<string, unknown>).ceipalId)
        .map((c) => ({
          tenantId: DEFAULT_TENANT_ID,
          type: 'ats_external_id' as const,
          hash: `ceipal:${(c as Record<string, unknown>).ceipalId}`,
          source: 'ceipal' as const,
        }));
      if (fingerprintEntries.length > 0) {
        try {
          await recordFingerprintBatch(fingerprintEntries);
          console.log(`[CeipalIngestionJob] Recorded ${fingerprintEntries.length} fingerprints`);
        } catch (fpErr) {
          console.error('[CeipalIngestionJob] Fingerprint batch recording failed:', fpErr instanceof Error ? fpErr.message : fpErr);
          recordSyncFailure('ceipal', 'fingerprint-batch', fpErr, runId);
        }
      }

      console.log(`[CeipalIngestionJob] ${inserted} upserted, ${failed} failed`);
      await completeSyncRun(runId, { succeeded: inserted, failed, total: newCandidates.length });
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
    const token = await acquireGraphToken();
    const allFiles = await this.listPdfFiles(token);

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
        if (file) await this.deleteFromOneDrive(token, file.id, file.name);
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
              await this.deleteFromOneDrive(token, file.id, file.name);
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
                await this.deleteFromOneDrive(token, file.id, file.name);
              } else {
                console.warn(`[OneDrivePoller] Keeping ${file.name} in OneDrive — storage backup failed`);
              }
              return { status: 'failed' as const, file };
            }

            const ext = result.extraction;
            await recordFingerprint({ tenantId: DEFAULT_TENANT_ID, type: 'file_sha256', hash: fileHash, source: 'onedrive' });
            console.log(`[OneDrivePoller] Processed ${file.name} → ${ext.firstName} ${ext.lastName}`);

            if (storageUrl) {
              await this.deleteFromOneDrive(token, file.id, file.name);
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
    await this.deleteEmptySubfolders(token);

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

  private async listPdfFiles(token: string): Promise<Array<{ id: string; name: string; size: number; downloadUrl: string }>> {
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

    // BFS queue of folder URLs to scan (starts with the configured root folder)
    const folderQueue: string[] = [
      `https://graph.microsoft.com/v1.0/users/${user}/drive/root:/${this.folderPath}:/children?$top=${OneDriveResumePollerJob.PAGE_SIZE}`,
    ];

    while (folderQueue.length > 0 && allPdfs.length < OneDriveResumePollerJob.MAX_FILES_PER_RUN) {
      let url: string | null = folderQueue.shift()!;

      // Paginate through all items in this folder
      while (url && allPdfs.length < OneDriveResumePollerJob.MAX_FILES_PER_RUN) {
        const response = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${token}` } });

        if (!response.ok) {
          const text = await response.text();
          console.warn(`[OneDrivePoller] Folder listing failed (${response.status}): ${text}`);
          break;
        }

        const data = await response.json() as {
          value: GraphItem[];
          '@odata.nextLink'?: string;
        };

        for (const item of data.value ?? []) {
          // Queue subfolders for recursive scanning
          if (item.folder) {
            folderQueue.push(
              `https://graph.microsoft.com/v1.0/users/${user}/drive/items/${item.id}/children?$top=${OneDriveResumePollerJob.PAGE_SIZE}`
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

        url = data['@odata.nextLink'] ?? null;
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

  private async deleteFromOneDrive(token: string, fileId: string, filename: string): Promise<void> {
    const user = encodeURIComponent(this.driveUser);
    const url = `https://graph.microsoft.com/v1.0/users/${user}/drive/items/${fileId}`;

    const response = await fetchWithRetry(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok || response.status === 204) {
      console.log(`[OneDrivePoller] Deleted ${filename} from OneDrive`);
    } else {
      console.warn(`[OneDrivePoller] Failed to delete ${filename} from OneDrive (${response.status})`);
    }
  }

  /**
   * Walk subfolders of the configured root and delete any that are empty.
   * Processes deepest folders first (reverse BFS) so parent folders become
   * empty after their children are removed.
   */
  private async deleteEmptySubfolders(token: string): Promise<void> {
    const user = encodeURIComponent(this.driveUser);
    const rootUrl = `https://graph.microsoft.com/v1.0/users/${user}/drive/root:/${this.folderPath}:/children?$top=${OneDriveResumePollerJob.PAGE_SIZE}`;

    type FolderEntry = { id: string; name: string };

    // BFS to collect all subfolder IDs (not the root itself)
    const folderQueue: string[] = [rootUrl];
    const allSubfolders: FolderEntry[] = [];

    while (folderQueue.length > 0) {
      const url = folderQueue.shift()!;
      const response = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) continue;

      const data = await response.json() as {
        value: Array<{ id: string; name: string; folder?: { childCount: number } }>;
        '@odata.nextLink'?: string;
      };

      for (const item of data.value ?? []) {
        if (item.folder) {
          allSubfolders.push({ id: item.id, name: item.name });
          folderQueue.push(
            `https://graph.microsoft.com/v1.0/users/${user}/drive/items/${item.id}/children?$top=${OneDriveResumePollerJob.PAGE_SIZE}`
          );
        }
      }

      if (data['@odata.nextLink']) {
        folderQueue.push(data['@odata.nextLink']);
      }
    }

    if (allSubfolders.length === 0) return;

    // Delete deepest first (reverse order since BFS goes top-down)
    for (const folder of allSubfolders.reverse()) {
      // Check if folder is now empty
      const checkUrl = `https://graph.microsoft.com/v1.0/users/${user}/drive/items/${folder.id}/children?$top=1`;
      const checkRes = await fetchWithRetry(checkUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!checkRes.ok) continue;

      const checkData = await checkRes.json() as { value: unknown[] };
      if ((checkData.value ?? []).length > 0) continue;

      // Folder is empty — delete it
      const delUrl = `https://graph.microsoft.com/v1.0/users/${user}/drive/items/${folder.id}`;
      const delRes = await fetchWithRetry(delUrl, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (delRes.ok || delRes.status === 204) {
        console.log(`[OneDrivePoller] Deleted empty subfolder: ${folder.name}`);
      } else {
        console.warn(`[OneDrivePoller] Failed to delete subfolder ${folder.name} (${delRes.status})`);
      }
    }
  }
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
      const { acquireGraphToken: getToken } = await import('../email/graph-auth');
      const { fetchWithRetry: fetchRetry } = await import('./fetch-with-retry');

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

          // Send email via Microsoft Graph
          const token = await getToken();
          const senderAddress = process.env.CBL_DIGEST_SENDER ?? 'submissions-inbox@cblsolutions.com';
          const sendUrl = `https://graph.microsoft.com/v1.0/users/${senderAddress}/sendMail`;

          const sendResponse = await fetchRetry(sendUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: {
                subject: `CBL Aero Daily Digest: "${search.name}" — ${date}`,
                body: { contentType: 'HTML', content: html },
                toRecipients: [{ emailAddress: { address: search.actorEmail } }],
              },
            }),
          });

          if (!sendResponse.ok && sendResponse.status !== 202) {
            const errText = await sendResponse.text().catch(() => '(no body)');
            throw new Error(`Graph sendMail failed (${sendResponse.status}): ${errText}`);
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

export function registerIngestionJobs(scheduler: { register(job: SchedulerJob): void }) {
  scheduler.register(new CeipalIngestionJob());
  scheduler.register(new EmailIngestionJob());
  scheduler.register(new OneDriveResumePollerJob());
  scheduler.register(new SavedSearchDigestJob());
  scheduler.register(new DedupWorkerJob());
  scheduler.register(new RoleDeductionEnrichmentJob());
  scheduler.register(new CandidateAvailabilityRefreshJob());
}

// GlobalScheduler stub removed — deferred to Story 2.7. Use registerIngestionJobs() with a real scheduler.
