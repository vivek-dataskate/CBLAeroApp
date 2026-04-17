-- CBLAero Supabase/Postgres schema bootstrap (consolidated from live DB state)
-- Run in Supabase SQL Editor on a fresh database.
-- Migration history lives in supabase/migrations/ (append-only).
-- schema.sql reflects current DB state only. After writing a migration, update this file.
-- Source of truth: live DB (Supabase project nnmtsmivhmufjzqlfvbg, schema cblaero_app).

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;
create extension if not exists vector;

-- ============================================================
-- Schema
-- ============================================================
create schema if not exists cblaero_app;

-- ============================================================
-- Sequences (standalone, not owned by identity columns)
-- ============================================================
create sequence if not exists cblaero_app.role_taxonomy_id_seq as integer;

-- ============================================================
-- Tables
-- ============================================================

create table if not exists cblaero_app.admin_invitations (
  invitation_id text not null,
  tenant_id text not null,
  email text not null,
  role text not null,
  team_ids text[] not null default '{}'::text[],
  invited_by_actor_id text not null,
  status text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  constraint admin_invitations_pkey PRIMARY KEY (invitation_id),
  constraint admin_invitations_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'recruiter'::text, 'delivery-head'::text, 'compliance-officer'::text]))),
  constraint admin_invitations_status_check CHECK ((status = 'pending'::text))
);

create index if not exists idx_admin_invitations_tenant_created ON cblaero_app.admin_invitations USING btree (tenant_id, created_at DESC);
create UNIQUE index if not exists uq_admin_invitations_pending ON cblaero_app.admin_invitations USING btree (tenant_id, email) WHERE (status = 'pending'::text);

create table if not exists cblaero_app.admin_managed_users (
  actor_id text not null,
  tenant_id text not null,
  email text not null,
  role text not null,
  team_ids text[] not null default '{}'::text[],
  invited_at timestamptz not null,
  last_seen_at timestamptz not null,
  updated_at timestamptz not null,
  constraint admin_managed_users_pkey PRIMARY KEY (actor_id),
  constraint admin_managed_users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'recruiter'::text, 'delivery-head'::text, 'compliance-officer'::text])))
);

create index if not exists idx_admin_managed_users_tenant ON cblaero_app.admin_managed_users USING btree (tenant_id, email);
create UNIQUE index if not exists uq_admin_managed_users_tenant_email ON cblaero_app.admin_managed_users USING btree (tenant_id, email);

create table if not exists cblaero_app.audit_admin_actions (
  id bigint generated always as identity not null,
  trace_id text not null,
  actor_id text not null,
  tenant_id text not null,
  target_actor_id text,
  action_type text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint audit_admin_actions_pkey PRIMARY KEY (id),
  constraint audit_admin_actions_action_type_check CHECK ((action_type = ANY (ARRAY['invite_user'::text, 'assign_role'::text, 'update_team_membership'::text])))
);

create index if not exists idx_audit_admin_actions_occurred_at ON cblaero_app.audit_admin_actions USING btree (occurred_at DESC);
create index if not exists idx_audit_admin_actions_tenant ON cblaero_app.audit_admin_actions USING btree (tenant_id, occurred_at DESC);

create table if not exists cblaero_app.audit_authorization_denials (
  id bigint generated always as identity not null,
  trace_id text not null,
  actor_id text,
  role text,
  session_tenant_id text,
  requested_tenant_id text,
  path text not null,
  method text not null,
  reason text not null,
  occurred_at timestamptz not null default now(),
  constraint audit_authorization_denials_pkey PRIMARY KEY (id),
  constraint audit_authorization_denials_reason_check CHECK ((reason = ANY (ARRAY['unauthenticated'::text, 'forbidden_role'::text, 'tenant_mismatch'::text])))
);

create index if not exists idx_audit_authorization_denials_occurred_at ON cblaero_app.audit_authorization_denials USING btree (occurred_at DESC);
create index if not exists idx_audit_authorization_denials_tenant ON cblaero_app.audit_authorization_denials USING btree (session_tenant_id, occurred_at DESC);

create table if not exists cblaero_app.audit_client_context_confirmations (
  id bigint generated always as identity not null,
  trace_id text not null,
  actor_id text not null,
  role text not null,
  tenant_id text not null,
  active_client_id text not null,
  target_client_id text not null,
  action text not null,
  path text not null,
  method text not null,
  outcome text not null,
  occurred_at timestamptz not null default now(),
  constraint audit_client_context_confirmations_pkey PRIMARY KEY (id),
  constraint audit_client_context_confirmations_outcome_check CHECK ((outcome = ANY (ARRAY['required'::text, 'confirmed'::text])))
);

create index if not exists idx_audit_client_context_confirmations_occurred_at ON cblaero_app.audit_client_context_confirmations USING btree (occurred_at DESC);
create index if not exists idx_audit_client_context_confirmations_tenant ON cblaero_app.audit_client_context_confirmations USING btree (tenant_id, occurred_at DESC);

create table if not exists cblaero_app.audit_data_residency_checks (
  id bigint generated always as identity not null,
  trace_id text not null,
  actor_id text,
  tenant_id text,
  status text not null,
  approved_regions text[] not null,
  checked_targets jsonb not null,
  violations text[] not null default '{}'::text[],
  occurred_at timestamptz not null default now(),
  constraint audit_data_residency_checks_pkey PRIMARY KEY (id),
  constraint audit_data_residency_checks_status_check CHECK ((status = ANY (ARRAY['pass'::text, 'fail'::text])))
);

create index if not exists idx_audit_data_residency_checks_occurred_at ON cblaero_app.audit_data_residency_checks USING btree (occurred_at DESC);
create index if not exists idx_audit_data_residency_checks_tenant ON cblaero_app.audit_data_residency_checks USING btree (tenant_id, occurred_at DESC);

create table if not exists cblaero_app.audit_event_vectors (
  id bigint generated always as identity not null,
  source_table text not null,
  source_event_id bigint not null,
  tenant_id text,
  payload_text text not null,
  embedding vector(8) not null,
  created_at timestamptz not null default now(),
  constraint audit_event_vectors_pkey PRIMARY KEY (id)
);

create index if not exists idx_audit_event_vectors_source ON cblaero_app.audit_event_vectors USING btree (source_table, source_event_id);
create index if not exists idx_audit_event_vectors_tenant ON cblaero_app.audit_event_vectors USING btree (tenant_id, created_at DESC);

create table if not exists cblaero_app.audit_import_batch_accesses (
  id bigint generated always as identity not null,
  trace_id text not null,
  actor_id text not null,
  tenant_id text not null,
  batch_id uuid,
  action text not null,
  occurred_at timestamptz not null default now(),
  constraint audit_import_batch_accesses_pkey PRIMARY KEY (id),
  constraint audit_import_batch_accesses_action_check CHECK ((action = ANY (ARRAY['list_import_batches'::text, 'read_import_batch_detail'::text, 'csv_upload_access'::text, 'download_csv_error_report'::text, 'resume_upload_access'::text, 'resume_confirm_access'::text])))
);

create index if not exists idx_audit_import_batch_accesses_occurred_at ON cblaero_app.audit_import_batch_accesses USING btree (occurred_at DESC);
create index if not exists idx_audit_import_batch_accesses_tenant ON cblaero_app.audit_import_batch_accesses USING btree (tenant_id, occurred_at DESC);

create table if not exists cblaero_app.audit_step_up_attempts (
  id bigint generated always as identity not null,
  trace_id text not null,
  actor_id text not null,
  tenant_id text not null,
  role text not null,
  path text not null,
  method text not null,
  action text not null,
  outcome text not null,
  reason text,
  occurred_at timestamptz not null default now(),
  constraint audit_step_up_attempts_pkey PRIMARY KEY (id),
  constraint audit_step_up_attempts_outcome_check CHECK ((outcome = ANY (ARRAY['challenged'::text, 'verified'::text]))),
  constraint audit_step_up_attempts_reason_check CHECK (((reason = 'fresh_auth_required'::text) OR (reason IS NULL)))
);

create index if not exists idx_audit_step_up_attempts_occurred_at ON cblaero_app.audit_step_up_attempts USING btree (occurred_at DESC);
create index if not exists idx_audit_step_up_attempts_tenant ON cblaero_app.audit_step_up_attempts USING btree (tenant_id, occurred_at DESC);

create table if not exists cblaero_app.auth_session_revocations (
  session_id text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz not null default now(),
  constraint auth_session_revocations_pkey PRIMARY KEY (session_id)
);

create index if not exists idx_auth_session_revocations_expires_at ON cblaero_app.auth_session_revocations USING btree (expires_at);

create table if not exists cblaero_app.candidate_availability_signals (
  id bigint generated always as identity not null,
  tenant_id text not null,
  candidate_id uuid not null,
  previous_state text not null,
  new_state text not null,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint candidate_availability_signals_pkey PRIMARY KEY (id),
  constraint candidate_availability_signals_new_state_check CHECK ((new_state = ANY (ARRAY['active'::text, 'passive'::text, 'unavailable'::text]))),
  constraint candidate_availability_signals_previous_state_check CHECK ((previous_state = ANY (ARRAY['active'::text, 'passive'::text, 'unavailable'::text]))),
  constraint candidate_availability_signals_source_check CHECK ((source = ANY (ARRAY['self_report'::text, 'engagement'::text, 'manual_refresh'::text, 'system'::text]))),
  constraint candidate_availability_signals_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES cblaero_app.candidates(id) ON DELETE CASCADE
);

create index if not exists idx_avail_signals_candidate ON cblaero_app.candidate_availability_signals USING btree (tenant_id, candidate_id, created_at DESC);
create index if not exists idx_avail_signals_tenant_time ON cblaero_app.candidate_availability_signals USING btree (tenant_id, created_at DESC);

create table if not exists cblaero_app.candidate_channel_preferences (
  id uuid not null default gen_random_uuid(),
  candidate_id uuid not null,
  tenant_id text not null,
  sms_opted_in boolean not null default true,
  sms_opt_out_at timestamptz,
  sms_opt_out_reason text,
  email_opted_in boolean not null default true,
  email_opt_out_at timestamptz,
  email_opt_out_reason text,
  contact_windows jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint candidate_channel_preferences_pkey PRIMARY KEY (id)
);

create UNIQUE index if not exists idx_channel_prefs_candidate ON cblaero_app.candidate_channel_preferences USING btree (candidate_id);
create index if not exists idx_channel_prefs_tenant ON cblaero_app.candidate_channel_preferences USING btree (tenant_id);

create table if not exists cblaero_app.candidate_submissions (
  id uuid not null default gen_random_uuid(),
  candidate_id uuid,
  tenant_id text not null,
  source text not null,
  email_message_id text,
  email_subject text,
  email_body text,
  email_from text,
  email_received_at timestamptz,
  extracted_data jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  extraction_model text,
  extraction_confidence text,
  created_at timestamptz not null default now(),
  constraint candidate_submissions_pkey PRIMARY KEY (id),
  constraint candidate_submissions_source_check CHECK ((source = ANY (ARRAY['email'::text, 'ats'::text, 'csv'::text, 'ceipal'::text, 'resume_upload'::text]))),
  constraint candidate_submissions_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES cblaero_app.candidates(id) ON DELETE SET NULL
);

create index if not exists idx_submissions_candidate ON cblaero_app.candidate_submissions USING btree (candidate_id);
create index if not exists idx_submissions_received ON cblaero_app.candidate_submissions USING btree (email_received_at DESC);
create index if not exists idx_submissions_source ON cblaero_app.candidate_submissions USING btree (source);

create table if not exists cblaero_app.candidates (
  id uuid not null default gen_random_uuid(),
  tenant_id text not null,
  email text,
  phone text,
  location text,
  skills jsonb not null default '[]'::jsonb,
  certifications jsonb not null default '[]'::jsonb,
  experience jsonb not null default '[]'::jsonb,
  availability_status text not null default 'passive'::text,
  ingestion_state text not null default 'pending_dedup'::text,
  source text not null,
  source_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_name text not null default ''::text,
  last_name text not null default ''::text,
  middle_name text,
  home_phone text,
  work_phone text,
  address text,
  city text,
  state text,
  country text,
  postal_code text,
  current_company text,
  job_title text,
  alternate_email text,
  work_authorization text,
  clearance text,
  aircraft_experience jsonb not null default '[]'::jsonb,
  employment_type text,
  current_rate text,
  per_diem text,
  has_ap_license boolean,
  years_of_experience text,
  ceipal_id text,
  submitted_by text,
  submitter_email text,
  shift_preference text,
  expected_start_date text,
  call_availability text,
  interview_availability text,
  veteran_status text,
  extra_attributes jsonb not null default '{}'::jsonb,
  resume_url text,
  created_by_actor_id text,
  name_tsv tsvector generated always as (to_tsvector('english'::regconfig, ((COALESCE(first_name, ''::text) || ' '::text) || COALESCE(last_name, ''::text)))) stored,
  deduced_roles jsonb not null default '[]'::jsonb,
  role_deduction_metadata jsonb not null default '{}'::jsonb,
  availability_last_signal_at timestamptz,
  linkedin_url text,
  source_recruiter_actor_id text,
  constraint candidates_pkey PRIMARY KEY (id),
  constraint candidates_tenant_email_unique UNIQUE (tenant_id, email),
  constraint candidates_availability_status_check CHECK ((availability_status = ANY (ARRAY['active'::text, 'passive'::text, 'unavailable'::text]))),
  constraint candidates_email_or_phone_required CHECK (((ingestion_state = 'merged'::text) OR (email IS NOT NULL) OR (phone IS NOT NULL))),
  constraint candidates_ingestion_state_check CHECK ((ingestion_state = ANY (ARRAY['pending_dedup'::text, 'pending_enrichment'::text, 'active'::text, 'rejected'::text, 'pending_review'::text, 'merged'::text]))),
  constraint chk_deduced_roles_max3 CHECK ((jsonb_array_length(deduced_roles) <= 3)),
  constraint candidates_source_batch_id_fkey FOREIGN KEY (source_batch_id) REFERENCES cblaero_app.import_batch(id)
);

create index if not exists idx_candidates_availability_signal_at ON cblaero_app.candidates USING btree (tenant_id, availability_last_signal_at);
create index if not exists idx_candidates_ceipal_id ON cblaero_app.candidates USING btree (ceipal_id) WHERE (ceipal_id IS NOT NULL);
create index if not exists idx_candidates_city_trgm ON cblaero_app.candidates USING gin (city gin_trgm_ops) WHERE (ingestion_state = 'active'::text);
create index if not exists idx_candidates_deduced_roles_gin ON cblaero_app.candidates USING gin (deduced_roles);
create index if not exists idx_candidates_email_trgm ON cblaero_app.candidates USING gin (email gin_trgm_ops) WHERE (ingestion_state = 'active'::text);
create index if not exists idx_candidates_job_title_trgm ON cblaero_app.candidates USING gin (job_title gin_trgm_ops) WHERE (ingestion_state = 'active'::text);
create index if not exists idx_candidates_job_title_trgm_all ON cblaero_app.candidates USING gin (lower(job_title) gin_trgm_ops) WHERE (job_title IS NOT NULL);
create index if not exists idx_candidates_name_fts ON cblaero_app.candidates USING gin (name_tsv) WHERE (ingestion_state = 'active'::text);
create index if not exists idx_candidates_name_lower ON cblaero_app.candidates USING btree (lower(TRIM(BOTH FROM first_name)), lower(TRIM(BOTH FROM last_name))) WHERE (ingestion_state = ANY (ARRAY['active'::text, 'pending_review'::text]));
create index if not exists idx_candidates_phone_normalized ON cblaero_app.candidates USING btree (cblaero_app.normalize_phone(phone)) WHERE ((phone IS NOT NULL) AND (ingestion_state = ANY (ARRAY['active'::text, 'pending_review'::text])));
create index if not exists idx_candidates_skills_gin ON cblaero_app.candidates USING gin (skills) WHERE (ingestion_state = 'active'::text);
create index if not exists idx_candidates_source_batch ON cblaero_app.candidates USING btree (source_batch_id) WHERE (source_batch_id IS NOT NULL);
create index if not exists idx_candidates_source_recruiter ON cblaero_app.candidates USING btree (tenant_id, source_recruiter_actor_id) WHERE (source_recruiter_actor_id IS NOT NULL);
create index if not exists idx_candidates_source_updated_at ON cblaero_app.candidates USING btree (source, updated_at DESC);
create index if not exists idx_candidates_tenant_created_desc ON cblaero_app.candidates USING btree (tenant_id, created_at DESC) WHERE (ingestion_state = 'active'::text);
create index if not exists idx_candidates_tenant_source ON cblaero_app.candidates USING btree (tenant_id, source) WHERE (ingestion_state = 'active'::text);
create index if not exists idx_candidates_tenant_state ON cblaero_app.candidates USING btree (tenant_id, ingestion_state);
create index if not exists idx_candidates_tenant_yoe_desc ON cblaero_app.candidates USING btree (tenant_id, years_of_experience DESC NULLS LAST) WHERE (ingestion_state = 'active'::text);
create UNIQUE index if not exists uq_candidates_tenant_email ON cblaero_app.candidates USING btree (tenant_id, email) WHERE (email IS NOT NULL);

create table if not exists cblaero_app.content_fingerprints (
  id bigint generated always as identity not null,
  tenant_id text not null,
  fingerprint_type text not null,
  fingerprint_hash text not null,
  source text not null,
  status text not null default 'processed'::text,
  candidate_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint content_fingerprints_pkey PRIMARY KEY (id),
  constraint content_fingerprints_fingerprint_type_check CHECK ((fingerprint_type = ANY (ARRAY['file_sha256'::text, 'email_message_id'::text, 'csv_row_hash'::text, 'ats_external_id'::text, 'candidate_identity'::text]))),
  constraint content_fingerprints_source_check CHECK ((source = ANY (ARRAY['email'::text, 'ats'::text, 'csv'::text, 'ceipal'::text, 'resume_upload'::text, 'onedrive'::text, 'dedup'::text]))),
  constraint content_fingerprints_status_check CHECK ((status = ANY (ARRAY['processed'::text, 'failed'::text]))),
  constraint content_fingerprints_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES cblaero_app.candidates(id) ON DELETE SET NULL
);

create index if not exists idx_fingerprints_tenant_type_created ON cblaero_app.content_fingerprints USING btree (tenant_id, fingerprint_type, created_at DESC);
create UNIQUE index if not exists uq_fingerprint_tenant_type_hash ON cblaero_app.content_fingerprints USING btree (tenant_id, fingerprint_type, fingerprint_hash);

create table if not exists cblaero_app.cross_client_confirmation_token_uses (
  jti text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now(),
  constraint cross_client_confirmation_token_uses_pkey PRIMARY KEY (jti)
);

create index if not exists idx_cross_client_confirmation_token_uses_expires_at ON cblaero_app.cross_client_confirmation_token_uses USING btree (expires_at);

create table if not exists cblaero_app.dedup_decisions (
  id bigint generated always as identity not null,
  tenant_id text not null,
  candidate_a_id uuid not null,
  candidate_b_id uuid not null,
  decision_type text not null,
  confidence_score numeric(5,2) not null,
  rationale text not null,
  actor text not null default 'system'::text,
  trace_id text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint dedup_decisions_pkey PRIMARY KEY (id),
  constraint dedup_decisions_decision_type_check CHECK ((decision_type = ANY (ARRAY['auto_merge'::text, 'manual_merge'::text, 'manual_reject'::text, 'keep_separate'::text]))),
  constraint dedup_decisions_candidate_a_id_fkey FOREIGN KEY (candidate_a_id) REFERENCES cblaero_app.candidates(id),
  constraint dedup_decisions_candidate_b_id_fkey FOREIGN KEY (candidate_b_id) REFERENCES cblaero_app.candidates(id)
);

create index if not exists idx_dedup_decisions_candidates ON cblaero_app.dedup_decisions USING btree (candidate_a_id, candidate_b_id);
create index if not exists idx_dedup_decisions_tenant ON cblaero_app.dedup_decisions USING btree (tenant_id, created_at DESC);

create table if not exists cblaero_app.dedup_review_queue (
  id bigint generated always as identity not null,
  tenant_id text not null,
  candidate_a_id uuid not null,
  candidate_b_id uuid not null,
  confidence_score numeric(5,2) not null,
  field_diffs jsonb not null default '{}'::jsonb,
  status text not null default 'pending'::text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dedup_review_queue_pkey PRIMARY KEY (id),
  constraint dedup_review_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
  constraint dedup_review_queue_candidate_a_id_fkey FOREIGN KEY (candidate_a_id) REFERENCES cblaero_app.candidates(id),
  constraint dedup_review_queue_candidate_b_id_fkey FOREIGN KEY (candidate_b_id) REFERENCES cblaero_app.candidates(id)
);

create index if not exists idx_dedup_review_tenant_status ON cblaero_app.dedup_review_queue USING btree (tenant_id, status) WHERE (status = 'pending'::text);

create table if not exists cblaero_app.import_batch (
  id uuid not null default gen_random_uuid(),
  tenant_id text not null,
  source text not null,
  status text not null,
  total_rows integer not null default 0,
  imported integer not null default 0,
  skipped integer not null default 0,
  errors integer not null default 0,
  error_threshold_pct integer not null default 5,
  created_by_actor_id text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz default now(),
  constraint import_batch_pkey PRIMARY KEY (id),
  constraint import_batch_source_check CHECK ((source = ANY (ARRAY['migration'::text, 'csv_upload'::text, 'ats_sync'::text, 'inbox_parse'::text, 'resume_upload'::text]))),
  constraint import_batch_status_check CHECK ((status = ANY (ARRAY['validating'::text, 'running'::text, 'processing'::text, 'paused_on_error_threshold'::text, 'complete'::text, 'rolled_back'::text])))
);

create index if not exists idx_import_batch_status ON cblaero_app.import_batch USING btree (status, started_at DESC);
create index if not exists idx_import_batch_tenant_started ON cblaero_app.import_batch USING btree (tenant_id, started_at DESC);

create table if not exists cblaero_app.import_row_error (
  id bigint generated always as identity not null,
  batch_id uuid not null,
  row_number integer not null,
  raw_data jsonb not null default '{}'::jsonb,
  error_code text not null,
  error_detail text,
  occurred_at timestamptz not null default now(),
  constraint import_row_error_pkey PRIMARY KEY (id),
  constraint import_row_error_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES cblaero_app.import_batch(id)
);

create index if not exists idx_import_row_error_batch ON cblaero_app.import_row_error USING btree (batch_id, row_number);

create table if not exists cblaero_app.llm_usage_log (
  id bigint generated always as identity not null,
  model text not null,
  prompt_name text,
  prompt_version text,
  module text not null,
  action text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  duration_ms integer not null,
  estimated_cost_usd numeric(10,6) not null default 0,
  created_at timestamptz not null default now(),
  constraint llm_usage_log_pkey PRIMARY KEY (id)
);

create index if not exists idx_llm_usage_log_created ON cblaero_app.llm_usage_log USING btree (created_at DESC);
create index if not exists idx_llm_usage_log_model_created ON cblaero_app.llm_usage_log USING btree (model, created_at DESC);

create table if not exists cblaero_app.outbox_events (
  id uuid not null default gen_random_uuid(),
  job_key text not null,
  tenant_id text not null,
  schedule_run_id uuid,
  payload jsonb,
  status text not null default 'pending'::text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  error_message text,
  constraint outbox_events_pkey PRIMARY KEY (id),
  constraint outbox_events_status_valid CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]))),
  constraint outbox_events_schedule_run_id_fkey FOREIGN KEY (schedule_run_id) REFERENCES cblaero_app.schedule_runs(id) ON DELETE SET NULL
);

create index if not exists idx_outbox_events_pending ON cblaero_app.outbox_events USING btree (tenant_id, created_at) WHERE (status = 'pending'::text);
create index if not exists idx_outbox_events_schedule_run ON cblaero_app.outbox_events USING btree (schedule_run_id);

create table if not exists cblaero_app.outreach_audit_log (
  id uuid not null default gen_random_uuid(),
  tenant_id text not null,
  channel text not null,
  send_id uuid,
  candidate_id uuid not null,
  sender_user_id text,
  sender_role text,
  template_id uuid,
  template_agenda text,
  delivery_status text,
  content_hash text,
  compliance_check_passed boolean,
  blocked_reason text,
  created_at timestamptz not null default now(),
  constraint outreach_audit_log_pkey PRIMARY KEY (id),
  constraint outreach_audit_channel_valid CHECK ((channel = ANY (ARRAY['sms'::text, 'email'::text])))
);

create index if not exists idx_outreach_audit_candidate ON cblaero_app.outreach_audit_log USING btree (candidate_id);
create index if not exists idx_outreach_audit_tenant_created ON cblaero_app.outreach_audit_log USING btree (tenant_id, created_at);

create table if not exists cblaero_app.policy_registry (
  id bigint generated always as identity not null,
  family text not null,
  key text not null,
  description text not null default ''::text,
  created_at timestamptz not null default now(),
  constraint policy_registry_pkey PRIMARY KEY (id),
  constraint policy_registry_family_key_key UNIQUE (family, key)
);

create table if not exists cblaero_app.policy_versions (
  id bigint generated always as identity not null,
  policy_id bigint not null,
  value jsonb not null,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_by_actor_id text not null default 'system'::text,
  created_at timestamptz not null default now(),
  constraint policy_versions_pkey PRIMARY KEY (id),
  constraint policy_versions_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES cblaero_app.policy_registry(id) ON DELETE CASCADE
);

create index if not exists idx_policy_versions_lookup ON cblaero_app.policy_versions USING btree (policy_id, effective_from DESC);

create table if not exists cblaero_app.prompt_registry (
  id bigint generated always as identity not null,
  name text not null,
  version text not null,
  prompt_text text not null,
  model text not null,
  created_at timestamptz not null default now(),
  created_by text,
  notes text,
  status text not null default 'active'::text,
  constraint prompt_registry_pkey PRIMARY KEY (id),
  constraint prompt_registry_name_version_key UNIQUE (name, version),
  constraint prompt_registry_status_check CHECK ((status = ANY (ARRAY['active'::text, 'staged'::text, 'deprecated'::text])))
);

create index if not exists idx_prompt_registry_name_created ON cblaero_app.prompt_registry USING btree (name, created_at DESC);
create index if not exists idx_prompt_registry_name_status ON cblaero_app.prompt_registry USING btree (name, status);

create table if not exists cblaero_app.provider_health_events (
  id uuid not null default gen_random_uuid(),
  provider text not null,
  previous_mode text not null,
  new_mode text not null,
  reason text not null,
  error_rate numeric(5,4),
  attempt_count integer,
  occurred_at timestamptz not null default now(),
  constraint provider_health_events_pkey PRIMARY KEY (id),
  constraint provider_health_events_new_mode_check CHECK ((new_mode = ANY (ARRAY['normal'::text, 'degraded'::text, 'kill_switched'::text]))),
  constraint provider_health_events_previous_mode_check CHECK ((previous_mode = ANY (ARRAY['normal'::text, 'degraded'::text, 'kill_switched'::text])))
);

create index if not exists idx_provider_health_events_provider ON cblaero_app.provider_health_events USING btree (provider, occurred_at);

create table if not exists cblaero_app.provider_routing_policies (
  id uuid not null default gen_random_uuid(),
  channel text not null,
  primary_provider text not null,
  fallback_provider text,
  mode text not null default 'normal'::text,
  updated_at timestamptz not null default now(),
  updated_by_actor_id text,
  reason text,
  constraint provider_routing_policies_pkey PRIMARY KEY (id),
  constraint provider_routing_policies_channel_key UNIQUE (channel),
  constraint provider_routing_policies_mode_check CHECK ((mode = ANY (ARRAY['normal'::text, 'degraded'::text, 'kill_switched'::text])))
);

create table if not exists cblaero_app.role_alias_lookup (
  alias text not null,
  role_name text not null,
  tenant_id text not null
);

create table if not exists cblaero_app.role_taxonomy (
  id integer not null default nextval('cblaero_app.role_taxonomy_id_seq'::regclass),
  tenant_id text not null,
  role_name text not null,
  category text not null,
  aliases jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint role_taxonomy_pkey PRIMARY KEY (id),
  constraint role_taxonomy_category_check CHECK ((category = ANY (ARRAY['aviation'::text, 'it'::text, 'other'::text])))
);

create index if not exists idx_role_taxonomy_aliases ON cblaero_app.role_taxonomy USING gin (aliases);
create index if not exists idx_role_taxonomy_category ON cblaero_app.role_taxonomy USING btree (tenant_id, category) WHERE (is_active = true);
create UNIQUE index if not exists uq_role_taxonomy_tenant_name ON cblaero_app.role_taxonomy USING btree (tenant_id, lower(role_name));

create table if not exists cblaero_app.saved_searches (
  id uuid not null default gen_random_uuid(),
  tenant_id text not null,
  actor_id text not null,
  actor_email text not null,
  name text not null,
  filters jsonb not null,
  digest_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_searches_pkey PRIMARY KEY (id)
);

create index if not exists idx_saved_searches_actor ON cblaero_app.saved_searches USING btree (actor_id, tenant_id);
create index if not exists idx_saved_searches_digest ON cblaero_app.saved_searches USING btree (digest_enabled) WHERE (digest_enabled = true);

create table if not exists cblaero_app.schedule_definitions (
  id bigint generated always as identity not null,
  tenant_id text not null,
  name text not null,
  job_key text not null,
  cron_expression text not null,
  policy_version_id bigint,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_claimed_at timestamptz,
  next_run_at timestamptz not null,
  constraint schedule_definitions_pkey PRIMARY KEY (id),
  constraint schedule_definitions_policy_version_id_fkey FOREIGN KEY (policy_version_id) REFERENCES cblaero_app.policy_versions(id) ON DELETE SET NULL
);

create UNIQUE index if not exists idx_schedule_definitions_tenant_job_key ON cblaero_app.schedule_definitions USING btree (tenant_id, job_key);
create index if not exists idx_schedule_definitions_tenant_next_run ON cblaero_app.schedule_definitions USING btree (tenant_id, next_run_at);

create table if not exists cblaero_app.schedule_runs (
  id uuid not null default gen_random_uuid(),
  schedule_definition_id bigint not null,
  tenant_id text not null,
  policy_version_id bigint,
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  status text not null default 'pending'::text,
  result_payload jsonb,
  error_message text,
  worker_id text,
  constraint schedule_runs_pkey PRIMARY KEY (id),
  constraint schedule_runs_status_valid CHECK ((status = ANY (ARRAY['pending'::text, 'claimed'::text, 'started'::text, 'completed'::text, 'failed'::text, 'skipped'::text]))),
  constraint schedule_runs_policy_version_id_fkey FOREIGN KEY (policy_version_id) REFERENCES cblaero_app.policy_versions(id) ON DELETE SET NULL,
  constraint schedule_runs_schedule_definition_id_fkey FOREIGN KEY (schedule_definition_id) REFERENCES cblaero_app.schedule_definitions(id) ON DELETE CASCADE
);

create index if not exists idx_schedule_runs_definition_id ON cblaero_app.schedule_runs USING btree (schedule_definition_id);
create index if not exists idx_schedule_runs_tenant_id ON cblaero_app.schedule_runs USING btree (tenant_id);

create table if not exists cblaero_app.sms_sends (
  id uuid not null default gen_random_uuid(),
  tenant_id text not null,
  campaign_id uuid,
  candidate_id uuid not null,
  template_id uuid not null,
  template_version integer not null,
  rendered_body text,
  rendered_body_hash text,
  context_params jsonb not null default '{}'::jsonb,
  provider text,
  provider_message_id text,
  status text not null default 'pending'::text,
  delivery_attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  contact_window_deferred_until timestamptz,
  blocked_reason text,
  sender_user_id text,
  tracking_token text,
  tracking_url text,
  clicked_at timestamptz,
  click_count integer not null default 0,
  response_received_at timestamptz,
  response_body text,
  response_type text,
  created_at timestamptz not null default now(),
  constraint sms_sends_pkey PRIMARY KEY (id),
  constraint sms_sends_tracking_token_key UNIQUE (tracking_token),
  constraint sms_sends_response_type_valid CHECK (((response_type IS NULL) OR (response_type = ANY (ARRAY['opt_out'::text, 'affirmative'::text, 'negative'::text, 'freeform'::text])))),
  constraint sms_sends_status_valid CHECK ((status = ANY (ARRAY['pending'::text, 'queued'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'bounced'::text, 'undeliverable'::text, 'blocked_opt_out'::text, 'deferred_window'::text]))),
  constraint sms_sends_template_id_fkey FOREIGN KEY (template_id) REFERENCES cblaero_app.sms_templates(id)
);

create index if not exists idx_sms_sends_deferred_window ON cblaero_app.sms_sends USING btree (tenant_id, contact_window_deferred_until) WHERE (status = 'deferred_window'::text);
create index if not exists idx_sms_sends_pending_due ON cblaero_app.sms_sends USING btree (tenant_id, scheduled_for) WHERE (status = 'pending'::text);
create index if not exists idx_sms_sends_tenant_candidate_status ON cblaero_app.sms_sends USING btree (tenant_id, candidate_id, status);

create table if not exists cblaero_app.sms_templates (
  id uuid not null default gen_random_uuid(),
  tenant_id text not null,
  agenda text not null,
  name text not null,
  template_key text not null,
  body text not null,
  variables jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  status text not null default 'active'::text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_templates_pkey PRIMARY KEY (id),
  constraint sms_templates_agenda_valid CHECK ((agenda = ANY (ARRAY['new_opportunity'::text, 'availability_check'::text, 'job_followup'::text, 'submission_followup'::text, 'interview_schedule'::text, 'interview_reminder'::text, 'interview_followup'::text, 'bgv_initiation'::text, 'bgv_followup'::text, 'offer_extended'::text, 'onboarding'::text, 'reengagement'::text, 'general'::text]))),
  constraint sms_templates_body_length CHECK ((length(body) <= 1600)),
  constraint sms_templates_status_valid CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);

create index if not exists idx_sms_templates_tenant_agenda_status ON cblaero_app.sms_templates USING btree (tenant_id, agenda, status);
create UNIQUE index if not exists idx_sms_templates_tenant_key_version ON cblaero_app.sms_templates USING btree (tenant_id, template_key, version);

create table if not exists cblaero_app.sync_errors (
  id bigint generated always as identity not null,
  source text not null,
  record_id text not null,
  message text not null,
  occurred_at timestamptz not null default now(),
  run_id uuid,
  constraint sync_errors_pkey PRIMARY KEY (id),
  constraint sync_errors_run_id_fkey FOREIGN KEY (run_id) REFERENCES cblaero_app.sync_runs(id) ON DELETE SET NULL
);

create index if not exists idx_sync_errors_occurred ON cblaero_app.sync_errors USING btree (occurred_at DESC);
create index if not exists idx_sync_errors_run_id ON cblaero_app.sync_errors USING btree (run_id);
create index if not exists idx_sync_errors_source ON cblaero_app.sync_errors USING btree (source);

create table if not exists cblaero_app.sync_runs (
  id uuid not null default gen_random_uuid(),
  source text not null,
  status text not null default 'running'::text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  succeeded integer not null default 0,
  failed integer not null default 0,
  total integer not null default 0,
  error_message text,
  constraint sync_runs_pkey PRIMARY KEY (id)
);

create index if not exists idx_sync_runs_started_at ON cblaero_app.sync_runs USING btree (started_at DESC);
create UNIQUE index if not exists uq_sync_runs_clay_hourly ON cblaero_app.sync_runs USING btree (source, started_at) WHERE (source = 'clay_enrichment'::text);

create table if not exists cblaero_app.webhook_events (
  id uuid not null default gen_random_uuid(),
  source text not null,
  event_type text not null default 'unknown'::text,
  provider_event_id text,
  raw_payload jsonb not null,
  status text not null default 'pending'::text,
  attempt_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  claimed_at timestamptz,
  constraint webhook_events_pkey PRIMARY KEY (id),
  constraint webhook_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'dead_letter'::text])))
);

create index if not exists idx_webhook_events_dead_letter ON cblaero_app.webhook_events USING btree (source, created_at) WHERE (status = 'dead_letter'::text);
create UNIQUE index if not exists idx_webhook_events_dedup ON cblaero_app.webhook_events USING btree (source, provider_event_id) WHERE (provider_event_id IS NOT NULL);
create index if not exists idx_webhook_events_pending ON cblaero_app.webhook_events USING btree (status, created_at) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));

-- Attach standalone sequences to their owning columns (after tables exist).
alter sequence cblaero_app.role_taxonomy_id_seq owned by cblaero_app.role_taxonomy.id;

-- ============================================================
-- Row Level Security
-- ============================================================

alter table cblaero_app.audit_authorization_denials enable row level security;
alter table cblaero_app.candidate_availability_signals enable row level security;
alter table cblaero_app.candidate_channel_preferences enable row level security;
alter table cblaero_app.outbox_events enable row level security;
alter table cblaero_app.outreach_audit_log enable row level security;
alter table cblaero_app.policy_registry enable row level security;
alter table cblaero_app.policy_versions enable row level security;
alter table cblaero_app.provider_health_events enable row level security;
alter table cblaero_app.provider_routing_policies enable row level security;
alter table cblaero_app.role_taxonomy enable row level security;
alter table cblaero_app.saved_searches enable row level security;
alter table cblaero_app.schedule_definitions enable row level security;
alter table cblaero_app.schedule_runs enable row level security;
alter table cblaero_app.sms_sends enable row level security;
alter table cblaero_app.sms_templates enable row level security;
alter table cblaero_app.webhook_events enable row level security;

create policy tenant_isolation on cblaero_app.candidate_availability_signals
  for all
  using ((tenant_id = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'tenant_id'::text)));

create policy channel_prefs_read on cblaero_app.candidate_channel_preferences
  for select
  using (true);

create policy outbox_events_read on cblaero_app.outbox_events
  for select
  using (true);

create policy outreach_audit_read on cblaero_app.outreach_audit_log
  for select
  using (true);

create policy policy_registry_read on cblaero_app.policy_registry
  for select
  using (true);

create policy policy_versions_read on cblaero_app.policy_versions
  for select
  using (true);

create policy tenant_isolation_role_taxonomy on cblaero_app.role_taxonomy
  for all
  using ((tenant_id = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'tenant_id'::text)));

create policy saved_searches_delete on cblaero_app.saved_searches
  for delete
  using (true);
create policy saved_searches_insert on cblaero_app.saved_searches
  for insert
  with check (true);
create policy saved_searches_select on cblaero_app.saved_searches
  for select
  using (true);
create policy saved_searches_update on cblaero_app.saved_searches
  for update
  using (true);

create policy schedule_definitions_read on cblaero_app.schedule_definitions
  for select
  using (true);

create policy schedule_runs_read on cblaero_app.schedule_runs
  for select
  using (true);

create policy sms_sends_read on cblaero_app.sms_sends
  for select
  using (true);

create policy sms_templates_read on cblaero_app.sms_templates
  for select
  using (true);

-- ============================================================
-- Functions / RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION cblaero_app.backfill_all_deduced_roles(p_tenant_id text)
 RETURNS TABLE(total_processed integer, total_assigned integer, total_empty integer, batches_run integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_total_processed int := 0;
  v_total_assigned int := 0;
  v_total_empty int := 0;
  v_batches int := 0;
  v_batch RECORD;
BEGIN
  LOOP
    SELECT * INTO v_batch FROM cblaero_app.backfill_deduced_roles_heuristic(p_tenant_id, 5000);
    
    IF v_batch.processed = 0 THEN EXIT; END IF;
    
    v_total_processed := v_total_processed + v_batch.processed;
    v_total_assigned := v_total_assigned + v_batch.assigned;
    v_total_empty := v_total_empty + v_batch.empty;
    v_batches := v_batches + 1;
    
    RAISE NOTICE 'Batch %: % processed (% assigned, % empty) — cumulative: %', 
      v_batches, v_batch.processed, v_batch.assigned, v_batch.empty, v_total_processed;
  END LOOP;
  
  total_processed := v_total_processed;
  total_assigned := v_total_assigned;
  total_empty := v_total_empty;
  batches_run := v_batches;
  RETURN NEXT;
END; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.backfill_all_keywords(p_tenant_id text)
 RETURNS TABLE(total_processed integer, total_matched integer, total_unmatched integer, batches integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_candidate RECORD;
  v_role RECORD;
  v_alias text;
  v_matched_role text;
  v_title text;
  v_total_processed int := 0;
  v_total_matched int := 0;
  v_total_unmatched int := 0;
  v_batches int := 0;
  v_batch_matched int;
  v_batch_unmatched int;
  v_batch_count int;
  v_batch_size int := 5000;
BEGIN
  LOOP
    v_batch_matched := 0;
    v_batch_unmatched := 0;
    v_batch_count := 0;

    FOR v_candidate IN
      SELECT c.id, c.job_title
      FROM cblaero_app.candidates c
      WHERE c.tenant_id = p_tenant_id AND c.deduced_roles = '[]'::jsonb 
        AND c.ingestion_state NOT IN ('merged', 'pending_enrichment')
        AND c.job_title IS NOT NULL AND trim(c.job_title) != ''
      ORDER BY c.id
      LIMIT v_batch_size
    LOOP
      v_title := lower(trim(v_candidate.job_title));
      v_matched_role := NULL;

      FOR v_role IN
        SELECT r.role_name, r.aliases FROM cblaero_app.role_taxonomy r
        WHERE r.tenant_id = p_tenant_id AND r.is_active = true AND r.category != 'aviation'
        ORDER BY r.role_name
      LOOP
        FOR v_alias IN SELECT jsonb_array_elements_text(v_role.aliases)
        LOOP
          IF length(v_alias) >= 3 AND v_title LIKE '%' || lower(v_alias) || '%' THEN
            v_matched_role := v_role.role_name;
            EXIT;
          END IF;
        END LOOP;
        IF v_matched_role IS NOT NULL THEN EXIT; END IF;
      END LOOP;

      IF v_matched_role IS NOT NULL THEN
        UPDATE cblaero_app.candidates SET
          deduced_roles = jsonb_build_array(v_matched_role),
          role_deduction_metadata = jsonb_build_object('source','heuristic','confidence',0.7,'rawJobTitle',v_candidate.job_title,'deducedAt',now()::text),
          ingestion_state = 'active', updated_at = now()
        WHERE id = v_candidate.id;
        v_batch_matched := v_batch_matched + 1;
      ELSE
        -- Mark as pending_enrichment so next iteration can find them
        UPDATE cblaero_app.candidates SET
          ingestion_state = 'pending_enrichment', updated_at = now()
        WHERE id = v_candidate.id;
        v_batch_unmatched := v_batch_unmatched + 1;
      END IF;

      v_batch_count := v_batch_count + 1;
    END LOOP;

    IF v_batch_count = 0 THEN EXIT; END IF;

    v_batches := v_batches + 1;
    v_total_processed := v_total_processed + v_batch_count;
    v_total_matched := v_total_matched + v_batch_matched;
    v_total_unmatched := v_total_unmatched + v_batch_unmatched;
    RAISE NOTICE 'Batch %: % processed (% matched, % unmatched) — cumulative: % matched of %', v_batches, v_batch_count, v_batch_matched, v_batch_unmatched, v_total_matched, v_total_processed;
  END LOOP;

  total_processed := v_total_processed; total_matched := v_total_matched; total_unmatched := v_total_unmatched; batches := v_batches;
  RETURN NEXT;
END; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.backfill_all_keywords_autocommit(p_tenant_id text)
 RETURNS TABLE(total_processed integer, total_matched integer, total_unmatched integer, batches integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_connstr text;
  v_result RECORD;
  v_total_processed int := 0;
  v_total_matched int := 0;
  v_total_unmatched int := 0;
  v_batches int := 0;
BEGIN
  v_connstr := 'dbname=' || current_database() || ' port=' || inet_server_port();
  PERFORM dblink_connect('batch_conn', v_connstr);
  
  LOOP
    SELECT * INTO v_result FROM dblink('batch_conn',
      'SELECT * FROM cblaero_app.backfill_by_keyword(''' || p_tenant_id || ''', 20000)'
    ) AS t(processed int, matched int, unmatched int);
    
    IF v_result.processed = 0 THEN EXIT; END IF;
    
    v_batches := v_batches + 1;
    v_total_processed := v_total_processed + v_result.processed;
    v_total_matched := v_total_matched + v_result.matched;
    v_total_unmatched := v_total_unmatched + v_result.unmatched;
    
    RAISE NOTICE 'Batch %: % processed (% matched, % unmatched) — cumulative: % matched of %',
      v_batches, v_result.processed, v_result.matched, v_result.unmatched, v_total_matched, v_total_processed;
  END LOOP;
  
  PERFORM dblink_disconnect('batch_conn');
  
  total_processed := v_total_processed;
  total_matched := v_total_matched;
  total_unmatched := v_total_unmatched;
  batches := v_batches;
  RETURN NEXT;
END; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.backfill_by_keyword(p_tenant_id text)
 RETURNS TABLE(role text, matched bigint)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_role RECORD;
  v_alias text;
  v_matched bigint;
BEGIN
  FOR v_role IN 
    SELECT r.role_name, r.aliases FROM cblaero_app.role_taxonomy r 
    WHERE r.tenant_id = p_tenant_id AND r.is_active = true AND r.category != 'aviation'
    ORDER BY r.role_name
  LOOP
    FOR v_alias IN SELECT jsonb_array_elements_text(v_role.aliases)
    LOOP
      IF length(v_alias) >= 4 THEN
        UPDATE cblaero_app.candidates c
        SET deduced_roles = jsonb_build_array(v_role.role_name),
            role_deduction_metadata = jsonb_build_object('source','heuristic','confidence',0.7,'rawJobTitle',c.job_title,'deducedAt',now()::text),
            ingestion_state = 'active', updated_at = now()
        WHERE c.tenant_id = p_tenant_id AND c.deduced_roles = '[]'::jsonb AND c.ingestion_state != 'merged'
          AND c.job_title IS NOT NULL AND trim(c.job_title) != ''
          AND lower(c.job_title) LIKE '%' || lower(v_alias) || '%';
      END IF;
    END LOOP;
    
    GET DIAGNOSTICS v_matched = ROW_COUNT;
    role := v_role.role_name;
    matched := v_matched;
    RAISE NOTICE '% done', v_role.role_name;
    RETURN NEXT;
  END LOOP;
END; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.backfill_by_keyword(p_tenant_id text, p_batch_size integer DEFAULT 5000)
 RETURNS TABLE(processed integer, matched integer, unmatched integer)
 LANGUAGE plpgsql
AS $function$
DECLARE v_matched int; v_batch_ids uuid[];
BEGIN
  -- Get batch IDs
  SELECT array_agg(id) INTO v_batch_ids FROM (
    SELECT id FROM cblaero_app.candidates
    WHERE tenant_id = p_tenant_id AND deduced_roles = '[]'::jsonb
      AND ingestion_state NOT IN ('merged', 'rejected')
      AND job_title IS NOT NULL AND trim(job_title) != ''
    ORDER BY id LIMIT p_batch_size
  ) t;

  IF v_batch_ids IS NULL THEN
    processed := 0; matched := 0; unmatched := 0; RETURN NEXT; RETURN;
  END IF;

  -- Update matched: find first alias that appears in the job title
  UPDATE cblaero_app.candidates c
  SET deduced_roles = jsonb_build_array(m.role_name),
      role_deduction_metadata = jsonb_build_object('source','heuristic','confidence',0.7,'rawJobTitle',c.job_title,'deducedAt',now()::text),
      ingestion_state = 'active', updated_at = now()
  FROM (
    SELECT DISTINCT ON (c2.id) c2.id, a.role_name
    FROM cblaero_app.candidates c2
    JOIN cblaero_app.role_alias_lookup a ON a.tenant_id = p_tenant_id
      AND lower(c2.job_title) LIKE '%' || a.alias || '%'
    WHERE c2.id = ANY(v_batch_ids)
    ORDER BY c2.id, length(a.alias) DESC
  ) m
  WHERE c.id = m.id;
  GET DIAGNOSTICS v_matched = ROW_COUNT;

  -- Mark unmatched as rejected
  UPDATE cblaero_app.candidates SET ingestion_state = 'rejected', updated_at = now()
  WHERE id = ANY(v_batch_ids) AND deduced_roles = '[]'::jsonb;

  processed := array_length(v_batch_ids, 1);
  matched := v_matched;
  unmatched := processed - v_matched;
  RETURN NEXT;
END; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.backfill_deduced_roles_heuristic(p_tenant_id text, p_batch_size integer DEFAULT 5000)
 RETURNS TABLE(processed integer, assigned integer, empty integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_processed int := 0; v_assigned int := 0; v_empty int := 0;
  v_candidate record; v_role record;
  v_roles text[]; v_best_confidence numeric; v_title text;
BEGIN
  FOR v_candidate IN
    SELECT c.id, c.job_title, c.skills
    FROM cblaero_app.candidates c
    WHERE c.deduced_roles = '[]'::jsonb AND c.tenant_id = p_tenant_id AND c.ingestion_state != 'merged'
    ORDER BY c.id LIMIT p_batch_size
  LOOP
    v_roles := '{}'; v_best_confidence := 0;
    v_title := lower(trim(coalesce(v_candidate.job_title, '')));

    IF v_title != '' THEN
      FOR v_role IN SELECT r.role_name, r.aliases FROM cblaero_app.role_taxonomy r WHERE r.tenant_id = p_tenant_id AND r.is_active = true
      LOOP
        IF array_length(v_roles, 1) IS NOT NULL AND array_length(v_roles, 1) >= 3 THEN EXIT; END IF;

        -- 1. Exact role name match (case-insensitive)
        IF v_title = lower(v_role.role_name) THEN
          v_roles := array_append(v_roles, v_role.role_name);
          IF v_best_confidence < 1.0 THEN v_best_confidence := 1.0; END IF; CONTINUE;
        END IF;

        -- 2. Exact alias match only (NOT substring — prevents "Developer" matching everything)
        IF EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_role.aliases) AS alias
          WHERE v_title = lower(alias)
        ) THEN
          v_roles := array_append(v_roles, v_role.role_name);
          IF v_best_confidence < 0.9 THEN v_best_confidence := 0.9; END IF; CONTINUE;
        END IF;

        -- 3. Title contains full role name (not vice versa — prevents short names matching everything)
        IF length(v_title) >= 3 AND length(v_role.role_name) >= 5 AND v_title LIKE '%' || lower(v_role.role_name) || '%' THEN
          v_roles := array_append(v_roles, v_role.role_name);
          IF v_best_confidence < 0.7 THEN v_best_confidence := 0.7; END IF;
        END IF;
      END LOOP;
    END IF;

    UPDATE cblaero_app.candidates SET
      deduced_roles = to_jsonb(v_roles),
      role_deduction_metadata = jsonb_build_object('source','heuristic','confidence',v_best_confidence,'rawJobTitle',v_candidate.job_title,'deducedAt',now()::text),
      ingestion_state = 'active', updated_at = now()
    WHERE id = v_candidate.id;

    v_processed := v_processed + 1;
    IF array_length(v_roles, 1) > 0 THEN v_assigned := v_assigned + 1; ELSE v_empty := v_empty + 1; END IF;
  END LOOP;
  processed := v_processed; assigned := v_assigned; empty := v_empty; RETURN NEXT;
END; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.batch_update_deduced_roles(p_updates jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_row jsonb;
  v_count int := 0;
BEGIN
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    UPDATE cblaero_app.candidates
    SET deduced_roles = coalesce(v_row->'deduced_roles', '[]'::jsonb),
        role_deduction_metadata = coalesce(v_row->'role_deduction_metadata', '{}'::jsonb),
        updated_at = now()
    WHERE id = (v_row->>'id')::uuid;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.check_and_record_fingerprint(p_tenant_id text, p_type text, p_hash text, p_source text, p_candidate_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb, p_status text DEFAULT 'processed'::text)
 RETURNS TABLE(already_exists boolean)
 LANGUAGE plpgsql
AS $function$
declare v_exists boolean;
begin
  select exists(
    select 1 from cblaero_app.content_fingerprints cf
    where cf.tenant_id = p_tenant_id and cf.fingerprint_type = p_type
      and cf.fingerprint_hash = p_hash and cf.status = 'processed'
  ) into v_exists;
  if not v_exists then
    insert into cblaero_app.content_fingerprints
      (tenant_id, fingerprint_type, fingerprint_hash, source, status, candidate_id, metadata)
    values (p_tenant_id, p_type, p_hash, p_source, p_status, p_candidate_id, p_metadata)
    on conflict (tenant_id, fingerprint_type, fingerprint_hash) do update
      set status = excluded.status, candidate_id = excluded.candidate_id, metadata = excluded.metadata;
  end if;
  already_exists := v_exists; return next;
end; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.claim_due_schedules(p_tenant_id text, p_now timestamp with time zone, p_stale_threshold timestamp with time zone, p_limit integer DEFAULT 20)
 RETURNS SETOF cblaero_app.schedule_definitions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cblaero_app'
AS $function$
begin
  return query
  update cblaero_app.schedule_definitions
  set
    last_claimed_at = p_now,
    updated_at      = p_now
  where id in (
    select id
    from   cblaero_app.schedule_definitions
    where  tenant_id       = p_tenant_id
      and  enabled         = true
      and  next_run_at    <= p_now
      and  (last_claimed_at is null or last_claimed_at < p_stale_threshold)
    order  by next_run_at asc
    for update skip locked
    limit  p_limit
  )
  returning *;
end;
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.claim_pending_outbox_events(p_tenant_id text, p_now timestamp with time zone, p_limit integer DEFAULT 20, p_schedule_run_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF cblaero_app.outbox_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cblaero_app'
AS $function$
begin
  return query
  update cblaero_app.outbox_events
  set
    status     = 'processing',
    claimed_at = p_now
  where id in (
    select id
    from   cblaero_app.outbox_events
    where  tenant_id = p_tenant_id
      and  status    = 'pending'
      and  (p_schedule_run_id is null or schedule_run_id = p_schedule_run_id)
    order  by created_at asc
    for update skip locked
    limit  p_limit
  )
  returning *;
end;
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.cleanup_audit_logs(p_retention_days integer DEFAULT 90)
 RETURNS TABLE(table_name text, deleted_count bigint)
 LANGUAGE plpgsql
AS $function$
declare
  v_cutoff timestamptz := now() - (p_retention_days || ' days')::interval;
  v_count bigint;
begin
  delete from cblaero_app.audit_authorization_denials where occurred_at < v_cutoff;
  get diagnostics v_count = row_count;
  table_name := 'audit_authorization_denials'; deleted_count := v_count; return next;
  delete from cblaero_app.audit_admin_actions where occurred_at < v_cutoff;
  get diagnostics v_count = row_count;
  table_name := 'audit_admin_actions'; deleted_count := v_count; return next;
  delete from cblaero_app.audit_step_up_attempts where occurred_at < v_cutoff;
  get diagnostics v_count = row_count;
  table_name := 'audit_step_up_attempts'; deleted_count := v_count; return next;
  delete from cblaero_app.audit_client_context_confirmations where occurred_at < v_cutoff;
  get diagnostics v_count = row_count;
  table_name := 'audit_client_context_confirmations'; deleted_count := v_count; return next;
  delete from cblaero_app.audit_data_residency_checks where occurred_at < v_cutoff;
  get diagnostics v_count = row_count;
  table_name := 'audit_data_residency_checks'; deleted_count := v_count; return next;
  delete from cblaero_app.audit_import_batch_accesses where occurred_at < v_cutoff;
  get diagnostics v_count = row_count;
  table_name := 'audit_import_batch_accesses'; deleted_count := v_count; return next;
end;
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.count_candidates_by_source(p_source text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
AS $function$
  select count(*) from cblaero_app.candidates where source = p_source;
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.find_candidate_ids_by_emails(p_tenant_id text, p_emails text[])
 RETURNS TABLE(id uuid, email text)
 LANGUAGE sql
 STABLE
AS $function$
  select c.id, c.email
  from cblaero_app.candidates c
  where c.tenant_id = p_tenant_id
    and c.email = any(p_emails);
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.find_dedup_field_matches(p_tenant_id text, p_normalized_phone text, p_first_name text, p_last_name text, p_exclude_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, tenant_id text, email text, phone text, first_name text, last_name text, job_title text, location text, city text, state text, skills jsonb, certifications jsonb, aircraft_experience jsonb, extra_attributes jsonb, years_of_experience text, resume_url text, linkedin_url text, source text, ingestion_state text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
begin
  return query
  select c.id, c.tenant_id, c.email, c.phone, c.first_name, c.last_name,
         c.job_title, c.location, c.city, c.state,
         c.skills, c.certifications, c.aircraft_experience,
         c.extra_attributes, c.years_of_experience,
         c.resume_url, c.linkedin_url, c.source, c.ingestion_state,
         c.created_at, c.updated_at
  from cblaero_app.candidates c
  where c.tenant_id = p_tenant_id
    and c.ingestion_state in ('active', 'pending_review')
    and (p_exclude_id is null or c.id != p_exclude_id)
    and (
      (p_normalized_phone != '' and cblaero_app.normalize_phone(c.phone) = p_normalized_phone)
      or
      (p_first_name != '' and p_last_name != '' and lower(trim(c.first_name)) = lower(trim(p_first_name)) and lower(trim(c.last_name)) = lower(trim(p_last_name)))
    )
  limit 50;
end; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.find_role_by_name_exact(p_tenant_id text, p_role_name text)
 RETURNS SETOF cblaero_app.role_taxonomy
 LANGUAGE sql
 STABLE
AS $function$
  SELECT * FROM cblaero_app.role_taxonomy
  WHERE tenant_id = p_tenant_id AND lower(role_name) = lower(p_role_name)
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.get_candidate_detail(p_candidate_id uuid, p_tenant_id text)
 RETURNS TABLE(id uuid, tenant_id text, first_name text, last_name text, middle_name text, email text, phone text, home_phone text, work_phone text, location text, address text, city text, state text, country text, postal_code text, availability_status text, ingestion_state text, current_company text, job_title text, alternate_email text, skills jsonb, certifications jsonb, experience jsonb, extra_attributes jsonb, work_authorization text, clearance text, aircraft_experience jsonb, employment_type text, current_rate text, per_diem text, has_ap_license boolean, years_of_experience text, ceipal_id text, submitted_by text, submitter_email text, shift_preference text, expected_start_date text, call_availability text, interview_availability text, veteran_status text, resume_url text, source text, source_batch_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, deduced_roles jsonb, availability_last_signal_at timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  select c.id, c.tenant_id, c.first_name, c.last_name, c.middle_name,
    c.email, c.phone, c.home_phone, c.work_phone,
    c.location, c.address, c.city, c.state, c.country, c.postal_code,
    c.availability_status, c.ingestion_state,
    c.current_company, c.job_title, c.alternate_email,
    c.skills, c.certifications, c.experience, c.extra_attributes,
    c.work_authorization, c.clearance, c.aircraft_experience,
    c.employment_type, c.current_rate, c.per_diem, c.has_ap_license,
    c.years_of_experience, c.ceipal_id, c.submitted_by, c.submitter_email,
    c.shift_preference, c.expected_start_date, c.call_availability,
    c.interview_availability, c.veteran_status, c.resume_url,
    c.source, c.source_batch_id, c.created_at, c.updated_at, c.deduced_roles,
    c.availability_last_signal_at
  from cblaero_app.candidates c
  where c.id = p_candidate_id and c.tenant_id = p_tenant_id
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.get_dedup_stats(p_tenant_id text)
 RETURNS TABLE(decision_type text, cnt bigint)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT d.decision_type, count(*) as cnt
  FROM cblaero_app.dedup_decisions d
  WHERE d.tenant_id = p_tenant_id
  GROUP BY d.decision_type;
END; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.get_last_candidate_update_by_source(p_source text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
AS $function$
  SELECT updated_at FROM cblaero_app.candidates
  WHERE source = p_source
  ORDER BY updated_at DESC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.load_recent_fingerprints(p_tenant_id text, p_type text, p_days integer DEFAULT 30, p_max_count integer DEFAULT 100000)
 RETURNS TABLE(fingerprint_hash text)
 LANGUAGE sql
 STABLE
AS $function$
  select cf.fingerprint_hash from cblaero_app.content_fingerprints cf
  where cf.tenant_id = p_tenant_id and cf.fingerprint_type = p_type
    and cf.status = 'processed' and cf.created_at >= now() - (p_days || ' days')::interval
  limit p_max_count;
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.merge_candidates(p_winner_id uuid, p_loser_id uuid, p_merged_fields jsonb, p_decision jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_winner_tenant text; v_loser_tenant text;
begin
  select tenant_id into v_winner_tenant from cblaero_app.candidates where id = p_winner_id;
  select tenant_id into v_loser_tenant from cblaero_app.candidates where id = p_loser_id;
  if v_winner_tenant is null or v_loser_tenant is null then
    raise exception 'Candidate not found: winner=% loser=%', p_winner_id, p_loser_id;
  end if;
  if v_winner_tenant != v_loser_tenant then
    raise exception 'Cannot merge candidates from different tenants';
  end if;

  update cblaero_app.candidates set
    extra_attributes = extra_attributes
      || jsonb_build_object('original_email', email)
      || jsonb_build_object('original_phone', phone)
      || jsonb_build_object('merged_into', p_winner_id::text),
    email = null, phone = null,
    ingestion_state = 'merged', updated_at = now()
  where id = p_loser_id;

  update cblaero_app.candidates set
    first_name = coalesce(p_merged_fields->>'first_name', first_name),
    last_name = coalesce(p_merged_fields->>'last_name', last_name),
    phone = coalesce(p_merged_fields->>'phone', phone),
    email = coalesce(p_merged_fields->>'email', email),
    job_title = coalesce(p_merged_fields->>'job_title', job_title),
    location = coalesce(p_merged_fields->>'location', location),
    city = coalesce(p_merged_fields->>'city', city),
    state = coalesce(p_merged_fields->>'state', state),
    resume_url = coalesce(p_merged_fields->>'resume_url', resume_url),
    linkedin_url = coalesce(p_merged_fields->>'linkedin_url', linkedin_url),
    years_of_experience = coalesce(p_merged_fields->>'years_of_experience', years_of_experience),
    skills = coalesce(p_merged_fields->'skills', skills),
    certifications = coalesce(p_merged_fields->'certifications', certifications),
    aircraft_experience = coalesce(p_merged_fields->'aircraft_experience', aircraft_experience),
    extra_attributes = coalesce(p_merged_fields->'extra_attributes', extra_attributes),
    ingestion_state = 'active', updated_at = now()
  where id = p_winner_id;

  update cblaero_app.content_fingerprints set candidate_id = p_winner_id where candidate_id = p_loser_id;
  update cblaero_app.candidate_submissions set candidate_id = p_winner_id where candidate_id = p_loser_id;

  insert into cblaero_app.dedup_decisions (
    tenant_id, candidate_a_id, candidate_b_id, decision_type,
    confidence_score, rationale, actor, trace_id, metadata
  ) values (
    v_winner_tenant, p_winner_id, p_loser_id,
    p_decision->>'decision_type', (p_decision->>'confidence_score')::numeric,
    p_decision->>'rationale', coalesce(p_decision->>'actor', 'system'),
    p_decision->>'trace_id', coalesce(p_decision->'metadata', '{}'::jsonb)
  );
end; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.normalize_phone(phone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT regexp_replace(phone, '\D', '', 'g');
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.normalize_title(p_title text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT lower(trim(regexp_replace(
    trim(p_title),
    '^\s*(sr\.?\s+|senior\s+|lead\s+|principal\s+|chief\s+|staff\s+|associate\s+|junior\s+|jr\.?\s+|executive\s+)',
    '',
    'i'
  )))
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.process_import_chunk(p_batch_id uuid, p_candidates jsonb, p_error_rows jsonb DEFAULT '[]'::jsonb, p_total_imported integer DEFAULT 0, p_total_skipped integer DEFAULT 0, p_total_errors integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cblaero_app'
AS $function$
declare
  v_candidate jsonb;
  v_error jsonb;
  v_chunk_inserted int := 0;
  v_chunk_updated int := 0;
  v_chunk_errors int := 0;
  v_xmax bigint;
  v_email text;
  v_phone text;
  v_row_number int;
  v_raw_data jsonb;
  v_first_name text;
  v_last_name text;
  v_middle_name text;
  v_home_phone text;
  v_work_phone text;
  v_address text;
  v_city text;
  v_state text;
  v_country text;
  v_postal_code text;
  v_current_company text;
  v_job_title text;
  v_alternate_email text;
  v_resume_url text;
  v_linkedin_url text;
  v_deduced_roles jsonb;
begin
  for v_error in select value from jsonb_array_elements(coalesce(p_error_rows, '[]'::jsonb)) loop
    insert into cblaero_app.import_row_error (
      batch_id, row_number, raw_data, error_code, error_detail
    )
    values (
      p_batch_id,
      coalesce((v_error->>'row_number')::int, 0),
      coalesce(v_error->'raw_data', '{}'::jsonb),
      coalesce(v_error->>'error_code', 'parse_error'),
      v_error->>'error_detail'
    );
    v_chunk_errors := v_chunk_errors + 1;
  end loop;

  for v_candidate in select value from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) loop
    v_email := nullif(trim(v_candidate->>'email'), '');
    v_phone := nullif(trim(v_candidate->>'phone'), '');
    v_row_number := nullif(v_candidate->>'row_number', '')::int;
    v_raw_data := coalesce(v_candidate->'raw_data', '{}'::jsonb);
    v_first_name := nullif(trim(coalesce(v_candidate->>'first_name', '')), '');
    v_last_name := nullif(trim(coalesce(v_candidate->>'last_name', '')), '');
    v_middle_name := nullif(trim(coalesce(v_candidate->>'middle_name', '')), '');
    v_home_phone := nullif(trim(coalesce(v_candidate->>'home_phone', '')), '');
    v_work_phone := nullif(trim(coalesce(v_candidate->>'work_phone', '')), '');
    v_address := nullif(trim(coalesce(v_candidate->>'address', '')), '');
    v_city := nullif(trim(coalesce(v_candidate->>'city', '')), '');
    v_state := nullif(trim(coalesce(v_candidate->>'state', '')), '');
    v_country := nullif(trim(coalesce(v_candidate->>'country', '')), '');
    v_postal_code := nullif(trim(coalesce(v_candidate->>'postal_code', '')), '');
    v_current_company := nullif(trim(coalesce(v_candidate->>'current_company', '')), '');
    v_job_title := nullif(trim(coalesce(v_candidate->>'job_title', '')), '');
    v_alternate_email := nullif(trim(coalesce(v_candidate->>'alternate_email', '')), '');
    v_resume_url := nullif(trim(coalesce(v_candidate->>'resume_url', '')), '');
    v_linkedin_url := nullif(trim(coalesce(v_candidate->>'linkedin_url', '')), '');
    v_deduced_roles := coalesce(v_candidate->'deduced_roles', '[]'::jsonb);

    if v_email is null and v_phone is null then
      insert into cblaero_app.import_row_error (
        batch_id, row_number, raw_data, error_code, error_detail
      )
      values (
        p_batch_id,
        coalesce(v_row_number, 0),
        v_raw_data,
        'missing_identity',
        'Row must have at least one of: email, phone'
      );
      v_chunk_errors := v_chunk_errors + 1;
      continue;
    end if;

    begin
      if v_email is not null then
        insert into cblaero_app.candidates (
          tenant_id, email, phone, first_name, last_name, middle_name,
          home_phone, work_phone, location, address, city, state, country,
          postal_code, current_company, job_title, alternate_email,
          skills, certifications, experience, extra_attributes,
          availability_status, ingestion_state, source, source_batch_id,
          created_by_actor_id, resume_url, linkedin_url, deduced_roles, updated_at
        )
        values (
          v_candidate->>'tenant_id', v_email, v_phone,
          v_first_name, v_last_name, v_middle_name,
          v_home_phone, v_work_phone,
          nullif(v_candidate->>'location', ''),
          v_address, v_city, v_state, v_country, v_postal_code,
          v_current_company, v_job_title, v_alternate_email,
          coalesce(v_candidate->'skills', '[]'::jsonb),
          coalesce(v_candidate->'certifications', '[]'::jsonb),
          coalesce(v_candidate->'experience', '[]'::jsonb),
          coalesce(v_candidate->'extra_attributes', '{}'::jsonb),
          coalesce(v_candidate->>'availability_status', 'passive'),
          coalesce(v_candidate->>'ingestion_state', 'pending_dedup'),
          coalesce(v_candidate->>'source', 'migration'),
          coalesce((v_candidate->>'source_batch_id')::uuid, p_batch_id),
          nullif(trim(coalesce(v_candidate->>'created_by_actor_id', '')), ''),
          v_resume_url, v_linkedin_url, v_deduced_roles,
          coalesce((v_candidate->>'updated_at')::timestamptz, now())
        )
        on conflict (tenant_id, email) where email is not null
        do update set
          phone = excluded.phone,
          first_name = excluded.first_name, last_name = excluded.last_name,
          middle_name = excluded.middle_name,
          home_phone = excluded.home_phone, work_phone = excluded.work_phone,
          location = excluded.location,
          address = excluded.address, city = excluded.city, state = excluded.state,
          country = excluded.country, postal_code = excluded.postal_code,
          current_company = excluded.current_company, job_title = excluded.job_title,
          alternate_email = excluded.alternate_email,
          skills = excluded.skills, certifications = excluded.certifications,
          experience = excluded.experience, extra_attributes = excluded.extra_attributes,
          availability_status = excluded.availability_status,
          -- D1: preserve ALL non-pending_dedup states. Only pending_dedup (fresh/unprocessed) is safe to overwrite.
          ingestion_state = case
            when candidates.ingestion_state in ('active', 'pending_review', 'rejected', 'merged', 'pending_enrichment') then candidates.ingestion_state
            else excluded.ingestion_state
          end,
          source = excluded.source,
          source_batch_id = excluded.source_batch_id,
          created_by_actor_id = coalesce(candidates.created_by_actor_id, excluded.created_by_actor_id),
          resume_url = coalesce(excluded.resume_url, candidates.resume_url),
          linkedin_url = coalesce(excluded.linkedin_url, candidates.linkedin_url),
          deduced_roles = excluded.deduced_roles,
          updated_at = excluded.updated_at
        returning xmax into v_xmax;
      else
        insert into cblaero_app.candidates (
          tenant_id, email, phone, first_name, last_name, middle_name,
          home_phone, work_phone, location, address, city, state, country,
          postal_code, current_company, job_title, alternate_email,
          skills, certifications, experience, extra_attributes,
          availability_status, ingestion_state, source, source_batch_id,
          created_by_actor_id, resume_url, linkedin_url, deduced_roles, updated_at
        )
        values (
          v_candidate->>'tenant_id', v_email, v_phone,
          v_first_name, v_last_name, v_middle_name, v_home_phone, v_work_phone,
          nullif(v_candidate->>'location', ''), v_address, v_city, v_state,
          v_country, v_postal_code, v_current_company, v_job_title, v_alternate_email,
          coalesce(v_candidate->'skills', '[]'::jsonb),
          coalesce(v_candidate->'certifications', '[]'::jsonb),
          coalesce(v_candidate->'experience', '[]'::jsonb),
          coalesce(v_candidate->'extra_attributes', '{}'::jsonb),
          coalesce(v_candidate->>'availability_status', 'passive'),
          coalesce(v_candidate->>'ingestion_state', 'pending_dedup'),
          coalesce(v_candidate->>'source', 'migration'),
          coalesce((v_candidate->>'source_batch_id')::uuid, p_batch_id),
          nullif(trim(coalesce(v_candidate->>'created_by_actor_id', '')), ''),
          v_resume_url, v_linkedin_url, v_deduced_roles,
          coalesce((v_candidate->>'updated_at')::timestamptz, now())
        )
        on conflict (tenant_id, phone) where phone is not null
        do update set
          email = excluded.email,
          first_name = excluded.first_name, last_name = excluded.last_name,
          middle_name = excluded.middle_name, home_phone = excluded.home_phone,
          work_phone = excluded.work_phone, location = excluded.location,
          address = excluded.address, city = excluded.city, state = excluded.state,
          country = excluded.country, postal_code = excluded.postal_code,
          current_company = excluded.current_company, job_title = excluded.job_title,
          alternate_email = excluded.alternate_email, skills = excluded.skills,
          certifications = excluded.certifications, experience = excluded.experience,
          extra_attributes = excluded.extra_attributes,
          availability_status = excluded.availability_status,
          -- D1: preserve ALL non-pending_dedup states. Only pending_dedup (fresh/unprocessed) is safe to overwrite.
          ingestion_state = case
            when candidates.ingestion_state in ('active', 'pending_review', 'rejected', 'merged', 'pending_enrichment') then candidates.ingestion_state
            else excluded.ingestion_state
          end,
          source = excluded.source,
          source_batch_id = excluded.source_batch_id,
          created_by_actor_id = coalesce(candidates.created_by_actor_id, excluded.created_by_actor_id),
          resume_url = coalesce(excluded.resume_url, candidates.resume_url),
          linkedin_url = coalesce(excluded.linkedin_url, candidates.linkedin_url),
          deduced_roles = excluded.deduced_roles,
          updated_at = excluded.updated_at
        returning xmax into v_xmax;
      end if;

      if v_xmax = 0 then
        v_chunk_inserted := v_chunk_inserted + 1;
      else
        v_chunk_updated := v_chunk_updated + 1;
      end if;
    exception
      when others then
        insert into cblaero_app.import_row_error (
          batch_id, row_number, raw_data, error_code, error_detail
        )
        values (
          p_batch_id,
          coalesce(v_row_number, 0),
          v_raw_data,
          'upsert_failure',
          sqlerrm
        );
        v_chunk_errors := v_chunk_errors + 1;
    end;
  end loop;

  update cblaero_app.import_batch
  set imported = p_total_imported + v_chunk_inserted + v_chunk_updated,
      skipped = p_total_skipped,
      errors = p_total_errors + v_chunk_errors,
      updated_at = now()
  where id = p_batch_id;

  return jsonb_build_object(
    'inserted', v_chunk_inserted,
    'updated', v_chunk_updated,
    'errors', v_chunk_errors,
    'imported', v_chunk_inserted + v_chunk_updated
  );
end;
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.rollback_import_batch(p_batch_id uuid)
 RETURNS TABLE(deleted_candidates bigint)
 LANGUAGE plpgsql
AS $function$
declare v_count bigint;
begin
  delete from cblaero_app.candidates where source_batch_id = p_batch_id;
  get diagnostics v_count = row_count;
  update cblaero_app.import_batch set status = 'rolled_back', completed_at = now() where id = p_batch_id;
  deleted_candidates := v_count;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.search_candidates(p_tenant_id text, p_search text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_job_title text DEFAULT NULL::text, p_skills text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_availability_status text DEFAULT NULL::text, p_work_authorization text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_employment_type text DEFAULT NULL::text, p_years_of_experience numeric DEFAULT NULL::numeric, p_veteran_status text DEFAULT NULL::text, p_has_ap_license boolean DEFAULT NULL::boolean, p_cert_type text DEFAULT NULL::text, p_current_company text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_shift_preference text DEFAULT NULL::text, p_created_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_created_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_deduced_role text DEFAULT NULL::text, p_sort_by text DEFAULT 'created_at'::text, p_sort_dir text DEFAULT 'desc'::text, p_cursor_id uuid DEFAULT NULL::uuid, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 25)
 RETURNS TABLE(id uuid, tenant_id text, first_name text, last_name text, email text, phone text, location text, city text, state text, availability_status text, ingestion_state text, job_title text, skills jsonb, years_of_experience text, source text, source_batch_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, deduced_roles jsonb, availability_last_signal_at timestamp with time zone, linkedin_url text)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_tsquery tsquery;
begin
  if p_search is not null and trim(p_search) != '' then
    v_tsquery := to_tsquery('english',
      array_to_string(array(select s || ':*' from unnest(string_to_array(trim(p_search), ' ')) as s where s != ''), ' & ')
    );
  end if;
  return query
  select c.id, c.tenant_id, c.first_name, c.last_name, c.email, c.phone,
    c.location, c.city, c.state, c.availability_status, c.ingestion_state,
    c.job_title, c.skills, c.years_of_experience, c.source,
    c.source_batch_id, c.created_at, c.updated_at, c.deduced_roles,
    c.availability_last_signal_at, c.linkedin_url
  from cblaero_app.candidates c
  where c.tenant_id = p_tenant_id and c.ingestion_state = 'active'
    and (p_cursor_created_at is null or (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id))
    and (v_tsquery is null or c.name_tsv @@ v_tsquery)
    and (p_email is null or c.email ilike '%' || p_email || '%')
    and (p_job_title is null or c.job_title ilike '%' || p_job_title || '%')
    and (p_skills is null or c.skills::text ilike '%' || p_skills || '%')
    and (p_city is null or c.city ilike '%' || p_city || '%')
    and (p_state is null or c.state ilike '%' || p_state || '%')
    and (p_work_authorization is null or c.work_authorization ilike '%' || p_work_authorization || '%')
    and (p_current_company is null or c.current_company ilike '%' || p_current_company || '%')
    and (p_phone is null or c.phone ilike '%' || p_phone || '%')
    and (p_shift_preference is null or c.shift_preference ilike '%' || p_shift_preference || '%')
    and (p_availability_status is null or c.availability_status = p_availability_status)
    and (p_source is null or c.source = p_source)
    and (p_employment_type is null or c.employment_type = p_employment_type)
    and (p_veteran_status is null or c.veteran_status = p_veteran_status)
    and (p_has_ap_license is null or c.has_ap_license = p_has_ap_license)
    and (p_cert_type is null or c.certifications @> jsonb_build_array(jsonb_build_object('type', p_cert_type)))
    and (p_years_of_experience is null or (c.years_of_experience is not null and c.years_of_experience != '' and c.years_of_experience::numeric >= p_years_of_experience))
    and (p_created_after is null or c.created_at >= p_created_after)
    and (p_created_before is null or c.created_at < (p_created_before + interval '1 day'))
    and (p_deduced_role is null or c.deduced_roles @> jsonb_build_array(p_deduced_role))
  order by
    case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then c.created_at end desc nulls last,
    case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then c.created_at end asc nulls last,
    case when p_sort_by = 'years_of_experience' and p_sort_dir = 'desc' then c.years_of_experience end desc nulls last,
    case when p_sort_by = 'years_of_experience' and p_sort_dir = 'asc' then c.years_of_experience end asc nulls last,
    case when p_sort_by = 'first_name' and p_sort_dir = 'asc' then c.first_name end asc nulls last,
    case when p_sort_by = 'first_name' and p_sort_dir = 'desc' then c.first_name end desc nulls last,
    case when p_sort_by = 'job_title' and p_sort_dir = 'asc' then c.job_title end asc nulls last,
    case when p_sort_by = 'job_title' and p_sort_dir = 'desc' then c.job_title end desc nulls last,
    c.id desc
  limit p_limit + 1;
end;
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.search_candidates(p_tenant_id text, p_search text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_job_title text DEFAULT NULL::text, p_skills text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_availability_status text DEFAULT NULL::text, p_work_authorization text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_employment_type text DEFAULT NULL::text, p_years_of_experience numeric DEFAULT NULL::numeric, p_veteran_status text DEFAULT NULL::text, p_has_ap_license boolean DEFAULT NULL::boolean, p_cert_type text DEFAULT NULL::text, p_current_company text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_shift_preference text DEFAULT NULL::text, p_created_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_created_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_deduced_role text DEFAULT NULL::text, p_sort_by text DEFAULT 'created_at'::text, p_sort_dir text DEFAULT 'desc'::text, p_cursor_id uuid DEFAULT NULL::uuid, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 25)
 RETURNS TABLE(id uuid, tenant_id text, first_name text, last_name text, email text, phone text, location text, city text, state text, availability_status text, ingestion_state text, job_title text, skills jsonb, years_of_experience text, source text, source_batch_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, deduced_roles jsonb, availability_last_signal_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_tsquery tsquery;
begin
  if p_search is not null and trim(p_search) != '' then
    v_tsquery := to_tsquery('english',
      array_to_string(array(select s || ':*' from unnest(string_to_array(trim(p_search), ' ')) as s where s != ''), ' & ')
    );
  end if;
  return query
  select c.id, c.tenant_id, c.first_name, c.last_name, c.email, c.phone,
    c.location, c.city, c.state, c.availability_status, c.ingestion_state,
    c.job_title, c.skills, c.years_of_experience, c.source,
    c.source_batch_id, c.created_at, c.updated_at, c.deduced_roles,
    c.availability_last_signal_at
  from cblaero_app.candidates c
  where c.tenant_id = p_tenant_id and c.ingestion_state = 'active'
    and (p_cursor_created_at is null or (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id))
    and (v_tsquery is null or c.name_tsv @@ v_tsquery)
    and (p_email is null or c.email ilike '%' || p_email || '%')
    and (p_job_title is null or c.job_title ilike '%' || p_job_title || '%')
    and (p_skills is null or c.skills::text ilike '%' || p_skills || '%')
    and (p_city is null or c.city ilike '%' || p_city || '%')
    and (p_state is null or c.state ilike '%' || p_state || '%')
    and (p_work_authorization is null or c.work_authorization ilike '%' || p_work_authorization || '%')
    and (p_current_company is null or c.current_company ilike '%' || p_current_company || '%')
    and (p_phone is null or c.phone ilike '%' || p_phone || '%')
    and (p_shift_preference is null or c.shift_preference ilike '%' || p_shift_preference || '%')
    and (p_availability_status is null or c.availability_status = p_availability_status)
    and (p_source is null or c.source = p_source)
    and (p_employment_type is null or c.employment_type = p_employment_type)
    and (p_veteran_status is null or c.veteran_status = p_veteran_status)
    and (p_has_ap_license is null or c.has_ap_license = p_has_ap_license)
    and (p_cert_type is null or c.certifications @> jsonb_build_array(jsonb_build_object('type', p_cert_type)))
    and (p_years_of_experience is null or (c.years_of_experience is not null and c.years_of_experience != '' and c.years_of_experience::numeric >= p_years_of_experience))
    and (p_created_after is null or c.created_at >= p_created_after)
    and (p_created_before is null or c.created_at < (p_created_before + interval '1 day'))
    and (p_deduced_role is null or c.deduced_roles @> jsonb_build_array(p_deduced_role))
  order by
    case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then c.created_at end desc nulls last,
    case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then c.created_at end asc nulls last,
    case when p_sort_by = 'years_of_experience' and p_sort_dir = 'desc' then c.years_of_experience end desc nulls last,
    case when p_sort_by = 'years_of_experience' and p_sort_dir = 'asc' then c.years_of_experience end asc nulls last,
    case when p_sort_by = 'first_name' and p_sort_dir = 'asc' then c.first_name end asc nulls last,
    case when p_sort_by = 'first_name' and p_sort_dir = 'desc' then c.first_name end desc nulls last,
    case when p_sort_by = 'job_title' and p_sort_dir = 'asc' then c.job_title end asc nulls last,
    case when p_sort_by = 'job_title' and p_sort_dir = 'desc' then c.job_title end desc nulls last,
    c.id desc
  limit p_limit + 1;
end;
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.seed_aviation_roles(p_tenant_id text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE v_count int := 0;
BEGIN
  INSERT INTO cblaero_app.role_taxonomy (tenant_id, role_name, category, aliases) VALUES
    (p_tenant_id, 'A&P Aircraft Inspector', 'aviation', '["AP Aircraft Inspector", "A and P Aircraft Inspector"]'::jsonb),
    (p_tenant_id, 'A&P Mechanic', 'aviation', '["A&P Aircraft Maintenance Tech", "AP Mechanic", "Airframe and Powerplant Mechanic", "A&P AIRCRAFT MAINTENANCE TECH III", "A&P Tech"]'::jsonb),
    (p_tenant_id, 'Aircraft Maintenance Supervisor', 'aviation', '["Maintenance Supervisor", "Aircraft Maint Supervisor"]'::jsonb),
    (p_tenant_id, 'Aircraft Paint Technician', 'aviation', '["Aircraft Paint Tech"]'::jsonb),
    (p_tenant_id, 'Aircraft Painter', 'aviation', '["Painter Aircraft"]'::jsonb),
    (p_tenant_id, 'Aircraft Structures Technician/Sheet Metal', 'aviation', '["Structures Tech", "Aircraft Structures Tech"]'::jsonb),
    (p_tenant_id, 'Aircraft Welder', 'aviation', '["Aviation Welder", "Welder Aircraft"]'::jsonb),
    (p_tenant_id, 'Avionics Technician', 'aviation', '["Avionics Tech", "AVIONICS TECH", "Avionics Installer"]'::jsonb),
    (p_tenant_id, 'Cabinet Builder', 'aviation', '["Aviation Cabinet Builder", "Cabinet Maker"]'::jsonb),
    (p_tenant_id, 'Cabinet Finisher (Painter)', 'aviation', '["Cabinet Finisher", "Cabinet Painter"]'::jsonb),
    (p_tenant_id, 'Chief Inspector', 'aviation', '["Chief QC Inspector"]'::jsonb),
    (p_tenant_id, 'CNC Programmer/Operator', 'aviation', '["CNC Programmer", "CNC Operator", "CNC Machinist"]'::jsonb),
    (p_tenant_id, 'Completion Lining & Upholstery', 'aviation', '["Lining and Upholstery Tech", "Completions Upholstery"]'::jsonb),
    (p_tenant_id, 'Completions Interior Tech', 'aviation', '["Interior Completions Tech", "Completions Interior Technician"]'::jsonb),
    (p_tenant_id, 'Completions System', 'aviation', '["Completions Systems Tech", "Systems Completions"]'::jsonb),
    (p_tenant_id, 'Composite Technician', 'aviation', '["Composite Tech", "Composites Technician"]'::jsonb),
    (p_tenant_id, 'Evaluation Inspector', 'aviation', '["Eval Inspector"]'::jsonb),
    (p_tenant_id, 'Evaluation Structures Technician', 'aviation', '["Eval Structures Tech"]'::jsonb),
    (p_tenant_id, 'Evaluation Teardown Inspector', 'aviation', '["Teardown Inspector", "Eval Teardown Inspector"]'::jsonb),
    (p_tenant_id, 'Final Inspector', 'aviation', '["Final QC Inspector"]'::jsonb),
    (p_tenant_id, 'Finish Application Tech', 'aviation', '["Finish App Tech", "Finish Application Technician"]'::jsonb),
    (p_tenant_id, 'Finish Shop Lead', 'aviation', '["Finish Shop Supervisor"]'::jsonb),
    (p_tenant_id, 'General Building Maintenance Technician', 'aviation', '["Building Maintenance Tech", "Facilities Maintenance"]'::jsonb),
    (p_tenant_id, 'Interior Technician', 'aviation', '["Interior Tech", "Aircraft Interior Tech"]'::jsonb),
    (p_tenant_id, 'Landing Gear Inspector', 'aviation', '["Landing Gear QC Inspector"]'::jsonb),
    (p_tenant_id, 'Maintenance Instructor', 'aviation', '["Aviation Maintenance Instructor"]'::jsonb),
    (p_tenant_id, 'Maintenance Planner', 'aviation', '["Aircraft Maintenance Planner", "MRO Planner"]'::jsonb),
    (p_tenant_id, 'MRO A&P Maintenance Technician', 'aviation', '["MRO A&P Tech", "MRO Maintenance Tech"]'::jsonb),
    (p_tenant_id, 'MRO Avionics Technician', 'aviation', '["MRO Avionics Tech"]'::jsonb),
    (p_tenant_id, 'MRO Interiors Technician', 'aviation', '["MRO Interior Tech", "MRO Interiors Tech"]'::jsonb),
    (p_tenant_id, 'NDT Administrative', 'aviation', '["NDT Admin"]'::jsonb),
    (p_tenant_id, 'NDT Level II Technician', 'aviation', '["NDT Tech", "NDT Level 2", "Non Destructive Testing Tech"]'::jsonb),
    (p_tenant_id, 'Paint Inspector', 'aviation', '["Paint QC Inspector"]'::jsonb),
    (p_tenant_id, 'Paint Prepper', 'aviation', '["Paint Prep Tech", "Surface Prep"]'::jsonb),
    (p_tenant_id, 'Paint Technician', 'aviation', '["Paint Tech"]'::jsonb),
    (p_tenant_id, 'Painter', 'aviation', '["Aircraft Painter General"]'::jsonb),
    (p_tenant_id, 'QC Inspector', 'aviation', '["Quality Control Inspector", "QA Inspector"]'::jsonb),
    (p_tenant_id, 'QC Lead Inspector', 'aviation', '["Lead QC Inspector", "QC Lead"]'::jsonb),
    (p_tenant_id, 'Quality Engineer (Evaluator)', 'aviation', '["Quality Engineer", "QE Evaluator"]'::jsonb),
    (p_tenant_id, 'Sheet Metal Fabricator', 'aviation', '["Sheet Metal Fab", "Metal Fabricator"]'::jsonb),
    (p_tenant_id, 'Sheet Metal Technician', 'aviation', '["Sheet Metal Tech", "Aircraft Structures Technician/Sheet Metal"]'::jsonb),
    (p_tenant_id, 'SR. Technical Writer', 'aviation', '["Senior Technical Writer", "Sr Tech Writer"]'::jsonb),
    (p_tenant_id, 'Structures Mechanic', 'aviation', '["Structural Mechanic"]'::jsonb),
    (p_tenant_id, 'Structures Technician', 'aviation', '["Structures Tech"]'::jsonb),
    (p_tenant_id, 'Upholstery Fabrication Tech', 'aviation', '["Upholstery Tech", "Upholstery Fabrication Technician"]'::jsonb),
    (p_tenant_id, 'Wire Fabrication Technician', 'aviation', '["Wire Fab Tech", "Wiring Technician"]'::jsonb),
    (p_tenant_id, 'Wire Harness Fab Shop Lead', 'aviation', '["Wire Harness Lead", "Harness Fab Lead"]'::jsonb)
  ON CONFLICT (tenant_id, lower(role_name)) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.update_availability_status(p_tenant_id text, p_candidate_id uuid, p_new_state text, p_source text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_previous_state text;
  v_signal_id bigint;
BEGIN
  SELECT availability_status INTO v_previous_state
  FROM cblaero_app.candidates
  WHERE id = p_candidate_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate not found: % in tenant %', p_candidate_id, p_tenant_id;
  END IF;

  -- Guard against NULL for pre-migration rows
  IF v_previous_state IS NULL THEN
    v_previous_state := 'passive';
  END IF;

  UPDATE cblaero_app.candidates
  SET availability_status = p_new_state,
      availability_last_signal_at = now(),
      updated_at = now()
  WHERE id = p_candidate_id AND tenant_id = p_tenant_id;

  INSERT INTO cblaero_app.candidate_availability_signals
    (tenant_id, candidate_id, previous_state, new_state, source, metadata)
  VALUES
    (p_tenant_id, p_candidate_id, v_previous_state, p_new_state, p_source, p_metadata)
  RETURNING id INTO v_signal_id;

  RETURN jsonb_build_object(
    'signal_id', v_signal_id,
    'previous_state', v_previous_state,
    'new_state', p_new_state,
    'source', p_source
  );
END;
$function$;

CREATE OR REPLACE FUNCTION cblaero_app.upsert_candidate(p_candidate jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_id uuid;
  v_email text := nullif(trim(coalesce(p_candidate->>'email', '')), '');
  v_phone text := nullif(trim(coalesce(p_candidate->>'phone', '')), '');
  v_first_name text := nullif(trim(coalesce(p_candidate->>'first_name', '')), '');
  v_last_name text := nullif(trim(coalesce(p_candidate->>'last_name', '')), '');
begin
  if v_email is not null and v_email != '' then
    insert into cblaero_app.candidates (
      tenant_id, email, phone, first_name, last_name, middle_name,
      home_phone, work_phone, location, address, city, state, country,
      postal_code, current_company, job_title, alternate_email,
      skills, certifications, experience, extra_attributes,
      availability_status, ingestion_state, source, source_batch_id,
      created_by_actor_id, resume_url, linkedin_url,
      work_authorization, clearance, aircraft_experience, employment_type,
      current_rate, per_diem, has_ap_license, years_of_experience,
      ceipal_id, submitted_by, submitter_email, shift_preference,
      expected_start_date, call_availability, interview_availability, veteran_status,
      updated_at
    )
    values (
      p_candidate->>'tenant_id', v_email, v_phone, v_first_name, v_last_name,
      nullif(trim(coalesce(p_candidate->>'middle_name', '')), ''),
      nullif(trim(coalesce(p_candidate->>'home_phone', '')), ''),
      nullif(trim(coalesce(p_candidate->>'work_phone', '')), ''),
      nullif(p_candidate->>'location', ''),
      nullif(trim(coalesce(p_candidate->>'address', '')), ''),
      nullif(trim(coalesce(p_candidate->>'city', '')), ''),
      nullif(trim(coalesce(p_candidate->>'state', '')), ''),
      nullif(trim(coalesce(p_candidate->>'country', '')), ''),
      nullif(trim(coalesce(p_candidate->>'postal_code', '')), ''),
      nullif(trim(coalesce(p_candidate->>'current_company', '')), ''),
      nullif(trim(coalesce(p_candidate->>'job_title', '')), ''),
      nullif(trim(coalesce(p_candidate->>'alternate_email', '')), ''),
      coalesce(p_candidate->'skills', '[]'::jsonb),
      coalesce(p_candidate->'certifications', '[]'::jsonb),
      coalesce(p_candidate->'experience', '[]'::jsonb),
      coalesce(p_candidate->'extra_attributes', '{}'::jsonb),
      coalesce(p_candidate->>'availability_status', 'passive'),
      coalesce(p_candidate->>'ingestion_state', 'pending_dedup'),
      coalesce(p_candidate->>'source', 'email'),
      (p_candidate->>'source_batch_id')::uuid,
      nullif(trim(coalesce(p_candidate->>'created_by_actor_id', '')), ''),
      nullif(trim(coalesce(p_candidate->>'resume_url', '')), ''),
      nullif(trim(coalesce(p_candidate->>'linkedin_url', '')), ''),
      nullif(trim(coalesce(p_candidate->>'work_authorization', '')), ''),
      nullif(trim(coalesce(p_candidate->>'clearance', '')), ''),
      coalesce(p_candidate->'aircraft_experience', '[]'::jsonb),
      nullif(trim(coalesce(p_candidate->>'employment_type', '')), ''),
      nullif(trim(coalesce(p_candidate->>'current_rate', '')), ''),
      nullif(trim(coalesce(p_candidate->>'per_diem', '')), ''),
      (p_candidate->>'has_ap_license')::boolean,
      nullif(trim(coalesce(p_candidate->>'years_of_experience', '')), ''),
      nullif(trim(coalesce(p_candidate->>'ceipal_id', '')), ''),
      nullif(trim(coalesce(p_candidate->>'submitted_by', '')), ''),
      nullif(trim(coalesce(p_candidate->>'submitter_email', '')), ''),
      nullif(trim(coalesce(p_candidate->>'shift_preference', '')), ''),
      nullif(trim(coalesce(p_candidate->>'expected_start_date', '')), ''),
      nullif(trim(coalesce(p_candidate->>'call_availability', '')), ''),
      nullif(trim(coalesce(p_candidate->>'interview_availability', '')), ''),
      nullif(trim(coalesce(p_candidate->>'veteran_status', '')), ''),
      now()
    )
    on conflict (tenant_id, email) where email is not null
    do update set
      first_name = excluded.first_name, last_name = excluded.last_name,
      phone = coalesce(excluded.phone, cblaero_app.candidates.phone),
      job_title = coalesce(excluded.job_title, cblaero_app.candidates.job_title),
      skills = case when excluded.skills != '[]'::jsonb then excluded.skills else cblaero_app.candidates.skills end,
      certifications = case when excluded.certifications != '[]'::jsonb then excluded.certifications else cblaero_app.candidates.certifications end,
      availability_status = excluded.availability_status,
      ingestion_state = case
        when cblaero_app.candidates.ingestion_state in ('active', 'pending_review') then cblaero_app.candidates.ingestion_state
        else excluded.ingestion_state
      end,
      source = excluded.source, source_batch_id = excluded.source_batch_id,
      resume_url = coalesce(excluded.resume_url, cblaero_app.candidates.resume_url),
      linkedin_url = coalesce(excluded.linkedin_url, cblaero_app.candidates.linkedin_url),
      updated_at = now()
    returning id into v_id;
  else
    insert into cblaero_app.candidates (
      tenant_id, email, phone, first_name, last_name, middle_name,
      home_phone, work_phone, location, address, city, state, country,
      postal_code, current_company, job_title, alternate_email,
      skills, certifications, experience, extra_attributes,
      availability_status, ingestion_state, source, source_batch_id,
      created_by_actor_id, resume_url, linkedin_url,
      work_authorization, clearance, aircraft_experience, employment_type,
      current_rate, per_diem, has_ap_license, years_of_experience,
      ceipal_id, submitted_by, submitter_email, shift_preference,
      expected_start_date, call_availability, interview_availability, veteran_status,
      updated_at
    )
    values (
      p_candidate->>'tenant_id', v_email, v_phone, v_first_name, v_last_name,
      nullif(trim(coalesce(p_candidate->>'middle_name', '')), ''),
      nullif(trim(coalesce(p_candidate->>'home_phone', '')), ''),
      nullif(trim(coalesce(p_candidate->>'work_phone', '')), ''),
      nullif(p_candidate->>'location', ''),
      nullif(trim(coalesce(p_candidate->>'address', '')), ''),
      nullif(trim(coalesce(p_candidate->>'city', '')), ''),
      nullif(trim(coalesce(p_candidate->>'state', '')), ''),
      nullif(trim(coalesce(p_candidate->>'country', '')), ''),
      nullif(trim(coalesce(p_candidate->>'postal_code', '')), ''),
      nullif(trim(coalesce(p_candidate->>'current_company', '')), ''),
      nullif(trim(coalesce(p_candidate->>'job_title', '')), ''),
      nullif(trim(coalesce(p_candidate->>'alternate_email', '')), ''),
      coalesce(p_candidate->'skills', '[]'::jsonb),
      coalesce(p_candidate->'certifications', '[]'::jsonb),
      coalesce(p_candidate->'experience', '[]'::jsonb),
      coalesce(p_candidate->'extra_attributes', '{}'::jsonb),
      coalesce(p_candidate->>'availability_status', 'passive'),
      coalesce(p_candidate->>'ingestion_state', 'pending_dedup'),
      coalesce(p_candidate->>'source', 'email'),
      (p_candidate->>'source_batch_id')::uuid,
      nullif(trim(coalesce(p_candidate->>'created_by_actor_id', '')), ''),
      nullif(trim(coalesce(p_candidate->>'resume_url', '')), ''),
      nullif(trim(coalesce(p_candidate->>'linkedin_url', '')), ''),
      nullif(trim(coalesce(p_candidate->>'work_authorization', '')), ''),
      nullif(trim(coalesce(p_candidate->>'clearance', '')), ''),
      coalesce(p_candidate->'aircraft_experience', '[]'::jsonb),
      nullif(trim(coalesce(p_candidate->>'employment_type', '')), ''),
      nullif(trim(coalesce(p_candidate->>'current_rate', '')), ''),
      nullif(trim(coalesce(p_candidate->>'per_diem', '')), ''),
      (p_candidate->>'has_ap_license')::boolean,
      nullif(trim(coalesce(p_candidate->>'years_of_experience', '')), ''),
      nullif(trim(coalesce(p_candidate->>'ceipal_id', '')), ''),
      nullif(trim(coalesce(p_candidate->>'submitted_by', '')), ''),
      nullif(trim(coalesce(p_candidate->>'submitter_email', '')), ''),
      nullif(trim(coalesce(p_candidate->>'shift_preference', '')), ''),
      nullif(trim(coalesce(p_candidate->>'expected_start_date', '')), ''),
      nullif(trim(coalesce(p_candidate->>'call_availability', '')), ''),
      nullif(trim(coalesce(p_candidate->>'interview_availability', '')), ''),
      nullif(trim(coalesce(p_candidate->>'veteran_status', '')), ''),
      now()
    )
    returning id into v_id;
  end if;
  return v_id;
end; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.upsert_candidate_batch(p_candidates jsonb)
 RETURNS TABLE(inserted integer, updated integer)
 LANGUAGE plpgsql
AS $function$
declare
  v_inserted int := 0; v_updated int := 0; v_row jsonb;
  v_email text; v_phone text; v_first_name text; v_last_name text;
  v_xmax bigint;
begin
  for v_row in select jsonb_array_elements(p_candidates)
  loop
    v_email := nullif(trim(coalesce(v_row->>'email', '')), '');
    v_phone := nullif(trim(coalesce(v_row->>'phone', '')), '');
    v_first_name := nullif(trim(coalesce(v_row->>'first_name', '')), '');
    v_last_name := nullif(trim(coalesce(v_row->>'last_name', '')), '');

    if v_email is not null and v_email != '' then
      insert into cblaero_app.candidates (
        tenant_id, email, phone, first_name, last_name, middle_name,
        home_phone, work_phone, location, address, city, state, country,
        postal_code, current_company, job_title, alternate_email,
        skills, certifications, experience, extra_attributes,
        availability_status, ingestion_state, source, source_batch_id,
        created_by_actor_id, source_recruiter_actor_id, resume_url, linkedin_url,
        work_authorization, clearance, aircraft_experience, employment_type,
        current_rate, per_diem, has_ap_license, years_of_experience,
        ceipal_id, submitted_by, submitter_email, shift_preference,
        expected_start_date, call_availability, interview_availability, veteran_status,
        updated_at
      )
      values (
        v_row->>'tenant_id', v_email, v_phone, v_first_name, v_last_name,
        nullif(trim(coalesce(v_row->>'middle_name', '')), ''),
        nullif(trim(coalesce(v_row->>'home_phone', '')), ''),
        nullif(trim(coalesce(v_row->>'work_phone', '')), ''),
        nullif(v_row->>'location', ''),
        nullif(trim(coalesce(v_row->>'address', '')), ''),
        nullif(trim(coalesce(v_row->>'city', '')), ''),
        nullif(trim(coalesce(v_row->>'state', '')), ''),
        nullif(trim(coalesce(v_row->>'country', '')), ''),
        nullif(trim(coalesce(v_row->>'postal_code', '')), ''),
        nullif(trim(coalesce(v_row->>'current_company', '')), ''),
        nullif(trim(coalesce(v_row->>'job_title', '')), ''),
        nullif(trim(coalesce(v_row->>'alternate_email', '')), ''),
        coalesce(v_row->'skills', '[]'::jsonb),
        coalesce(v_row->'certifications', '[]'::jsonb),
        coalesce(v_row->'experience', '[]'::jsonb),
        coalesce(v_row->'extra_attributes', '{}'::jsonb),
        coalesce(v_row->>'availability_status', 'passive'),
        coalesce(v_row->>'ingestion_state', 'pending_dedup'),
        coalesce(v_row->>'source', 'email'),
        (v_row->>'source_batch_id')::uuid,
        nullif(trim(coalesce(v_row->>'created_by_actor_id', '')), ''),
        nullif(trim(coalesce(v_row->>'source_recruiter_actor_id', '')), ''),
        nullif(trim(coalesce(v_row->>'resume_url', '')), ''),
        nullif(trim(coalesce(v_row->>'linkedin_url', '')), ''),
        nullif(trim(coalesce(v_row->>'work_authorization', '')), ''),
        nullif(trim(coalesce(v_row->>'clearance', '')), ''),
        coalesce(v_row->'aircraft_experience', '[]'::jsonb),
        nullif(trim(coalesce(v_row->>'employment_type', '')), ''),
        nullif(trim(coalesce(v_row->>'current_rate', '')), ''),
        nullif(trim(coalesce(v_row->>'per_diem', '')), ''),
        (v_row->>'has_ap_license')::boolean,
        nullif(trim(coalesce(v_row->>'years_of_experience', '')), ''),
        nullif(trim(coalesce(v_row->>'ceipal_id', '')), ''),
        nullif(trim(coalesce(v_row->>'submitted_by', '')), ''),
        nullif(trim(coalesce(v_row->>'submitter_email', '')), ''),
        nullif(trim(coalesce(v_row->>'shift_preference', '')), ''),
        nullif(trim(coalesce(v_row->>'expected_start_date', '')), ''),
        nullif(trim(coalesce(v_row->>'call_availability', '')), ''),
        nullif(trim(coalesce(v_row->>'interview_availability', '')), ''),
        nullif(trim(coalesce(v_row->>'veteran_status', '')), ''),
        now()
      )
      on conflict (tenant_id, email) where email is not null
      do update set
        first_name = excluded.first_name, last_name = excluded.last_name,
        phone = coalesce(excluded.phone, cblaero_app.candidates.phone),
        job_title = coalesce(excluded.job_title, cblaero_app.candidates.job_title),
        skills = case when excluded.skills != '[]'::jsonb then excluded.skills else cblaero_app.candidates.skills end,
        certifications = case when excluded.certifications != '[]'::jsonb then excluded.certifications else cblaero_app.candidates.certifications end,
        availability_status = excluded.availability_status,
        ingestion_state = case
          when cblaero_app.candidates.ingestion_state in ('active', 'pending_review', 'rejected', 'merged', 'pending_enrichment') then cblaero_app.candidates.ingestion_state
          else excluded.ingestion_state
        end,
        source = excluded.source, source_batch_id = excluded.source_batch_id,
        -- Story 2.8: preserve existing source_recruiter_actor_id if already set (do-not-overwrite rule)
        source_recruiter_actor_id = coalesce(cblaero_app.candidates.source_recruiter_actor_id, excluded.source_recruiter_actor_id),
        resume_url = coalesce(excluded.resume_url, cblaero_app.candidates.resume_url),
        linkedin_url = coalesce(excluded.linkedin_url, cblaero_app.candidates.linkedin_url),
        updated_at = now()
      returning xmax into v_xmax;

      if v_xmax = 0 then v_inserted := v_inserted + 1;
      else v_updated := v_updated + 1; end if;
    else
      insert into cblaero_app.candidates (
        tenant_id, email, phone, first_name, last_name, middle_name,
        home_phone, work_phone, location, address, city, state, country,
        postal_code, current_company, job_title, alternate_email,
        skills, certifications, experience, extra_attributes,
        availability_status, ingestion_state, source, source_batch_id,
        created_by_actor_id, source_recruiter_actor_id, resume_url, linkedin_url,
        work_authorization, clearance, aircraft_experience, employment_type,
        current_rate, per_diem, has_ap_license, years_of_experience,
        ceipal_id, submitted_by, submitter_email, shift_preference,
        expected_start_date, call_availability, interview_availability, veteran_status,
        updated_at
      )
      values (
        v_row->>'tenant_id', v_email, v_phone, v_first_name, v_last_name,
        nullif(trim(coalesce(v_row->>'middle_name', '')), ''),
        nullif(trim(coalesce(v_row->>'home_phone', '')), ''),
        nullif(trim(coalesce(v_row->>'work_phone', '')), ''),
        nullif(v_row->>'location', ''),
        nullif(trim(coalesce(v_row->>'address', '')), ''),
        nullif(trim(coalesce(v_row->>'city', '')), ''),
        nullif(trim(coalesce(v_row->>'state', '')), ''),
        nullif(trim(coalesce(v_row->>'country', '')), ''),
        nullif(trim(coalesce(v_row->>'postal_code', '')), ''),
        nullif(trim(coalesce(v_row->>'current_company', '')), ''),
        nullif(trim(coalesce(v_row->>'job_title', '')), ''),
        nullif(trim(coalesce(v_row->>'alternate_email', '')), ''),
        coalesce(v_row->'skills', '[]'::jsonb),
        coalesce(v_row->'certifications', '[]'::jsonb),
        coalesce(v_row->'experience', '[]'::jsonb),
        coalesce(v_row->'extra_attributes', '{}'::jsonb),
        coalesce(v_row->>'availability_status', 'passive'),
        coalesce(v_row->>'ingestion_state', 'pending_dedup'),
        coalesce(v_row->>'source', 'email'),
        (v_row->>'source_batch_id')::uuid,
        nullif(trim(coalesce(v_row->>'created_by_actor_id', '')), ''),
        nullif(trim(coalesce(v_row->>'source_recruiter_actor_id', '')), ''),
        nullif(trim(coalesce(v_row->>'resume_url', '')), ''),
        nullif(trim(coalesce(v_row->>'linkedin_url', '')), ''),
        nullif(trim(coalesce(v_row->>'work_authorization', '')), ''),
        nullif(trim(coalesce(v_row->>'clearance', '')), ''),
        coalesce(v_row->'aircraft_experience', '[]'::jsonb),
        nullif(trim(coalesce(v_row->>'employment_type', '')), ''),
        nullif(trim(coalesce(v_row->>'current_rate', '')), ''),
        nullif(trim(coalesce(v_row->>'per_diem', '')), ''),
        (v_row->>'has_ap_license')::boolean,
        nullif(trim(coalesce(v_row->>'years_of_experience', '')), ''),
        nullif(trim(coalesce(v_row->>'ceipal_id', '')), ''),
        nullif(trim(coalesce(v_row->>'submitted_by', '')), ''),
        nullif(trim(coalesce(v_row->>'submitter_email', '')), ''),
        nullif(trim(coalesce(v_row->>'shift_preference', '')), ''),
        nullif(trim(coalesce(v_row->>'expected_start_date', '')), ''),
        nullif(trim(coalesce(v_row->>'call_availability', '')), ''),
        nullif(trim(coalesce(v_row->>'interview_availability', '')), ''),
        nullif(trim(coalesce(v_row->>'veteran_status', '')), ''),
        now()
      );
      v_inserted := v_inserted + 1;
    end if;
  end loop;
  inserted := v_inserted; updated := v_updated; return next;
end; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.upsert_clay_hourly_sync_run(p_accepted integer, p_skipped integer, p_errored integer)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_id uuid;
  v_bucket timestamptz := date_trunc('hour', now() at time zone 'utc') at time zone 'utc';
begin
  insert into cblaero_app.sync_runs (
    source, status, started_at, completed_at,
    succeeded, failed, total
  ) values (
    'clay_enrichment', 'complete', v_bucket, now(),
    p_accepted, p_errored, p_accepted + p_skipped + p_errored
  )
  on conflict (source, started_at) where source = 'clay_enrichment' do update
    set succeeded    = cblaero_app.sync_runs.succeeded + excluded.succeeded,
        failed       = cblaero_app.sync_runs.failed + excluded.failed,
        total        = cblaero_app.sync_runs.total + excluded.total,
        completed_at = now(),
        status       = 'complete'
  returning id into v_id;
  return v_id;
end; $function$;

CREATE OR REPLACE FUNCTION cblaero_app.upsert_fingerprint_batch(p_fingerprints jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  insert into cblaero_app.content_fingerprints
    (tenant_id, fingerprint_type, fingerprint_hash, source, status, candidate_id, metadata)
  select
    (f->>'tenant_id'),
    (f->>'fingerprint_type'),
    (f->>'fingerprint_hash'),
    (f->>'source'),
    coalesce(f->>'status', 'processed'),
    (f->>'candidate_id')::uuid,
    coalesce((f->'metadata')::jsonb, '{}'::jsonb)
  from jsonb_array_elements(p_fingerprints) as f
  on conflict (tenant_id, fingerprint_type, fingerprint_hash) do update
    set status = excluded.status,
        candidate_id = excluded.candidate_id,
        metadata = excluded.metadata;
end; $function$;

