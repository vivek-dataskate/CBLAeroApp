import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSubmissionStoreForTest,
  insertSubmission,
  findSubmissionByMessageId,
  listSubmissionsByBatch,
  listSubmissionsByBatchIds,
  countFailedSubmissions,
  seedSubmissionForTest,
} from "../submission-repository";

describe("SubmissionRepository (in-memory)", () => {
  beforeEach(() => {
    clearSubmissionStoreForTest();
  });

  it("inserts a submission and returns its id", async () => {
    const id = await insertSubmission({
      tenantId: "tenant-a",
      source: "resume_upload",
      importBatchId: "batch-1",
      extractedData: { firstName: "Jane", lastName: "Doe" },
      extractionModel: "claude-haiku-4-5-20251001",
      attachments: [{ filename: "resume.pdf", url: "https://example.com/resume.pdf", size: 1024 }],
    });

    expect(id).toBeTruthy();
  });

  it("inserts with explicit id", async () => {
    const id = await insertSubmission({
      id: "explicit-id",
      tenantId: "tenant-a",
      source: "email",
      extractedData: { firstName: "John" },
    });

    expect(id).toBe("explicit-id");
  });

  it("finds submission by email message id", async () => {
    await insertSubmission({
      tenantId: "tenant-a",
      source: "email",
      emailMessageId: "msg-123",
      extractedData: { firstName: "Jane" },
    });

    const found = await findSubmissionByMessageId("msg-123", "tenant-a");
    expect(found).not.toBeNull();
    expect(found!.emailMessageId).toBe("msg-123");
  });

  it("returns null for non-existent message id", async () => {
    const found = await findSubmissionByMessageId("nonexistent", "tenant-a");
    expect(found).toBeNull();
  });

  it("enforces tenant isolation on message id lookup", async () => {
    await insertSubmission({
      tenantId: "tenant-a",
      source: "email",
      emailMessageId: "msg-456",
      extractedData: { firstName: "Jane" },
    });

    const found = await findSubmissionByMessageId("msg-456", "tenant-b");
    expect(found).toBeNull();
  });

  it("lists submissions by batch", async () => {
    await insertSubmission({
      tenantId: "tenant-a",
      source: "resume_upload",
      importBatchId: "batch-1",
      extractedData: { firstName: "Jane" },
    });
    await insertSubmission({
      tenantId: "tenant-a",
      source: "resume_upload",
      importBatchId: "batch-1",
      extractedData: { firstName: "John" },
    });
    await insertSubmission({
      tenantId: "tenant-a",
      source: "resume_upload",
      importBatchId: "batch-2",
      extractedData: { firstName: "Bob" },
    });

    const results = await listSubmissionsByBatch("batch-1", "tenant-a");
    expect(results).toHaveLength(2);
  });

  it("lists submissions by batch and specific ids", async () => {
    const id1 = await insertSubmission({
      tenantId: "tenant-a",
      source: "resume_upload",
      importBatchId: "batch-1",
      extractedData: { firstName: "Jane" },
    });
    const id2 = await insertSubmission({
      tenantId: "tenant-a",
      source: "resume_upload",
      importBatchId: "batch-1",
      extractedData: { firstName: "John" },
    });
    await insertSubmission({
      tenantId: "tenant-a",
      source: "resume_upload",
      importBatchId: "batch-1",
      extractedData: { firstName: "Bob" },
    });

    const results = await listSubmissionsByBatchIds("batch-1", "tenant-a", [id1, id2]);
    expect(results).toHaveLength(2);
  });

  it("returns empty array for empty id list", async () => {
    const results = await listSubmissionsByBatchIds("batch-1", "tenant-a", []);
    expect(results).toHaveLength(0);
  });

  it("counts failed submissions (null extracted_data)", async () => {
    await insertSubmission({
      tenantId: "tenant-a",
      source: "resume_upload",
      importBatchId: "batch-1",
      extractedData: null,
    });
    await insertSubmission({
      tenantId: "tenant-a",
      source: "resume_upload",
      importBatchId: "batch-1",
      extractedData: { firstName: "Jane" },
    });
    await insertSubmission({
      tenantId: "tenant-a",
      source: "resume_upload",
      importBatchId: "batch-1",
      extractedData: null,
    });

    const count = await countFailedSubmissions("batch-1", "tenant-a");
    expect(count).toBe(2);
  });

  it("seed and clear work for test mode", async () => {
    seedSubmissionForTest({
      id: "seeded-1",
      tenantId: "tenant-a",
      candidateId: null,
      importBatchId: null,
      source: "email",
      emailMessageId: "msg-seeded",
      emailSubject: null,
      emailBody: null,
      emailFrom: null,
      emailReceivedAt: null,
      extractedData: null,
      extractionModel: null,
      attachments: [],
      createdAt: "2026-04-01T00:00:00Z",
    });

    const found = await findSubmissionByMessageId("msg-seeded", "tenant-a");
    expect(found).not.toBeNull();

    clearSubmissionStoreForTest();

    const after = await findSubmissionByMessageId("msg-seeded", "tenant-a");
    expect(after).toBeNull();
  });
});
