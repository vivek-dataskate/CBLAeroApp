import { shouldUseInMemoryPersistenceForTests } from '@/modules/persistence';
import type { CandidateExtraction } from '@/features/candidate-management/application/candidate-extraction';

export type FileStatus = 'queued' | 'processing' | 'complete' | 'failed' | 'skipped';

export interface ResumeFileResult {
  filename: string;
  status: FileStatus;
  extraction?: CandidateExtraction;
  error?: string;
  storageUrl?: string;
  storageWarning?: string;
  submissionId?: string;
}

export interface ResumeBatch {
  id: string;
  tenantId: string;
  source: 'resume_upload';
  status: 'processing' | 'complete';
  files: ResumeFileResult[];
  imported: number;
  skipped: number;
  errors: number;
  createdAt: string;
  completedAt?: string;
}

const IN_MEMORY_BATCH_LIMIT = 100;
const inMemoryBatches: ResumeBatch[] = [];

export function createInMemoryResumeBatch(tenantId: string): ResumeBatch {
  const batch: ResumeBatch = {
    id: crypto.randomUUID(),
    tenantId,
    source: 'resume_upload',
    status: 'processing',
    files: [],
    imported: 0,
    skipped: 0,
    errors: 0,
    createdAt: new Date().toISOString(),
  };
  inMemoryBatches.push(batch);
  if (inMemoryBatches.length > IN_MEMORY_BATCH_LIMIT) {
    inMemoryBatches.splice(0, inMemoryBatches.length - IN_MEMORY_BATCH_LIMIT);
  }
  return batch;
}

export function getInMemoryResumeBatch(batchId: string, tenantId: string): ResumeBatch | undefined {
  return inMemoryBatches.find((b) => b.id === batchId && b.tenantId === tenantId);
}

export function finalizeInMemoryResumeBatch(
  batchId: string,
  tenantId: string,
  counts: { imported: number; skipped: number; errors: number }
): ResumeBatch | undefined {
  const batch = inMemoryBatches.find((b) => b.id === batchId && b.tenantId === tenantId);
  if (batch) {
    batch.status = 'complete';
    batch.imported = counts.imported;
    batch.skipped = counts.skipped;
    batch.errors = counts.errors;
    batch.completedAt = new Date().toISOString();
  }
  return batch;
}

export function clearResumeUploadStoreForTest(): void {
  if (!shouldUseInMemoryPersistenceForTests()) return;
  inMemoryBatches.splice(0);
}

export function isInMemoryMode(): boolean {
  return shouldUseInMemoryPersistenceForTests();
}
