-- Story 3-1 PR 2: Routing-policy seed for the SMS channel.
--
-- AC 8 requires a `provider_routing_policies` row for `channel='sms'` so
-- the admin kill-switch UI can flip mode for the SMS stub (and later Telnyx
-- in Story 3-1b) without first manually creating the row.
--
-- `primary_provider='sms-stub'` today. Story 3-1b swaps in `telnyx` with a
-- tiny update migration + a provider registration in `ensureProvidersInitialized`.
--
-- Idempotent via `ON CONFLICT (channel) DO NOTHING` so re-runs never
-- overwrite a mode flip an operator has already made. Mirrors the pattern
-- set by 2026-04-17-story-1-12a-clay-ceipal-routing-seed.sql.

insert into cblaero_app.provider_routing_policies
  (channel, primary_provider, fallback_provider, mode, reason)
values
  ('sms', 'sms-stub', null, 'normal', 'Seed from story 3-1 PR 2 (Task 3)')
on conflict (channel) do nothing;
