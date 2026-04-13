import { NextResponse } from 'next/server';
import { withAuth } from '@/modules/auth';
import { recordImportBatchAccessEvent } from '@/modules/audit';
import { mapToCandidateRow } from '@/modules/ingestion';
import {
  getImportBatchById,
  updateImportBatch,
  processImportChunk,
} from '@/features/candidate-management/infrastructure/import-batch-repository';
import {
  listSubmissionsByBatchIds,
  updateSubmissionCandidateIds,
  countFailedSubmissions,
} from '@/features/candidate-management/infrastructure/submission-repository';
import {
  findCandidateIdsByEmails,
} from '@/features/candidate-management/infrastructure/candidate-repository';

interface ConfirmedCandidate {
  submissionId: string;
  edits?: Record<string, unknown>;
}

interface ConfirmPayload {
  confirmed: ConfirmedCandidate[];
  rejected: string[];
}

import { resolveRequestTenantId } from '@/app/api/internal/recruiter/csv-upload/shared';

export const POST = withAuth<{ batchId: string }>(async ({ session, request, params, traceId }) => {
  const { batchId } = params;
  const tenantId = resolveRequestTenantId(session, request);

  let payload: ConfirmPayload;
  try {
    payload = await request.json();
  } catch (err) {
    console.warn(JSON.stringify({ level: 'warn', module: 'recruiter/resume-upload/confirm', action: 'parse_body', traceId, error: err instanceof Error ? err.message : String(err) }));
    return NextResponse.json(
      { error: { code: 'invalid_body', message: 'Expected JSON body with confirmed and rejected arrays.' } },
      { status: 400 }
    );
  }

  if (!Array.isArray(payload.confirmed) || !Array.isArray(payload.rejected)) {
    return NextResponse.json(
      { error: { code: 'invalid_body', message: 'Body must include confirmed[] and rejected[] arrays.' } },
      { status: 400 }
    );
  }

  const batch = await getImportBatchById(batchId, tenantId);
  if (!batch) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Batch not found.' } },
      { status: 404 }
    );
  }

  if (batch.status === 'complete') {
    return NextResponse.json(
      { error: { code: 'already_confirmed', message: 'This batch has already been confirmed.' } },
      { status: 409 }
    );
  }

  const skipped = payload.rejected.length;

  // Batch-fetch all confirmed submissions
  const confirmedIds = payload.confirmed.map((c) => c.submissionId);
  const editsMap = new Map(
    payload.confirmed.filter((c) => c.edits).map((c) => [c.submissionId, c.edits!])
  );

  const submissions = await listSubmissionsByBatchIds(batchId, tenantId, confirmedIds);

  // Whitelist of editable fields to prevent field injection
  const ALLOWED_EDIT_KEYS = new Set([
    'firstName', 'lastName', 'middleName', 'email', 'phone', 'location',
    'jobTitle', 'skills', 'certifications', 'yearsOfExperience',
    'workAuthorization', 'aircraftExperience', 'hasAPLicense', 'clearance',
    'employmentType', 'client', 'currentRate',
  ]);

  const candidateRows: Array<Record<string, unknown>> = [];
  const submissionEmails: Array<{ submissionId: string; email: string | null }> = [];

  let rowNum = 0;
  for (const submission of submissions) {
    if (!submission.extractedData) continue;
    rowNum++;

    const extraction = submission.extractedData;
    const rawEdits = editsMap.get(submission.id);
    const safeEdits: Record<string, unknown> = {};
    if (rawEdits) {
      for (const key of Object.keys(rawEdits)) {
        if (ALLOWED_EDIT_KEYS.has(key)) safeEdits[key] = rawEdits[key];
      }
    }
    const merged = Object.keys(safeEdits).length > 0 ? { ...extraction, ...safeEdits } : extraction;

    const baseRow = mapToCandidateRow(
      { ...merged, createdByActorId: session.actorId },
      'resume_upload',
      { ingestion_state: 'pending_dedup' },
    );
    const email = baseRow.email;

    candidateRows.push({
      ...baseRow,
      tenant_id: tenantId,
      row_number: rowNum,
      raw_data: merged,
      source_batch_id: batchId,
      extra_attributes: {},
    });

    submissionEmails.push({ submissionId: submission.id, email });
  }

  let imported = 0;

  if (candidateRows.length > 0) {
    try {
      const rpcResult = await processImportChunk({
        batchId,
        candidates: candidateRows,
        errorRows: [],
        totalImported: 0,
        totalSkipped: skipped,
        totalErrors: 0,
      });
      imported = rpcResult.imported;
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', module: 'recruiter/resume-upload/confirm', action: 'rpc_failed', traceId, batchId, candidateCount: candidateRows.length, error: err instanceof Error ? err.message : String(err) }));
      return NextResponse.json(
        { error: { code: 'processing_error', message: 'Failed to persist confirmed candidates.' } },
        { status: 500 }
      );
    }

    // Link submissions to persisted candidates by email
    try {
      const emailsToLink = submissionEmails.filter((s) => s.email).map((s) => s.email!);
      if (emailsToLink.length > 0) {
        const emailToId = await findCandidateIdsByEmails(emailsToLink, tenantId);

        if (emailToId.size > 0) {
          const byCandidateId = new Map<string, string[]>();
          for (const s of submissionEmails) {
            if (s.email && emailToId.has(s.email)) {
              const candidateId = emailToId.get(s.email)!;
              const arr = byCandidateId.get(candidateId) ?? [];
              arr.push(s.submissionId);
              byCandidateId.set(candidateId, arr);
            }
          }
          await updateSubmissionCandidateIds(
            [...byCandidateId.entries()].map(([candidateId, submissionIds]) => ({
              candidateId,
              submissionIds,
            })),
          );
        }
      }
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', module: 'recruiter/resume-upload/confirm', action: 'submission_linkage_failed', traceId, batchId, error: err instanceof Error ? err.message : String(err) }));
      // Non-fatal: candidates are persisted, linkage can be retried
    }
  }

  let errors = 0;
  try {
    errors = await countFailedSubmissions(batchId, tenantId);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', module: 'recruiter/resume-upload/confirm', action: 'count_failures_failed', traceId, batchId, error: err instanceof Error ? err.message : String(err) }));
  }

  await updateImportBatch(batchId, {
    status: 'complete',
    imported,
    skipped,
    errors,
    completedAt: new Date().toISOString(),
  });

  try {
    await recordImportBatchAccessEvent({
      traceId,
      actorId: session.actorId,
      tenantId,
      batchId,
      action: 'resume_confirm_access',
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', module: 'recruiter/resume-upload/confirm', action: 'audit_event_failed', traceId, batchId, error: err instanceof Error ? err.message : String(err) }));
  }

  return NextResponse.json({
    data: { batchId, status: 'complete', imported, skipped, errors },
    meta: {},
  });
}, { action: 'recruiter:csv-upload' });
