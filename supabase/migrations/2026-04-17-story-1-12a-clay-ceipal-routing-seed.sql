-- Story 1.12a Task 4: Routing-policy seed for Clay + Ceipal
--
-- Inserts the initial routing policies for the two providers migrated in
-- Story 1-12a. Idempotent via `ON CONFLICT (channel) DO NOTHING` so re-runs
-- (local dev resets, multi-environment migrations) are safe and never
-- overwrite a mode that operators have manually flipped.
--
-- The ProviderRegistry reads these rows at startup and restores `mode`
-- in-memory (kill-switch survives restarts, health counters do not —
-- that's by design per architecture.md §19).
--
-- Channels:
--   - enrichment: inbound Clay webhook + outbound Clay API → primary 'clay'
--   - ats:        outbound Ceipal applicant polling           → primary 'ceipal'
--
-- Architecture ref: architecture.md §19, §25
-- Safe to run repeatedly.

insert into cblaero_app.provider_routing_policies
  (channel, primary_provider, fallback_provider, mode, reason)
values
  ('enrichment', 'clay',   null, 'normal', 'Seed from story 1-12a task 4'),
  ('ats',        'ceipal', null, 'normal', 'Seed from story 1-12a task 4')
on conflict (channel) do nothing;
