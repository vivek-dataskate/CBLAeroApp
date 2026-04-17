/**
 * Re-export of `CeipalApplicant` for back-compat.
 *
 * Review patch L-4: canonical home is now
 * `src/modules/providers/ceipal/types.ts`. New callers should import from
 * there; this re-export keeps legacy imports of
 * `@/modules/ats/ceipal-types` working.
 */
export type { CeipalApplicant } from '@/modules/providers/ceipal/types';
