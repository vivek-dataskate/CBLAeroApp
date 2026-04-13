/**
 * Story 2.5a: Heuristic backfill of deduced_roles for all active candidates.
 *
 * Loads the role taxonomy with aliases, queries candidates in batches of 500
 * where deduced_roles = '[]', runs deduceRolesHeuristic() per candidate,
 * and batch-UPDATEs deduced_roles + role_deduction_metadata.
 *
 * Run: npx tsx scripts/backfill-deduced-roles.ts [--dry-run]
 * Estimated runtime: ~20-30 min for ~731K candidates. No LLM cost.
 * Idempotent — running twice overwrites previous heuristic results.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.CBL_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.CBL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TENANT_ID = "cbl-aero";
const BATCH_SIZE = 500;

const dryRun = process.argv.includes("--dry-run");

type RoleTaxonomyEntry = {
  id: number;
  tenantId: string;
  roleName: string;
  category: "aviation" | "it" | "other";
  aliases: string[];
  isActive: boolean;
};

// Heuristic role deduction (copied from application module for standalone script)
function deduceRolesHeuristic(
  jobTitle: string | null,
  skills: string[],
  taxonomy: RoleTaxonomyEntry[],
): { roles: string[]; confidence: number } {
  if (!jobTitle && skills.length === 0) return { roles: [], confidence: 0 };

  const normalizedTitle = (jobTitle ?? "").toLowerCase().trim();
  const matches: Array<{ roleName: string; confidence: number }> = [];

  for (const entry of taxonomy) {
    if (normalizedTitle === entry.roleName.toLowerCase()) {
      matches.push({ roleName: entry.roleName, confidence: 1.0 });
      continue;
    }
    const aliasMatch = entry.aliases.some((alias) => {
      const na = alias.toLowerCase();
      return normalizedTitle === na || normalizedTitle.includes(na);
    });
    if (aliasMatch) {
      matches.push({ roleName: entry.roleName, confidence: 0.9 });
      continue;
    }
    const nrn = entry.roleName.toLowerCase();
    if (normalizedTitle.length >= 3 && (normalizedTitle.includes(nrn) || nrn.includes(normalizedTitle))) {
      matches.push({ roleName: entry.roleName, confidence: 0.7 });
      continue;
    }
    if (normalizedTitle.length >= 3) {
      const titleWords = new Set(normalizedTitle.split(/[\s/,&()-]+/).filter((w) => w.length > 2));
      const roleWords = nrn.split(/[\s/,&()-]+/).filter((w) => w.length > 2);
      const overlap = roleWords.filter((w) => titleWords.has(w)).length;
      if (overlap >= 2 || (roleWords.length <= 2 && overlap >= 1)) {
        matches.push({ roleName: entry.roleName, confidence: Math.min(0.6, 0.3 * overlap) });
        continue;
      }
    }
    if (skills.length > 0) {
      const rnl = entry.roleName.toLowerCase();
      if (skills.some((s) => { const sl = s.toLowerCase(); return rnl.includes(sl) || sl.includes(rnl); })) {
        matches.push({ roleName: entry.roleName, confidence: 0.5 });
      }
    }
  }

  const deduped = new Map<string, number>();
  for (const m of matches) {
    const existing = deduped.get(m.roleName) ?? 0;
    if (m.confidence > existing) deduped.set(m.roleName, m.confidence);
  }

  const sorted = [...deduped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (sorted.length === 0) return { roles: [], confidence: 0 };
  return { roles: sorted.map(([name]) => name), confidence: sorted[0][1] };
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    db: { schema: "cblaero_app" },
  });

  console.log(`[BackfillRoles] Starting${dryRun ? " (DRY RUN)" : ""}...`);

  // Load taxonomy
  const { data: taxonomyRows, error: taxError } = await db
    .from("role_taxonomy")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .eq("is_active", true);

  if (taxError) {
    console.error("Failed to load taxonomy:", taxError.message);
    process.exit(1);
  }

  const taxonomy: RoleTaxonomyEntry[] = (taxonomyRows ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as number,
    tenantId: r.tenant_id as string,
    roleName: r.role_name as string,
    category: r.category as "aviation" | "it" | "other",
    aliases: Array.isArray(r.aliases) ? r.aliases as string[] : [],
    isActive: r.is_active as boolean,
  }));

  console.log(`[BackfillRoles] Loaded ${taxonomy.length} taxonomy entries`);

  let totalProcessed = 0;
  let totalRolesAssigned = 0;
  let totalEmpty = 0;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: candidates, error: fetchError } = await db
      .from("candidates")
      .select("id, job_title, skills")
      .eq("ingestion_state", "active")
      .eq("deduced_roles", "[]")
      .range(offset, offset + BATCH_SIZE - 1);

    if (fetchError) {
      console.error(`[BackfillRoles] Fetch error at offset ${offset}:`, fetchError.message);
      break;
    }

    if (!candidates || candidates.length === 0) {
      hasMore = false;
      break;
    }

    // Compute heuristic roles for all candidates in batch
    const updates: Array<{ id: string; deduced_roles: string[]; role_deduction_metadata: Record<string, unknown> }> = [];
    for (const c of candidates) {
      const skills = Array.isArray(c.skills) ? c.skills.filter((s: unknown): s is string => typeof s === "string") : [];
      const result = deduceRolesHeuristic(c.job_title, skills, taxonomy);

      updates.push({
        id: c.id,
        deduced_roles: result.roles,
        role_deduction_metadata: {
          source: "heuristic",
          confidence: result.confidence,
          rawJobTitle: c.job_title,
          rawSkills: skills,
          deducedAt: new Date().toISOString(),
        },
      });

      totalProcessed++;
      if (result.roles.length > 0) totalRolesAssigned++;
      else totalEmpty++;
    }

    // Batch update via RPC (1 round-trip per 500 candidates instead of 500)
    if (!dryRun && updates.length > 0) {
      const { error: rpcError } = await db.rpc("batch_update_deduced_roles", {
        p_updates: updates,
      });
      if (rpcError) {
        console.error(`[BackfillRoles] Batch update failed at offset ${offset}:`, rpcError.message);
        // Fallback to per-row updates
        for (const u of updates) {
          const { error: updateError } = await db
            .from("candidates")
            .update({ deduced_roles: u.deduced_roles, role_deduction_metadata: u.role_deduction_metadata })
            .eq("id", u.id);
          if (updateError) console.error(`[BackfillRoles] Row update failed for ${u.id}:`, updateError.message);
        }
      }
    }

    offset += candidates.length;

    if (totalProcessed % 1000 === 0 || candidates.length < BATCH_SIZE) {
      console.log(`[BackfillRoles] Progress: ${totalProcessed} processed, ${totalRolesAssigned} assigned, ${totalEmpty} empty`);
    }

    if (candidates.length < BATCH_SIZE) hasMore = false;
  }

  console.log(`[BackfillRoles] Complete: ${totalProcessed} processed, ${totalRolesAssigned} roles assigned, ${totalEmpty} no match`);
}

main().catch(console.error);
