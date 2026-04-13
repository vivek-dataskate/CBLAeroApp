/**
 * Story 2.5a: LLM validation batch — compare heuristic vs LLM role deduction.
 *
 * Selects 1000 random candidates that already have heuristic-assigned deduced_roles,
 * runs deduceRolesLlm() per candidate in batches of 20 with 500ms inter-batch delay,
 * and outputs an accuracy report: agreement %, disagreements, new IT roles.
 *
 * Run: npx tsx scripts/test-role-deduction-llm.ts
 * Run AFTER backfill-deduced-roles.ts. Estimated cost: ~$1-2 on Haiku for 1K records.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TENANT_ID = "cbl-aero";
const LLM_BATCH_SIZE = 20;
const TOTAL_SAMPLE = 1000;
const INTER_BATCH_DELAY_MS = 500;

// Dynamic import of the application module (requires build or tsx runtime)
async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  // Import application modules (requires tsx/ts-node with path aliases)
  const { deduceRolesLlm } = await import(
    "../src/features/candidate-management/application/role-deduction"
  );
  const { getAllRoles } = await import(
    "../src/features/candidate-management/infrastructure/role-taxonomy-repository"
  );

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    db: { schema: "cblaero_app" },
  });

  console.log("[LLMValidation] Loading taxonomy...");
  const taxonomy = await getAllRoles(TENANT_ID);
  console.log(`[LLMValidation] Loaded ${taxonomy.length} taxonomy entries`);

  // Select random candidates with existing heuristic deduced_roles
  console.log(`[LLMValidation] Fetching ${TOTAL_SAMPLE} random classified candidates...`);
  const { data: candidates, error } = await db
    .from("candidates")
    .select("id, job_title, skills, certifications, aircraft_experience, deduced_roles, role_deduction_metadata")
    .neq("deduced_roles", "[]")
    .eq("ingestion_state", "active")
    .limit(TOTAL_SAMPLE);

  if (error) {
    console.error("Failed to fetch candidates:", error.message);
    process.exit(1);
  }

  if (!candidates || candidates.length === 0) {
    console.log("[LLMValidation] No classified candidates found. Run backfill first.");
    process.exit(0);
  }

  console.log(`[LLMValidation] Processing ${candidates.length} candidates in batches of ${LLM_BATCH_SIZE}...`);

  let agreements = 0;
  let disagreements = 0;
  let llmErrors = 0;
  const newItRoles = new Set<string>();
  const disagreementDetails: Array<{
    id: string;
    jobTitle: string | null;
    heuristic: string[];
    llm: string[];
  }> = [];

  for (let i = 0; i < candidates.length; i += LLM_BATCH_SIZE) {
    const batch = candidates.slice(i, i + LLM_BATCH_SIZE);

    for (const c of batch) {
      try {
        const llmRoles = await deduceRolesLlm(
          c.job_title,
          Array.isArray(c.skills) ? c.skills.filter((s: unknown): s is string => typeof s === "string") : [],
          Array.isArray(c.certifications) ? c.certifications : [],
          Array.isArray(c.aircraft_experience) ? c.aircraft_experience : [],
          taxonomy,
          TENANT_ID,
        );

        const heuristicRoles = Array.isArray(c.deduced_roles) ? c.deduced_roles as string[] : [];
        const hSet = new Set(heuristicRoles.map((r: string) => r.toLowerCase()));
        const lSet = new Set(llmRoles.map((r: string) => r.toLowerCase()));

        // Check if at least one role overlaps
        const hasOverlap = [...hSet].some((r) => lSet.has(r));
        if (hasOverlap || (heuristicRoles.length === 0 && llmRoles.length === 0)) {
          agreements++;
        } else {
          disagreements++;
          disagreementDetails.push({
            id: c.id,
            jobTitle: c.job_title,
            heuristic: heuristicRoles,
            llm: llmRoles,
          });
        }

        // Track new IT roles (not in taxonomy)
        for (const role of llmRoles) {
          if (!taxonomy.some((t) => t.roleName.toLowerCase() === role.toLowerCase())) {
            newItRoles.add(role);
          }
        }
      } catch (err) {
        llmErrors++;
        console.error(`[LLMValidation] Error on ${c.id}:`, err instanceof Error ? err.message : err);
      }
    }

    const progress = Math.min(i + LLM_BATCH_SIZE, candidates.length);
    console.log(`[LLMValidation] Progress: ${progress}/${candidates.length}`);

    if (i + LLM_BATCH_SIZE < candidates.length) {
      await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
    }
  }

  // Output report
  const total = agreements + disagreements;
  console.log("\n=== LLM vs Heuristic Accuracy Report ===");
  console.log(`Total compared: ${total}`);
  console.log(`Agreements: ${agreements} (${total > 0 ? ((agreements / total) * 100).toFixed(1) : 0}%)`);
  console.log(`Disagreements: ${disagreements} (${total > 0 ? ((disagreements / total) * 100).toFixed(1) : 0}%)`);
  console.log(`LLM errors: ${llmErrors}`);
  console.log(`New IT roles suggested by LLM: ${newItRoles.size}`);
  if (newItRoles.size > 0) {
    console.log("  ", [...newItRoles].join(", "));
  }
  if (disagreementDetails.length > 0) {
    console.log(`\nSample disagreements (first 20):`);
    for (const d of disagreementDetails.slice(0, 20)) {
      console.log(`  ${d.id}: "${d.jobTitle}" → heuristic=[${d.heuristic.join(",")}] llm=[${d.llm.join(",")}]`);
    }
  }
}

main().catch(console.error);
