/**
 * Story 2.5: One-time backfill of candidate_identity fingerprints for all active candidates.
 *
 * Without this, the dedup worker has nothing to match against.
 * Run: npx tsx scripts/backfill-identity-fingerprints.ts [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TENANT_ID = "cbl-aero";
const BATCH_SIZE = 500;

const dryRun = process.argv.includes("--dry-run");

function computeIdentityHash(
  email?: string | null,
  firstName?: string | null,
  lastName?: string | null,
  phone?: string | null,
): string {
  if (email) {
    return createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
  }
  const namePart = `${(firstName ?? "").toLowerCase().trim()}${(lastName ?? "").toLowerCase().trim()}`;
  const phonePart = (phone ?? "").replace(/\D/g, "");
  if (!namePart && !phonePart) return "";
  return createHash("sha256").update(`${namePart}|${phonePart}`).digest("hex");
}

async function main() {
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    db: { schema: "cblaero_app" },
  });

  console.log(`[Backfill] Starting candidate_identity fingerprint backfill (dry-run=${dryRun})`);

  // Count total candidates to process
  const { count } = await db
    .from("candidates")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID)
    .in("ingestion_state", ["active", "pending_dedup", "pending_enrichment"]);

  console.log(`[Backfill] Found ${count} candidates to process`);

  let offset = 0;
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalRecorded = 0;

  while (true) {
    const { data: candidates, error } = await db
      .from("candidates")
      .select("id, email, first_name, last_name, phone")
      .eq("tenant_id", TENANT_ID)
      .in("ingestion_state", ["active", "pending_dedup", "pending_enrichment"])
      .order("id")
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error(`[Backfill] Query error at offset ${offset}:`, error.message);
      break;
    }
    if (!candidates || candidates.length === 0) break;

    const fingerprintRows: Array<{
      tenant_id: string;
      fingerprint_type: string;
      fingerprint_hash: string;
      source: string;
      candidate_id: string;
      metadata: Record<string, unknown>;
      status: string;
    }> = [];

    for (const c of candidates) {
      const hash = computeIdentityHash(c.email, c.first_name, c.last_name, c.phone);
      if (!hash) {
        totalSkipped++;
        continue;
      }
      fingerprintRows.push({
        tenant_id: TENANT_ID,
        fingerprint_type: "candidate_identity",
        fingerprint_hash: hash,
        source: "dedup",
        candidate_id: c.id,
        metadata: {},
        status: "processed",
      });
    }

    if (fingerprintRows.length > 0 && !dryRun) {
      const { error: upsertErr } = await db
        .from("content_fingerprints")
        .upsert(fingerprintRows, {
          onConflict: "tenant_id,fingerprint_type,fingerprint_hash",
          ignoreDuplicates: true,
        });

      if (upsertErr) {
        console.error(`[Backfill] Upsert error at offset ${offset}:`, upsertErr.message);
      } else {
        totalRecorded += fingerprintRows.length;
      }
    } else if (dryRun) {
      totalRecorded += fingerprintRows.length;
    }

    totalProcessed += candidates.length;
    offset += BATCH_SIZE;

    if (totalProcessed % 2000 === 0 || candidates.length < BATCH_SIZE) {
      console.log(`[Backfill] Progress: ${totalProcessed}/${count} processed, ${totalRecorded} recorded, ${totalSkipped} skipped (no hash)`);
    }
  }

  console.log(`[Backfill] Complete: ${totalProcessed} candidates processed, ${totalRecorded} fingerprints ${dryRun ? "would be" : ""} recorded, ${totalSkipped} skipped`);
}

main().catch((err) => {
  console.error("[Backfill] Fatal error:", err);
  process.exit(1);
});
