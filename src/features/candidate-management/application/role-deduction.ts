import { callLlm } from '@/modules/ai/inference';
import { loadPrompt, registerFallbackPrompt } from '@/modules/ai/prompt-registry';
import {
  getAllRoles,
  insertRole,
  type RoleTaxonomyEntry,
} from '../infrastructure/role-taxonomy-repository';
import { recordSyncFailure } from '@/modules/ingestion';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export type RoleDeductionMetadata = {
  source: 'heuristic' | 'llm' | 'manual';
  confidence: number;
  rawJobTitle: string | null;
  rawSkills: string[];
  deducedAt: string;
};

type HeuristicResult = {
  roles: string[];
  confidence: number;
};

type DeduceRolesResult = {
  roles: string[];
  metadata: RoleDeductionMetadata;
};

type DeduceRolesOptions = {
  heuristicOnly?: boolean;
};

// -----------------------------------------------------------------------
// LLM Prompt
// -----------------------------------------------------------------------

const ROLE_DEDUCTION_PROMPT = `You are a role classification expert for the aviation and IT staffing industry.

Given a candidate's job title, skills, certifications, and aircraft experience, classify them into standardized roles.

## Rules
1. Return UP TO 3 roles maximum, sorted by relevance.
2. For AVIATION candidates: You MUST pick roles EXACTLY from the provided taxonomy list. Do not invent new aviation role names.
3. For IT candidates: Prefer existing roles from the taxonomy. Only create a new role name if nothing in the taxonomy fits.
4. If a candidate has both aviation and IT experience, include roles from both categories.
5. Be specific — prefer "A&P Mechanic" over generic "Mechanic".
6. Return ONLY a JSON object with a "roles" key containing an array of role name strings.

## Taxonomy
{{TAXONOMY}}

## Output Format
Return ONLY valid JSON:
{"roles": ["Role Name 1", "Role Name 2"]}`;

registerFallbackPrompt({
  name: 'role-deduction',
  version: '1.0.0',
  prompt_text: ROLE_DEDUCTION_PROMPT,
  model: 'claude-haiku-4-5-20251001',
});

// -----------------------------------------------------------------------
// Heuristic role deduction (fast, free)
// -----------------------------------------------------------------------

export function deduceRolesHeuristic(
  jobTitle: string | null,
  skills: string[],
  taxonomy: RoleTaxonomyEntry[],
): HeuristicResult {
  if (!jobTitle && skills.length === 0) {
    return { roles: [], confidence: 0 };
  }

  const normalizedTitle = (jobTitle ?? '').toLowerCase().trim();
  const matches: Array<{ roleName: string; confidence: number }> = [];

  for (const entry of taxonomy) {
    // 1. Exact role_name match (case-insensitive)
    if (normalizedTitle === entry.roleName.toLowerCase()) {
      matches.push({ roleName: entry.roleName, confidence: 1.0 });
      continue;
    }

    // 2. Alias containment match
    const aliasMatch = entry.aliases.some((alias) => {
      const normalizedAlias = alias.toLowerCase();
      return normalizedTitle === normalizedAlias || normalizedTitle.includes(normalizedAlias);
    });
    if (aliasMatch) {
      matches.push({ roleName: entry.roleName, confidence: 0.9 });
      continue;
    }

    // 3. Title contains role name or role name contains title (substring match)
    const normalizedRoleName = entry.roleName.toLowerCase();
    if (
      normalizedTitle.length >= 3 &&
      (normalizedTitle.includes(normalizedRoleName) || normalizedRoleName.includes(normalizedTitle))
    ) {
      matches.push({ roleName: entry.roleName, confidence: 0.7 });
      continue;
    }

    // 4. Word overlap scoring (lighter than trigram, works JS-side)
    if (normalizedTitle.length >= 3) {
      const titleWords = new Set(normalizedTitle.split(/[\s/,&()-]+/).filter((w) => w.length > 2));
      const roleWords = normalizedRoleName.split(/[\s/,&()-]+/).filter((w) => w.length > 2);
      const overlap = roleWords.filter((w) => titleWords.has(w)).length;
      if (overlap >= 2 || (roleWords.length <= 2 && overlap >= 1)) {
        const confidence = Math.min(0.6, 0.3 * overlap);
        matches.push({ roleName: entry.roleName, confidence });
        continue;
      }
    }

    // 5. Skills keyword intersection
    if (skills.length > 0) {
      const roleNameLower = entry.roleName.toLowerCase();
      const skillMatch = skills.some((skill) => {
        const s = skill.toLowerCase();
        return roleNameLower.includes(s) || s.includes(roleNameLower);
      });
      if (skillMatch) {
        matches.push({ roleName: entry.roleName, confidence: 0.5 });
      }
    }
  }

  // Deduplicate by role name, keeping highest confidence
  const deduped = new Map<string, number>();
  for (const m of matches) {
    const existing = deduped.get(m.roleName) ?? 0;
    if (m.confidence > existing) {
      deduped.set(m.roleName, m.confidence);
    }
  }

  // Sort by confidence desc, take top 3
  const sorted = [...deduped.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (sorted.length === 0) {
    return { roles: [], confidence: 0 };
  }

  return {
    roles: sorted.map(([name]) => name),
    confidence: sorted[0][1],
  };
}

// -----------------------------------------------------------------------
// LLM role deduction (accurate, ~$0.001/candidate)
// -----------------------------------------------------------------------

// Max input length for LLM calls (§2 — control cost and prevent context overflow)
const MAX_LLM_INPUT_CHARS = 10_000;

// Strip HTML tags and decode common entities (§2 — Input Safety)
function sanitizeLlmInput(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// In-memory taxonomy lookup by name (case-insensitive) — avoids N+1 DB queries (H2/H6 fix)
function findRoleInTaxonomy(taxonomy: RoleTaxonomyEntry[], roleName: string): RoleTaxonomyEntry | undefined {
  const lower = roleName.toLowerCase();
  return taxonomy.find((t) => t.roleName.toLowerCase() === lower);
}

export async function deduceRolesLlm(
  jobTitle: string | null,
  skills: string[],
  certifications: unknown[],
  aircraftExperience: unknown[],
  taxonomy: RoleTaxonomyEntry[],
  tenantId: string,
): Promise<string[]> {
  const taxonomyList = taxonomy.map((t) => `- ${t.roleName} (${t.category})`).join('\n');

  const promptRecord = await loadPrompt('role-deduction');
  const model = promptRecord?.model ?? 'claude-haiku-4-5-20251001';
  const promptText = (promptRecord?.prompt_text ?? ROLE_DEDUCTION_PROMPT).replace(
    '{{TAXONOMY}}',
    taxonomyList,
  );

  // Sanitize and truncate input (§2 — Input Safety)
  const rawCandidate = JSON.stringify({
    jobTitle: sanitizeLlmInput(jobTitle ?? ''),
    skills: skills.map(sanitizeLlmInput),
    certifications,
    aircraftExperience,
  });
  const candidateText = rawCandidate.slice(0, MAX_LLM_INPUT_CHARS);

  const result = await callLlm(model, promptText, candidateText, {
    module: 'role-deduction',
    action: 'deduce_roles',
    promptName: 'role-deduction',
    promptVersion: promptRecord?.version ?? '1.0.0',
    maxTokens: 512,
  });

  if (!result) return [];

  // Parse JSON response
  let parsed: Record<string, unknown>;
  try {
    const text = result.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    parsed = JSON.parse(text);
  } catch {
    console.error('[RoleDeduction] Failed to parse LLM response:', result.text.slice(0, 200));
    return [];
  }

  // Key-whitelist sanitize to 'roles' only
  if (!Array.isArray(parsed.roles)) {
    console.error('[RoleDeduction] LLM response missing roles array');
    return [];
  }

  const rawRoles = (parsed.roles as unknown[])
    .filter((r): r is string => typeof r === 'string' && r.length <= 200)
    .slice(0, 3);

  // Validate each role against in-memory taxonomy; insert new IT roles if needed
  const validatedRoles: string[] = [];
  for (const roleName of rawRoles) {
    const existing = findRoleInTaxonomy(taxonomy, roleName);
    if (existing) {
      validatedRoles.push(existing.roleName); // Use canonical name from taxonomy
    } else {
      // Aviation roles must come from taxonomy — never create new ones
      const isAviationContext = taxonomy.some(
        (t) => t.category === 'aviation' && t.roleName.toLowerCase() === roleName.toLowerCase(),
      );
      if (!isAviationContext) {
        // Insert as new IT role (upsert handles concurrent inserts)
        try {
          const newRole = await insertRole(tenantId, roleName, 'it');
          validatedRoles.push(newRole.roleName);
        } catch (err) {
          console.error(
            `[RoleDeduction] Failed to insert IT role "${roleName}":`,
            err instanceof Error ? err.message : err,
          );
          recordSyncFailure('role-deduction', `insert-role:${roleName}`, err instanceof Error ? err : new Error(String(err)));
        }
      }
    }
  }

  return validatedRoles;
}

// -----------------------------------------------------------------------
// Orchestrator
// -----------------------------------------------------------------------

export async function deduceRoles(
  candidate: {
    jobTitle?: string | null;
    skills?: string[] | unknown[];
    certifications?: unknown[];
    aircraftExperience?: unknown[];
  },
  tenantId: string,
  options?: DeduceRolesOptions,
): Promise<DeduceRolesResult> {
  const jobTitle = candidate.jobTitle ?? null;
  const skills = (candidate.skills ?? [])
    .filter((s): s is string => typeof s === 'string');
  const certifications = candidate.certifications ?? [];
  const aircraftExperience = candidate.aircraftExperience ?? [];

  const taxonomy = await getAllRoles(tenantId);

  // Try heuristic first
  const heuristic = deduceRolesHeuristic(jobTitle, skills, taxonomy);

  if (heuristic.roles.length > 0 && heuristic.confidence >= 0.5) {
    return {
      roles: heuristic.roles,
      metadata: {
        source: 'heuristic',
        confidence: heuristic.confidence,
        rawJobTitle: jobTitle,
        rawSkills: skills,
        deducedAt: new Date().toISOString(),
      },
    };
  }

  // Fall back to LLM unless heuristicOnly mode (CSV batch)
  if (options?.heuristicOnly) {
    return {
      roles: heuristic.roles,
      metadata: {
        source: 'heuristic',
        confidence: heuristic.confidence,
        rawJobTitle: jobTitle,
        rawSkills: skills,
        deducedAt: new Date().toISOString(),
      },
    };
  }

  // H10 fix: wrap LLM call in try/catch — degrade gracefully to heuristic on failure (§26)
  let llmRoles: string[] = [];
  try {
    llmRoles = await deduceRolesLlm(
      jobTitle,
      skills,
      certifications,
      aircraftExperience,
      taxonomy,
      tenantId,
    );
  } catch (err) {
    console.error('[RoleDeduction] LLM fallback failed, using heuristic result:', err instanceof Error ? err.message : err);
  }

  return {
    roles: llmRoles.length > 0 ? llmRoles : heuristic.roles,
    metadata: {
      source: llmRoles.length > 0 ? 'llm' : 'heuristic',
      confidence: llmRoles.length > 0 ? 0.85 : heuristic.confidence,
      rawJobTitle: jobTitle,
      rawSkills: skills,
      deducedAt: new Date().toISOString(),
    },
  };
}
