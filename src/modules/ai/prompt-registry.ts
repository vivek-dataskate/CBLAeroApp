import { isSupabaseConfigured, getSupabaseAdminClient } from '../persistence';

export type PromptStatus = 'active' | 'staged' | 'deprecated';

export interface PromptRecord {
  name: string;
  version: string;
  prompt_text: string;
  model: string;
  status?: PromptStatus;
}

// In-memory fallback prompts — used when DB is unavailable (tests, no Supabase config)
const fallbackPrompts = new Map<string, PromptRecord>();

// DB prompt cache — avoids per-call DB round-trips in batch paths (dev-standards §19)
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const dbCache = new Map<string, { record: PromptRecord; cachedAt: number }>();

/**
 * Register an inline fallback prompt so loadPrompt works without a DB.
 * Call this at module init for each known prompt.
 */
export function registerFallbackPrompt(record: PromptRecord): void {
  fallbackPrompts.set(record.name, record);
}

/**
 * Load a prompt by name. Optionally pin to a specific version.
 * Tries in-memory cache first (5min TTL), then prompt_registry table, then fallback.
 */
export async function loadPrompt(
  name: string,
  version?: string
): Promise<PromptRecord | null> {
  // Check cache first (unversioned lookups only — pinned versions always hit DB)
  if (!version) {
    const cached = dbCache.get(name);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.record;
    }
  }

  if (isSupabaseConfigured()) {
    try {
      const db = getSupabaseAdminClient();
      let query = db
        .from('prompt_registry')
        .select('name, version, prompt_text, model, status')
        .eq('name', name);

      if (version) {
        // Pinned version: return it unless deprecated
        query = query.eq('version', version).neq('status', 'deprecated');
      } else {
        // Unversioned: only return active prompts (not staged or deprecated)
        query = query.eq('status', 'active').order('created_at', { ascending: false }).limit(1);
      }

      const { data, error } = await query.maybeSingle();
      if (!error && data) {
        if (!data.name || !data.version || !data.prompt_text) {
          console.warn('[ai/prompt-registry] Unexpected row shape from prompt_registry:', Object.keys(data));
          return fallbackPrompts.get(name) ?? null;
        }
        const record: PromptRecord = {
          name: data.name,
          version: data.version,
          prompt_text: data.prompt_text,
          model: data.model,
          status: data.status ?? 'active',
        };
        // Cache unversioned lookups
        if (!version) {
          dbCache.set(name, { record, cachedAt: Date.now() });
        }
        return record;
      }
      // Fall through to fallback on error or no data
    } catch (err) {
      console.warn('[ai/prompt-registry] DB query failed, using fallback:', err instanceof Error ? err.message : err);
    }
  }

  return fallbackPrompts.get(name) ?? null;
}

/**
 * Deprecate a prompt version. Marks it as 'deprecated' so loadPrompt() skips it.
 * Append-only — does not delete; sets status only.
 */
export async function deprecatePrompt(
  name: string,
  version: string
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }

  const db = getSupabaseAdminClient();
  const { error } = await db
    .from('prompt_registry')
    .update({ status: 'deprecated' })
    .eq('name', name)
    .eq('version', version);

  if (error) {
    return { success: false, error: error.message };
  }

  // Invalidate cache for this prompt name
  dbCache.delete(name);

  return { success: true };
}

/**
 * Update prompt status (e.g., 'staged' -> 'active', or 'active' -> 'deprecated').
 */
export async function updatePromptStatus(
  name: string,
  version: string,
  status: PromptStatus
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }

  const db = getSupabaseAdminClient();
  const { error } = await db
    .from('prompt_registry')
    .update({ status })
    .eq('name', name)
    .eq('version', version);

  if (error) {
    return { success: false, error: error.message };
  }

  // Invalidate cache for this prompt name
  dbCache.delete(name);

  return { success: true };
}

/**
 * List all prompt versions for a given prompt name (including deprecated).
 * Returns versions sorted by created_at descending.
 */
export async function listPromptVersions(
  name: string
): Promise<Array<PromptRecord & { status: PromptStatus; created_at: string }>> {
  if (!isSupabaseConfigured()) {
    const fallback = fallbackPrompts.get(name);
    if (fallback) {
      return [{
        ...fallback,
        status: fallback.status ?? 'active',
        created_at: new Date().toISOString(),
      }];
    }
    return [];
  }

  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from('prompt_registry')
    .select('name, version, prompt_text, model, status, created_at')
    .eq('name', name)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list prompt versions: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    name: row.name,
    version: row.version,
    prompt_text: row.prompt_text,
    model: row.model,
    status: (row.status ?? 'active') as PromptStatus,
    created_at: row.created_at,
  }));
}

/** Clear fallback registry and DB cache for test isolation. No-op outside test environment. */
export function clearFallbackPromptsForTest(): void {
  if (process.env.NODE_ENV !== 'test') return;
  fallbackPrompts.clear();
  dbCache.clear();
}
