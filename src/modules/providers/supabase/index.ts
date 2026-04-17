/**
 * Supabase health-provider module — Story 1.12c.
 *
 * Supabase is the one provider in the framework that is NOT wrapped in
 * `BaseProviderClient`. The SDK handles HTTP, retries, connection pooling;
 * we only care about health observability. See `supabase-health-provider.ts`
 * for the rationale.
 */
export {
  SupabaseHealthProvider,
  setSharedSupabaseHealthProvider,
  getSharedSupabaseHealthProvider,
  resetSharedSupabaseHealthProviderForTest,
  reportSupabaseDbSuccess,
  reportSupabaseDbFailure,
} from './supabase-health-provider';
export type { SupabaseHealthProviderConfig } from './supabase-health-provider';
