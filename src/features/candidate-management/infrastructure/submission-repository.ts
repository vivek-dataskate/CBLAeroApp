import {
  getSupabaseAdminClient,
  shouldUseInMemoryPersistenceForTests,
} from "@/modules/persistence";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export type CandidateSubmission = {
  id: string;
  tenantId: string;
  candidateId: string | null;
  importBatchId: string | null;
  source: string;
  emailMessageId: string | null;
  emailSubject: string | null;
  emailBody: string | null;
  emailFrom: string | null;
  emailReceivedAt: string | null;
  extractedData: Record<string, unknown> | null;
  extractionModel: string | null;
  attachments: Array<{ filename: string; url?: string; size?: number }>;
  createdAt: string;
};

export type SubmissionInsertParams = {
  id?: string;
  tenantId: string;
  candidateId?: string | null;
  importBatchId?: string | null;
  source: string;
  emailMessageId?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  emailFrom?: string | null;
  emailReceivedAt?: string | null;
  extractedData: Record<string, unknown> | null;
  extractionModel?: string | null;
  attachments?: Array<{ filename: string; url?: string; size?: number }>;
};

// -----------------------------------------------------------------------
// Row type (DB shape)
// -----------------------------------------------------------------------

type SubmissionRow = {
  id: string;
  tenant_id: string;
  candidate_id: string | null;
  import_batch_id: string | null;
  source: string;
  email_message_id: string | null;
  email_subject: string | null;
  email_body: string | null;
  email_from: string | null;
  email_received_at: string | null;
  extracted_data: Record<string, unknown> | null;
  extraction_model: string | null;
  attachments: Array<{ filename: string; url?: string; size?: number }>;
  created_at: string;
};

// -----------------------------------------------------------------------
// Row mapping
// -----------------------------------------------------------------------

function toSubmission(row: SubmissionRow): CandidateSubmission {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    candidateId: row.candidate_id,
    importBatchId: row.import_batch_id,
    source: row.source,
    emailMessageId: row.email_message_id,
    emailSubject: row.email_subject,
    emailBody: row.email_body,
    emailFrom: row.email_from,
    emailReceivedAt: row.email_received_at,
    extractedData: row.extracted_data,
    extractionModel: row.extraction_model,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    createdAt: row.created_at,
  };
}

// -----------------------------------------------------------------------
// In-memory store (test mode only)
// -----------------------------------------------------------------------

const submissionStore = new Map<string, SubmissionRow>();

export function seedSubmissionForTest(submission: CandidateSubmission): void {
  submissionStore.set(submission.id, {
    id: submission.id,
    tenant_id: submission.tenantId,
    candidate_id: submission.candidateId,
    import_batch_id: submission.importBatchId,
    source: submission.source,
    email_message_id: submission.emailMessageId,
    email_subject: submission.emailSubject,
    email_body: submission.emailBody,
    email_from: submission.emailFrom,
    email_received_at: submission.emailReceivedAt,
    extracted_data: submission.extractedData,
    extraction_model: submission.extractionModel,
    attachments: submission.attachments,
    created_at: submission.createdAt,
  });
}

export function clearSubmissionStoreForTest(): void {
  if (!shouldUseInMemoryPersistenceForTests()) return;
  submissionStore.clear();
}

// -----------------------------------------------------------------------
// Public repository functions
// -----------------------------------------------------------------------

export async function insertSubmission(params: SubmissionInsertParams): Promise<string> {
  const id = params.id ?? crypto.randomUUID();

  if (shouldUseInMemoryPersistenceForTests()) {
    const row: SubmissionRow = {
      id,
      tenant_id: params.tenantId,
      candidate_id: params.candidateId ?? null,
      import_batch_id: params.importBatchId ?? null,
      source: params.source,
      email_message_id: params.emailMessageId ?? null,
      email_subject: params.emailSubject ?? null,
      email_body: params.emailBody ?? null,
      email_from: params.emailFrom ?? null,
      email_received_at: params.emailReceivedAt ?? null,
      extracted_data: params.extractedData,
      extraction_model: params.extractionModel ?? null,
      attachments: params.attachments ?? [],
      created_at: new Date().toISOString(),
    };
    submissionStore.set(id, row);
    return id;
  }

  const client = getSupabaseAdminClient();
  const insertRow: Record<string, unknown> = {
    id,
    tenant_id: params.tenantId,
    source: params.source,
    extracted_data: params.extractedData,
    attachments: params.attachments ?? [],
  };

  if (params.candidateId) insertRow.candidate_id = params.candidateId;
  if (params.importBatchId) insertRow.import_batch_id = params.importBatchId;
  if (params.emailMessageId) insertRow.email_message_id = params.emailMessageId;
  if (params.emailSubject) insertRow.email_subject = params.emailSubject;
  if (params.emailBody) insertRow.email_body = params.emailBody;
  if (params.emailFrom) insertRow.email_from = params.emailFrom;
  if (params.emailReceivedAt) insertRow.email_received_at = params.emailReceivedAt;
  if (params.extractionModel) insertRow.extraction_model = params.extractionModel;

  const { error } = await client
    .from("candidate_submissions")
    .insert(insertRow);

  if (error) {
    throw new Error(`Failed to insert submission: ${error.message}`);
  }

  return id;
}

export async function findSubmissionByMessageId(
  messageId: string,
  tenantId: string,
): Promise<CandidateSubmission | null> {
  if (shouldUseInMemoryPersistenceForTests()) {
    for (const row of submissionStore.values()) {
      if (row.email_message_id === messageId && row.tenant_id === tenantId) {
        return toSubmission(row);
      }
    }
    return null;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("candidate_submissions")
    .select("*")
    .eq("email_message_id", messageId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find submission by message ID: ${error.message}`);
  }

  if (!data) return null;
  return toSubmission(data as SubmissionRow);
}

export async function listSubmissionsByBatch(
  batchId: string,
  tenantId: string,
): Promise<CandidateSubmission[]> {
  if (shouldUseInMemoryPersistenceForTests()) {
    return [...submissionStore.values()]
      .filter((row) => row.import_batch_id === batchId && row.tenant_id === tenantId)
      .map(toSubmission);
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("candidate_submissions")
    .select("*")
    .eq("import_batch_id", batchId)
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(`Failed to list submissions by batch: ${error.message}`);
  }

  return (data ?? []).map((row) => toSubmission(row as SubmissionRow));
}

export async function listSubmissionsByBatchIds(
  batchId: string,
  tenantId: string,
  submissionIds: string[],
): Promise<CandidateSubmission[]> {
  if (submissionIds.length === 0) return [];

  if (shouldUseInMemoryPersistenceForTests()) {
    return [...submissionStore.values()]
      .filter(
        (row) =>
          row.import_batch_id === batchId &&
          row.tenant_id === tenantId &&
          submissionIds.includes(row.id),
      )
      .map(toSubmission);
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("candidate_submissions")
    .select("*")
    .in("id", submissionIds)
    .eq("tenant_id", tenantId)
    .eq("import_batch_id", batchId);

  if (error) {
    throw new Error(`Failed to fetch submissions by IDs: ${error.message}`);
  }

  return (data ?? []).map((row) => toSubmission(row as SubmissionRow));
}

export async function updateSubmissionCandidateIds(
  updates: Array<{ submissionIds: string[]; candidateId: string }>,
): Promise<void> {
  if (shouldUseInMemoryPersistenceForTests()) {
    for (const { submissionIds, candidateId } of updates) {
      for (const subId of submissionIds) {
        const row = submissionStore.get(subId);
        if (row) row.candidate_id = candidateId;
      }
    }
    return;
  }

  const client = getSupabaseAdminClient();
  const results = await Promise.all(
    updates.map(({ submissionIds, candidateId }) =>
      client
        .from("candidate_submissions")
        .update({ candidate_id: candidateId })
        .in("id", submissionIds),
    ),
  );

  const errors = results
    .map((r, i) => (r.error ? `batch ${i}: ${r.error.message}` : null))
    .filter(Boolean);
  if (errors.length > 0) {
    throw new Error(`Failed to update submission candidate IDs: ${errors.join("; ")}`);
  }
}

export async function countFailedSubmissions(
  batchId: string,
  tenantId: string,
): Promise<number> {
  if (shouldUseInMemoryPersistenceForTests()) {
    let count = 0;
    for (const row of submissionStore.values()) {
      if (
        row.import_batch_id === batchId &&
        row.tenant_id === tenantId &&
        row.extracted_data === null
      ) {
        count++;
      }
    }
    return count;
  }

  const client = getSupabaseAdminClient();
  const { count, error } = await client
    .from("candidate_submissions")
    .select("id", { count: "exact", head: true })
    .eq("import_batch_id", batchId)
    .eq("tenant_id", tenantId)
    .is("extracted_data", null);

  if (error) {
    throw new Error(`Failed to count failed submissions: ${error.message}`);
  }

  return count ?? 0;
}
