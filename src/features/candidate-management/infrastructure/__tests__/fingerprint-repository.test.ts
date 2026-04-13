import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFingerprintsForTest,
  computeFileHash,
  computeIdentityHash,
  computeRowHash,
  isAlreadyProcessed,
  loadRecentFingerprints,
  recordFingerprint,
  seedFingerprintsForTest,
} from "../fingerprint-repository";

describe("FingerprintRepository (in-memory)", () => {
  beforeEach(() => {
    clearFingerprintsForTest();
  });

  // ---------- computeFileHash ----------

  describe("computeFileHash", () => {
    it("returns consistent SHA-256 hex digest for same content", () => {
      const buf = Buffer.from("hello world pdf content");
      const hash1 = computeFileHash(buf);
      const hash2 = computeFileHash(buf);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("returns different hashes for different content", () => {
      const hash1 = computeFileHash(Buffer.from("file-a"));
      const hash2 = computeFileHash(Buffer.from("file-b"));
      expect(hash1).not.toBe(hash2);
    });
  });

  // ---------- computeIdentityHash ----------

  describe("computeIdentityHash", () => {
    it("normalizes email to lowercase and trims", () => {
      const hash1 = computeIdentityHash("John@Example.COM ");
      const hash2 = computeIdentityHash("john@example.com");
      expect(hash1).toBe(hash2);
    });

    it("prefers email over name+phone when email is provided", () => {
      const hashWithEmail = computeIdentityHash("test@example.com", "John", "Doe", "555-1234");
      const hashEmailOnly = computeIdentityHash("test@example.com");
      expect(hashWithEmail).toBe(hashEmailOnly);
    });

    it("falls back to name+phone when no email", () => {
      const hash1 = computeIdentityHash(null, "John", "Doe", "555-1234");
      const hash2 = computeIdentityHash(undefined, "john", "doe", "(555) 123-4");
      expect(hash1).toBe(hash2);
    });

    it("strips non-digit characters from phone", () => {
      const hash1 = computeIdentityHash(null, "Jane", "Smith", "+1 (555) 123-4567");
      const hash2 = computeIdentityHash(null, "jane", "smith", "15551234567");
      expect(hash1).toBe(hash2);
    });
  });

  // ---------- computeRowHash ----------

  describe("computeRowHash", () => {
    it("includes email, name, and phone in hash", () => {
      const hash = computeRowHash("test@example.com", "John", "Doe", "555-1234");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("is case-insensitive", () => {
      const hash1 = computeRowHash("Test@Example.COM", "JOHN", "DOE", "555-1234");
      const hash2 = computeRowHash("test@example.com", "john", "doe", "5551234");
      expect(hash1).toBe(hash2);
    });

    it("handles null/undefined fields gracefully", () => {
      const hash = computeRowHash(null, null, null, null);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ---------- isAlreadyProcessed ----------

  describe("isAlreadyProcessed", () => {
    it("returns false for unknown hash", async () => {
      const result = await isAlreadyProcessed("tenant-a", "file_sha256", "abc123");
      expect(result).toBe(false);
    });

    it("returns true after recordFingerprint with status processed", async () => {
      await recordFingerprint({
        tenantId: "tenant-a",
        type: "file_sha256",
        hash: "abc123",
        source: "resume_upload",
      });

      const result = await isAlreadyProcessed("tenant-a", "file_sha256", "abc123");
      expect(result).toBe(true);
    });

    it("returns false for failed fingerprints (allows retry)", async () => {
      await recordFingerprint({
        tenantId: "tenant-a",
        type: "file_sha256",
        hash: "abc123",
        source: "resume_upload",
        status: "failed",
      });

      const result = await isAlreadyProcessed("tenant-a", "file_sha256", "abc123");
      expect(result).toBe(false);
    });

    it("respects tenant isolation", async () => {
      await recordFingerprint({
        tenantId: "tenant-a",
        type: "file_sha256",
        hash: "abc123",
        source: "resume_upload",
      });

      const resultA = await isAlreadyProcessed("tenant-a", "file_sha256", "abc123");
      const resultB = await isAlreadyProcessed("tenant-b", "file_sha256", "abc123");
      expect(resultA).toBe(true);
      expect(resultB).toBe(false);
    });

    it("respects fingerprint type", async () => {
      await recordFingerprint({
        tenantId: "tenant-a",
        type: "email_message_id",
        hash: "msg-123",
        source: "email",
      });

      const resultEmail = await isAlreadyProcessed("tenant-a", "email_message_id", "msg-123");
      const resultFile = await isAlreadyProcessed("tenant-a", "file_sha256", "msg-123");
      expect(resultEmail).toBe(true);
      expect(resultFile).toBe(false);
    });
  });

  // ---------- recordFingerprint ----------

  describe("recordFingerprint", () => {
    it("stores fingerprint with default processed status", async () => {
      await recordFingerprint({
        tenantId: "tenant-a",
        type: "ats_external_id",
        hash: "ceipal:12345",
        source: "ceipal",
        candidateId: "cand-uuid-1",
      });

      const result = await isAlreadyProcessed("tenant-a", "ats_external_id", "ceipal:12345");
      expect(result).toBe(true);
    });

    it("overwrites failed with processed on re-record", async () => {
      await recordFingerprint({
        tenantId: "tenant-a",
        type: "file_sha256",
        hash: "hash-1",
        source: "resume_upload",
        status: "failed",
      });

      expect(await isAlreadyProcessed("tenant-a", "file_sha256", "hash-1")).toBe(false);

      await recordFingerprint({
        tenantId: "tenant-a",
        type: "file_sha256",
        hash: "hash-1",
        source: "resume_upload",
        status: "processed",
      });

      expect(await isAlreadyProcessed("tenant-a", "file_sha256", "hash-1")).toBe(true);
    });
  });

  // ---------- loadRecentFingerprints ----------

  describe("loadRecentFingerprints", () => {
    it("returns Set with correct hashes for tenant+type", async () => {
      await recordFingerprint({ tenantId: "tenant-a", type: "csv_row_hash", hash: "row-1", source: "csv" });
      await recordFingerprint({ tenantId: "tenant-a", type: "csv_row_hash", hash: "row-2", source: "csv" });
      await recordFingerprint({ tenantId: "tenant-a", type: "file_sha256", hash: "file-1", source: "resume_upload" });
      await recordFingerprint({ tenantId: "tenant-b", type: "csv_row_hash", hash: "row-3", source: "csv" });

      const set = await loadRecentFingerprints("tenant-a", "csv_row_hash");
      expect(set.size).toBe(2);
      expect(set.has("row-1")).toBe(true);
      expect(set.has("row-2")).toBe(true);
      expect(set.has("file-1")).toBe(false);
      expect(set.has("row-3")).toBe(false);
    });

    it("excludes failed fingerprints from set", async () => {
      await recordFingerprint({ tenantId: "tenant-a", type: "csv_row_hash", hash: "row-ok", source: "csv" });
      await recordFingerprint({ tenantId: "tenant-a", type: "csv_row_hash", hash: "row-fail", source: "csv", status: "failed" });

      const set = await loadRecentFingerprints("tenant-a", "csv_row_hash");
      expect(set.has("row-ok")).toBe(true);
      expect(set.has("row-fail")).toBe(false);
    });

    it("returns empty set for no matches", async () => {
      const set = await loadRecentFingerprints("tenant-z", "file_sha256");
      expect(set.size).toBe(0);
    });
  });

  // ---------- seedFingerprintsForTest ----------

  describe("seedFingerprintsForTest", () => {
    it("seeds data that isAlreadyProcessed can find", async () => {
      seedFingerprintsForTest({
        id: 99,
        tenantId: "tenant-a",
        fingerprintType: "email_message_id",
        fingerprintHash: "seeded-msg-id",
        source: "email",
        status: "processed",
        candidateId: null,
        metadata: {},
        createdAt: new Date().toISOString(),
      });

      expect(await isAlreadyProcessed("tenant-a", "email_message_id", "seeded-msg-id")).toBe(true);
    });
  });
});
