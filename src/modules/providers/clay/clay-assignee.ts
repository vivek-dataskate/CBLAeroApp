/**
 * Clay default-assignee resolver with 1-hour TTL cache.
 *
 * Extracted from the legacy inline implementation in
 * `src/app/api/webhooks/clay/route.ts` (Story 2.8). The Clay webhook does not
 * carry a recruiter identity — every row is stamped to the configured
 * `CLAY_DEFAULT_ASSIGNEE_EMAIL` via `source_recruiter_actor_id`.
 *
 * TTL-caching balances staleness tolerance with webhook latency overhead.
 * Errors are NOT cached (so a transient Supabase blip doesn't poison the
 * cache) — except the "env var not set" case, which is a configuration error
 * that only goes away with a redeploy.
 */
import { getSupabaseAdminClient, isSupabaseConfigured } from '@/modules/persistence';
import { DEFAULT_TENANT_ID } from '@/modules/ingestion';

const ASSIGNEE_CACHE_TTL_MS = 60 * 60 * 1000;
// Review patch M-14: errors were cached without a TTL, so a transient
// configuration blip (operator hadn't yet provisioned the user) permanently
// bricked the route until redeploy. Now errors expire after 5 minutes, so
// fixing the underlying issue auto-recovers without restart.
const ASSIGNEE_ERROR_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedAssigneeUserId: string | null = null;
let cachedAssigneeUserIdAt: number = 0;
let cachedAssigneeError: string | null = null;
let cachedAssigneeErrorAt: number = 0;

export async function resolveDefaultAssignee(): Promise<{ userId: string | null; error: string | null }> {
  const now = Date.now();
  if (cachedAssigneeUserId && now - cachedAssigneeUserIdAt < ASSIGNEE_CACHE_TTL_MS) {
    return { userId: cachedAssigneeUserId, error: null };
  }
  if (cachedAssigneeError && now - cachedAssigneeErrorAt < ASSIGNEE_ERROR_CACHE_TTL_MS) {
    return { userId: null, error: cachedAssigneeError };
  }
  // TTL expired — clear and re-resolve below.
  cachedAssigneeError = null;

  const email = process.env.CLAY_DEFAULT_ASSIGNEE_EMAIL;
  if (!email) {
    cachedAssigneeError = 'CLAY_DEFAULT_ASSIGNEE_EMAIL env var is not set';
    cachedAssigneeErrorAt = now;
    return { userId: null, error: cachedAssigneeError };
  }

  if (!isSupabaseConfigured()) {
    // Test/dev mode — synthetic ID so the pipeline still runs.
    cachedAssigneeUserId = `test-assignee:${email}`;
    cachedAssigneeUserIdAt = now;
    return { userId: cachedAssigneeUserId, error: null };
  }

  try {
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from('admin_managed_users')
      .select('actor_id')
      .eq('tenant_id', DEFAULT_TENANT_ID)
      .eq('email', email)
      .maybeSingle();

    if (error) {
      return { userId: null, error: `Failed to query assignee user: ${error.message}` };
    }
    if (!data?.actor_id) {
      cachedAssigneeError =
        `Assignee user ${email} not found in tenant ${DEFAULT_TENANT_ID}. ` +
        `Provision via admin console (Story 1.4); route auto-recovers within 5 min.`;
      cachedAssigneeErrorAt = now;
      return { userId: null, error: cachedAssigneeError };
    }
    cachedAssigneeUserId = data.actor_id as string;
    cachedAssigneeUserIdAt = now;
    return { userId: cachedAssigneeUserId, error: null };
  } catch (e) {
    return {
      userId: null,
      error: `Assignee resolution transport error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Test hook — clear the cached assignee so unit tests can rerun resolution. */
export function resetClayAssigneeCacheForTests(): void {
  cachedAssigneeUserId = null;
  cachedAssigneeUserIdAt = 0;
  cachedAssigneeError = null;
  cachedAssigneeErrorAt = 0;
}
