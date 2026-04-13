import { NextResponse } from 'next/server';
import { withAuth } from '@/modules/auth';
import { recordImportBatchAccessEvent } from '@/modules/audit';
import { extractCandidateFromDocument } from '@/features/candidate-management/application/candidate-extraction';
import { deduceRoles } from '@/features/candidate-management/application/role-deduction';
import { createImportBatch } from '@/features/candidate-management/infrastructure/import-batch-repository';
import { insertSubmission } from '@/features/candidate-management/infrastructure/submission-repository';
import { uploadFileToStorage } from '@/features/candidate-management/infrastructure/storage';
import {
  computeFileHash,
  isAlreadyProcessed,
  recordFingerprint,
} from '@/features/candidate-management/infrastructure/fingerprint-repository';
import {
  type ResumeFileResult,
} from './shared';
import { resolveRequestTenantId } from '@/app/api/internal/recruiter/csv-upload/shared';

const BATCH_SIZE = 50;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES_PER_UPLOAD = 200;
const CONSECUTIVE_FAILURE_THRESHOLD = 5;

function isPdfFile(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    file.name.toLowerCase().endsWith('.pdf')
  );
}

export const POST = withAuth(async ({ session, request, traceId }) => {
  const tenantId = resolveRequestTenantId(session, request);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.warn(JSON.stringify({ level: 'warn', module: 'recruiter/resume-upload', action: 'parse_form_data', traceId, error: err instanceof Error ? err.message : String(err) }));
    return NextResponse.json(
      { error: { code: 'invalid_form_data', message: 'Expected multipart/form-data payload.' } },
      { status: 400 }
    );
  }

  const files: File[] = [];
  for (const [, value] of formData.entries()) {
    if (value instanceof File && value.size > 0) {
      files.push(value);
    }
  }

  if (files.length === 0) {
    return NextResponse.json(
      { error: { code: 'missing_file', message: 'At least one PDF file is required.' } },
      { status: 400 }
    );
  }

  if (files.length > MAX_FILES_PER_UPLOAD) {
    return NextResponse.json(
      {
        error: {
          code: 'too_many_files',
          message: `Maximum ${MAX_FILES_PER_UPLOAD} files per upload. You submitted ${files.length}.`,
        },
      },
      { status: 422 }
    );
  }

  const unsupportedFiles = files.filter((f) => !isPdfFile(f));
  if (unsupportedFiles.length > 0) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_file_type',
          message:
            'Only PDF files are supported. Please convert Word, RTF, or other formats to PDF before uploading.',
          details: { rejectedFiles: unsupportedFiles.map((f) => f.name) },
        },
      },
      { status: 422 }
    );
  }

  // Reject oversized files before processing
  const oversizedFiles = files.filter((f) => f.size > MAX_FILE_BYTES);
  if (oversizedFiles.length > 0) {
    return NextResponse.json(
      {
        error: {
          code: 'file_too_large',
          message: `Each PDF must be smaller than ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
          details: { rejectedFiles: oversizedFiles.map((f) => ({ name: f.name, size: f.size })) },
        },
      },
      { status: 413 }
    );
  }

  let batchId: string;
  try {
    const batch = await createImportBatch({
      tenantId,
      source: 'resume_upload',
      status: 'processing',
      totalRows: files.length,
      createdByActorId: session.actorId,
    });
    batchId = batch.id;
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', module: 'recruiter/resume-upload', action: 'create_batch', traceId, tenantId, error: err instanceof Error ? err.message : String(err) }));
    return NextResponse.json(
      { error: { code: 'database_error', message: 'Failed to create import batch.' } },
      { status: 500 }
    );
  }

  const fileResults: ResumeFileResult[] = [];
  let consecutiveFailures = 0;

  for (let start = 0; start < files.length; start += BATCH_SIZE) {
    // §26 circuit-breaker: abort remaining chunks if LLM appears down
    if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
      const remaining = files.slice(start);
      for (const file of remaining) {
        fileResults.push({
          filename: file.name,
          status: 'failed',
          error: `Skipped — ${CONSECUTIVE_FAILURE_THRESHOLD} consecutive extraction failures suggest the LLM service is unavailable`,
          submissionId: crypto.randomUUID(),
        });
      }
      console.warn(JSON.stringify({ level: 'warn', module: 'recruiter/resume-upload', action: 'circuit_breaker_tripped', traceId, batchId, consecutiveFailures, remainingFiles: remaining.length, timestamp: new Date().toISOString() }));
      break;
    }

    const chunk = files.slice(start, start + BATCH_SIZE);

    const chunkResults = await Promise.all(
      chunk.map(async (file): Promise<ResumeFileResult> => {
        const submissionId = crypto.randomUUID();
        let fileHash: string | undefined;
        try {
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Fingerprint gate: skip LLM extraction if this exact file was already processed
          fileHash = computeFileHash(buffer);
          if (await isAlreadyProcessed(tenantId, 'file_sha256', fileHash)) {
            console.log(JSON.stringify({ level: 'info', module: 'recruiter/resume-upload', action: 'fingerprint_hit', traceId, tenantId, hash: fileHash.slice(0, 12), timestamp: new Date().toISOString() }));
            return {
              filename: file.name,
              status: 'skipped',
              error: 'Duplicate file — already processed',
              submissionId,
            };
          }

          const storagePath = `resume-uploads/${tenantId}/${batchId}/${submissionId}`;
          const storage = await uploadFileToStorage(buffer, file.name, storagePath);
          const storageUrl = storage.url;
          const storageWarning = storage.warning;

          const result = await extractCandidateFromDocument(buffer, 'pdf', {
            source: 'resume_upload',
            tenantId,
            batchId,
          });

          if (result.error || !result.extraction) {
            consecutiveFailures++;
            await insertSubmission({
              id: submissionId,
              tenantId,
              source: 'resume_upload',
              importBatchId: batchId,
              extractedData: null,
              extractionModel: 'claude-haiku-4-5-20251001',
              attachments: [{ filename: file.name, url: storageUrl, size: buffer.length }],
            });

            await recordFingerprint({ tenantId, type: 'file_sha256', hash: fileHash, source: 'resume_upload', status: 'failed' });

            return {
              filename: file.name,
              status: 'failed',
              error: result.error ?? 'Extraction returned no data',
              storageUrl,
              storageWarning,
              submissionId,
            };
          }

          // Deduce roles from extracted data (LLM path — single file, acceptable latency)
          try {
            const extraction = result.extraction;
            const roleResult = await deduceRoles(
              {
                jobTitle: extraction.jobTitle ?? null,
                skills: extraction.skills ?? [],
                certifications: extraction.certifications ?? [],
                aircraftExperience: extraction.aircraftExperience ?? [],
              },
              tenantId,
            );
            extraction.deducedRoles = roleResult.roles;
            extraction.roleDeductionMetadata = roleResult.metadata;
          } catch (err) {
            console.warn(JSON.stringify({ level: 'warn', module: 'recruiter/resume-upload', action: 'role_deduction_failed', traceId, batchId, filename: file.name, error: err instanceof Error ? err.message : String(err) }));
            // Non-fatal — candidate proceeds with empty deduced_roles
          }

          await insertSubmission({
            id: submissionId,
            tenantId,
            source: 'resume_upload',
            importBatchId: batchId,
            extractedData: result.extraction ? { ...result.extraction } as Record<string, unknown> : null,
            extractionModel: 'claude-haiku-4-5-20251001',
            attachments: [{ filename: file.name, url: storageUrl, size: buffer.length }],
          });

          await recordFingerprint({ tenantId, type: 'file_sha256', hash: fileHash, source: 'resume_upload' });

          consecutiveFailures = 0; // Reset on success
          return {
            filename: file.name,
            status: 'complete',
            extraction: result.extraction,
            storageUrl,
            storageWarning,
            submissionId,
          };
        } catch (err) {
          consecutiveFailures++;
          const message = err instanceof Error ? err.message : String(err);
          console.error(JSON.stringify({ level: 'error', module: 'recruiter/resume-upload', action: 'file_processing_failed', traceId, batchId, filename: file.name, error: message, timestamp: new Date().toISOString() }));
          // Record failed fingerprint if hash was computed (allows retry on next upload)
          if (typeof fileHash === 'string') {
            recordFingerprint({ tenantId, type: 'file_sha256', hash: fileHash, source: 'resume_upload', status: 'failed' }).catch((e) => console.warn(JSON.stringify({ level: 'warn', module: 'recruiter/resume-upload', action: 'record_failed_fingerprint', traceId, error: e instanceof Error ? e.message : String(e) })));
          }
          return {
            filename: file.name,
            status: 'failed',
            error: message,
            submissionId,
          };
        }
      })
    );

    fileResults.push(...chunkResults);
  }

  const completedFiles = fileResults.filter((f) => f.status === 'complete').length;
  const skippedFiles = fileResults.filter((f) => f.status === 'skipped').length;
  const failedFiles = fileResults.filter((f) => f.status === 'failed').length;
  console.log(JSON.stringify({
    level: 'info', module: 'recruiter/resume-upload', action: 'batch_complete',
    traceId, batchId, totalFiles: files.length, complete: completedFiles, skipped: skippedFiles,
    failed: failedFiles, llmCalls: completedFiles + failedFiles - skippedFiles,
    timestamp: new Date().toISOString(),
  }));

  await recordImportBatchAccessEvent({
    traceId,
    actorId: session.actorId,
    tenantId,
    batchId,
    action: 'resume_upload_access',
  });

  return NextResponse.json({
    data: {
      batchId,
      files: fileResults.map((f) => ({
        filename: f.filename,
        status: f.status,
        extraction: f.extraction ?? undefined,
        error: f.error ?? undefined,
        storageWarning: f.storageWarning ?? undefined,
        submissionId: f.submissionId,
      })),
    },
    meta: {},
  });
}, { action: 'recruiter:csv-upload' });
