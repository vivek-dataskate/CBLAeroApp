-- Story 1.12: Edge System Provider Framework — Database Tables
--
-- Creates three tables for the provider framework:
-- 1. webhook_events     — raw inbound events with dedup, status tracking, dead letter
-- 2. provider_routing_policies — per-channel routing config with kill switch state
-- 3. provider_health_events   — append-only health transition log
--
-- Architecture ref: architecture.md §7, §19, §25
-- Safe to run repeatedly (idempotent via IF NOT EXISTS).

-- ================================================================
-- 1. webhook_events
-- ================================================================
-- Thin receiver writes here; background processor drains.
-- Dedup via UNIQUE(source, provider_event_id).

create table if not exists cblaero_app.webhook_events (
  id              uuid primary key default gen_random_uuid(),
  source          text not null,                        -- e.g. 'clay', 'telnyx', 'instantly'
  event_type      text not null default 'unknown',
  provider_event_id text,                               -- provider's own event ID for dedup
  raw_payload     jsonb not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempt_count   integer not null default 0,
  error_message   text,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz,
  claimed_at      timestamptz,                           -- set when processor claims with FOR UPDATE SKIP LOCKED
  result_meta     jsonb                                  -- handler-returned metadata (candidate_id, bucket_run_id, per-row outcomes)
);

-- Additive: backfill on existing deploys
alter table cblaero_app.webhook_events
  add column if not exists result_meta jsonb;

-- Dedup index: one event per source + provider_event_id (null provider_event_id is excluded)
create unique index if not exists idx_webhook_events_dedup
  on cblaero_app.webhook_events (source, provider_event_id)
  where provider_event_id is not null;

-- Processing drain: pending/failed events ordered by creation
create index if not exists idx_webhook_events_pending
  on cblaero_app.webhook_events (status, created_at)
  where status in ('pending', 'failed');

-- Dead letter monitoring
create index if not exists idx_webhook_events_dead_letter
  on cblaero_app.webhook_events (source, created_at)
  where status = 'dead_letter';

comment on table cblaero_app.webhook_events is
  'Raw inbound webhook events. Thin receiver writes here (<100ms), '
  'background processor drains via FOR UPDATE SKIP LOCKED. '
  'Architecture ref: architecture.md §7, §25.';

-- ================================================================
-- 2. provider_routing_policies
-- ================================================================
-- Per-channel routing: primary/fallback, kill switch mode.

create table if not exists cblaero_app.provider_routing_policies (
  id                  uuid primary key default gen_random_uuid(),
  channel             text not null unique,              -- e.g. 'sms', 'email_campaign', 'llm'
  primary_provider    text not null,                     -- e.g. 'telnyx', 'instantly', 'anthropic'
  fallback_provider   text,                              -- nullable; warm standby
  mode                text not null default 'normal'
                        check (mode in ('normal', 'degraded', 'kill_switched')),
  updated_at          timestamptz not null default now(),
  updated_by_actor_id text,                              -- user who last changed; null = system
  reason              text                               -- why the mode was changed
);

comment on table cblaero_app.provider_routing_policies is
  'Per-channel routing config with kill switch state. '
  'Architecture ref: architecture.md §19.';

-- ================================================================
-- 3. provider_health_events
-- ================================================================
-- Append-only log of health transitions for audit.

create table if not exists cblaero_app.provider_health_events (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null,
  previous_mode   text not null check (previous_mode in ('normal', 'degraded', 'kill_switched')),
  new_mode        text not null check (new_mode in ('normal', 'degraded', 'kill_switched')),
  reason          text not null,
  error_rate      numeric(5,4),                          -- 0.0000 to 1.0000
  attempt_count   integer,
  occurred_at     timestamptz not null default now()
);

-- Query transitions per provider
create index if not exists idx_provider_health_events_provider
  on cblaero_app.provider_health_events (provider, occurred_at);

comment on table cblaero_app.provider_health_events is
  'Append-only health transition log. Records every mode change '
  '(normal → degraded → kill_switched → normal). '
  'Architecture ref: architecture.md §19, §25.';

-- ================================================================
-- 4. RLS Policies
-- ================================================================
-- All three tables are service-role only (no anon/authenticated access).
-- RLS is enabled but no policies are created — this means only
-- service_role key (used by the app) can access the data.

alter table cblaero_app.webhook_events enable row level security;
alter table cblaero_app.provider_routing_policies enable row level security;
alter table cblaero_app.provider_health_events enable row level security;
