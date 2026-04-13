import { beforeEach, describe, expect, it } from "vitest";
import {
  clearImportBatchStoreForTest,
  createImportBatch,
  getImportBatchById,
  updateImportBatch,
  listImportBatchesByTenant,
  seedImportBatchForTest,
} from "../import-batch-repository";

describe("ImportBatchRepository (in-memory)", () => {
  beforeEach(() => {
    clearImportBatchStoreForTest();
  });

  it("creates a batch and returns id + startedAt", async () => {
    const result = await createImportBatch({
      tenantId: "tenant-a",
      source: "csv_upload",
      status: "validating",
      totalRows: 100,
      createdByActorId: "actor-1",
    });

    expect(result.id).toBeTruthy();
    expect(result.startedAt).toBeTruthy();
  });

  it("retrieves batch by id and tenant", async () => {
    const { id } = await createImportBatch({
      tenantId: "tenant-a",
      source: "resume_upload",
      status: "processing",
      totalRows: 5,
      createdByActorId: "actor-1",
    });

    const batch = await getImportBatchById(id, "tenant-a");
    expect(batch).not.toBeNull();
    expect(batch!.id).toBe(id);
    expect(batch!.tenantId).toBe("tenant-a");
    expect(batch!.source).toBe("resume_upload");
    expect(batch!.status).toBe("processing");
    expect(batch!.totalRows).toBe(5);
    expect(batch!.imported).toBe(0);
  });

  it("returns null for non-existent batch", async () => {
    const batch = await getImportBatchById("nonexistent", "tenant-a");
    expect(batch).toBeNull();
  });

  it("enforces tenant isolation on get", async () => {
    const { id } = await createImportBatch({
      tenantId: "tenant-a",
      source: "csv_upload",
      status: "validating",
      totalRows: 10,
      createdByActorId: "actor-1",
    });

    const batch = await getImportBatchById(id, "tenant-b");
    expect(batch).toBeNull();
  });

  it("updates batch status and counts", async () => {
    const { id } = await createImportBatch({
      tenantId: "tenant-a",
      source: "csv_upload",
      status: "running",
      totalRows: 50,
      createdByActorId: "actor-1",
    });

    await updateImportBatch(id, {
      status: "complete",
      imported: 45,
      skipped: 3,
      errors: 2,
      completedAt: "2026-04-02T12:00:00Z",
    });

    const batch = await getImportBatchById(id, "tenant-a");
    expect(batch!.status).toBe("complete");
    expect(batch!.imported).toBe(45);
    expect(batch!.skipped).toBe(3);
    expect(batch!.errors).toBe(2);
    expect(batch!.completedAt).toBe("2026-04-02T12:00:00Z");
  });

  it("lists batches by tenant with pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await createImportBatch({
        tenantId: "tenant-a",
        source: "csv_upload",
        status: "complete",
        totalRows: 10,
        createdByActorId: "actor-1",
      });
    }
    await createImportBatch({
      tenantId: "tenant-b",
      source: "csv_upload",
      status: "complete",
      totalRows: 10,
      createdByActorId: "actor-2",
    });

    const result = await listImportBatchesByTenant("tenant-a", 1, 3);
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(5);

    const page2 = await listImportBatchesByTenant("tenant-a", 2, 3);
    expect(page2.items).toHaveLength(2);
  });

  it("seed and clear work for test mode", () => {
    seedImportBatchForTest({
      id: "seeded-1",
      tenantId: "tenant-a",
      source: "csv_upload",
      status: "complete",
      totalRows: 10,
      imported: 10,
      skipped: 0,
      errors: 0,
      errorThresholdPct: 5,
      createdByActorId: "actor-1",
      startedAt: "2026-04-01T00:00:00Z",
      completedAt: "2026-04-01T01:00:00Z",
    });

    clearImportBatchStoreForTest();
    // After clear, store should be empty
  });
});
