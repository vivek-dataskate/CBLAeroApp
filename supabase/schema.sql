-- CBLAero Supabase/Postgres schema bootstrap
-- Run in Supabase SQL Editor.
-- If you want a different schema name, replace cblaero_app consistently below
-- and set CBL_SUPABASE_SCHEMA to the same value.

create extension if not exists vector;

create schema if not exists cblaero_app;

create table if not exists cblaero_app.auth_session_revocations (
  session_id text primary key,
  expires_at timestamptz not null,
  revoked_at timestamptz not null default now()
);

create index if not exists idx_auth_session_revocations_expires_at
  on cblaero_app.auth_session_revocations (expires_at);

create table if not exists cblaero_app.audit_authorization_denials (
  id bigint generated always as identity primary key,
  trace_id text not null,
  actor_id text,
  role text,
  session_tenant_id text,
  requested_tenant_id text,
  path text not null,
  method text not null,
  reason text not null check (reason in ('unauthenticated', 'forbidden_role', 'tenant_mismatch')),
  occurred_at timestamptz not null default now()
);

create index if not exists idx_audit_authorization_denials_occurred_at
  on cblaero_app.audit_authorization_denials (occurred_at desc);

create index if not exists idx_audit_authorization_denials_tenant
  on cblaero_app.audit_authorization_denials (session_tenant_id, occurred_at desc);

create table if not exists cblaero_app.audit_admin_actions (
  id bigint generated always as identity primary key,
  trace_id text not null,
  actor_id text not null,
  tenant_id text not null,
  target_actor_id text,
  action_type text not null check (action_type in ('invite_user', 'assign_role', 'update_team_membership')),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_audit_admin_actions_occurred_at
  on cblaero_app.audit_admin_actions (occurred_at desc);

create index if not exists idx_audit_admin_actions_tenant
  on cblaero_app.audit_admin_actions (tenant_id, occurred_at desc);

create table if not exists cblaero_app.audit_step_up_attempts (
  id bigint generated always as identity primary key,
  trace_id text not null,
  actor_id text not null,
  tenant_id text not null,
  role text not null,
  path text not null,
  method text not null,
  action text not null,
  outcome text not null check (outcome in ('challenged', 'verified')),
  reason text check (reason in ('fresh_auth_required') or reason is null),
  occurred_at timestamptz not null default now()
);

create index if not exists idx_audit_step_up_attempts_occurred_at
  on cblaero_app.audit_step_up_attempts (occurred_at desc);

create index if not exists idx_audit_step_up_attempts_tenant
  on cblaero_app.audit_step_up_attempts (tenant_id, occurred_at desc);

create table if not exists cblaero_app.audit_client_context_confirmations (
  id bigint generated always as identity primary key,
  trace_id text not null,
  actor_id text not null,
  role text not null,
  tenant_id text not null,
  active_client_id text not null,
  target_client_id text not null,
  action text not null,
  path text not null,
  method text not null,
  outcome text not null check (outcome in ('required', 'confirmed')),
  occurred_at timestamptz not null default now()
);

create index if not exists idx_audit_client_context_confirmations_occurred_at
  on cblaero_app.audit_client_context_confirmations (occurred_at desc);

create index if not exists idx_audit_client_context_confirmations_tenant
  on cblaero_app.audit_client_context_confirmations (tenant_id, occurred_at desc);

create table if not exists cblaero_app.cross_client_confirmation_token_uses (
  jti text primary key,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now()
);

create index if not exists idx_cross_client_confirmation_token_uses_expires_at
  on cblaero_app.cross_client_confirmation_token_uses (expires_at);

create table if not exists cblaero_app.audit_data_residency_checks (
  id bigint generated always as identity primary key,
  trace_id text not null,
  actor_id text,
  tenant_id text,
  status text not null check (status in ('pass', 'fail')),
  approved_regions text[] not null,
  checked_targets jsonb not null,
  violations text[] not null default '{}',
  occurred_at timestamptz not null default now()
);

create index if not exists idx_audit_data_residency_checks_occurred_at
  on cblaero_app.audit_data_residency_checks (occurred_at desc);

create index if not exists idx_audit_data_residency_checks_tenant
  on cblaero_app.audit_data_residency_checks (tenant_id, occurred_at desc);

create table if not exists cblaero_app.admin_managed_users (
  actor_id text primary key,
  tenant_id text not null,
  email text not null,
  role text not null check (role in ('admin', 'recruiter', 'delivery-head', 'compliance-officer')),
  team_ids text[] not null default '{}',
  invited_at timestamptz not null,
  last_seen_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists uq_admin_managed_users_tenant_email
  on cblaero_app.admin_managed_users (tenant_id, email);

create index if not exists idx_admin_managed_users_tenant
  on cblaero_app.admin_managed_users (tenant_id, email);

create table if not exists cblaero_app.admin_invitations (
  invitation_id text primary key,
  tenant_id text not null,
  email text not null,
  role text not null check (role in ('admin', 'recruiter', 'delivery-head', 'compliance-officer')),
  team_ids text[] not null default '{}',
  invited_by_actor_id text not null,
  status text not null check (status in ('pending')),
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists idx_admin_invitations_tenant_created
  on cblaero_app.admin_invitations (tenant_id, created_at desc);

create unique index if not exists uq_admin_invitations_pending
  on cblaero_app.admin_invitations (tenant_id, email)
  where status = 'pending';

-- Keep this in sync with CBL_VECTOR_DIMENSIONS (default is 8).
create table if not exists cblaero_app.audit_event_vectors (
  id bigint generated always as identity primary key,
  source_table text not null,
  source_event_id bigint not null,
  tenant_id text,
  payload_text text not null,
  embedding vector(8) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_event_vectors_source
  on cblaero_app.audit_event_vectors (source_table, source_event_id);

create index if not exists idx_audit_event_vectors_tenant
  on cblaero_app.audit_event_vectors (tenant_id, created_at desc);

create table if not exists cblaero_app.audit_import_batch_accesses (
  id bigint generated always as identity primary key,
  trace_id text not null,
  actor_id text not null,
  tenant_id text not null,
  batch_id uuid,
  action text not null check (action in ('list_import_batches', 'read_import_batch_detail', 'csv_upload_access', 'download_csv_error_report', 'resume_upload_access', 'resume_confirm_access')),
  occurred_at timestamptz not null default now()
);

create index if not exists idx_audit_import_batch_accesses_occurred_at
  on cblaero_app.audit_import_batch_accesses (occurred_at desc);

create index if not exists idx_audit_import_batch_accesses_tenant
  on cblaero_app.audit_import_batch_accesses (tenant_id, occurred_at desc);

-- ============================================================
-- Epic 2: Candidate Data Ingestion
-- ============================================================

create table if not exists cblaero_app.import_batch (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  source text not null check (source in ('migration', 'csv_upload', 'ats_sync', 'inbox_parse', 'resume_upload')),
  status text not null check (status in ('validating', 'running', 'processing', 'paused_on_error_threshold', 'complete', 'rolled_back')),
  total_rows int not null default 0,
  imported int not null default 0,
  skipped int not null default 0,
  errors int not null default 0,
  error_threshold_pct int not null default 5,
  created_by_actor_id text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_import_batch_tenant_started
  on cblaero_app.import_batch (tenant_id, started_at desc);

create index if not exists idx_import_batch_status
  on cblaero_app.import_batch (status, started_at desc);

create table if not exists cblaero_app.import_row_error (
  id bigint generated always as identity primary key,
  batch_id uuid not null references cblaero_app.import_batch (id),
  row_number int not null,
  raw_data jsonb not null default '{}'::jsonb,
  error_code text not null,
  error_detail text,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_import_row_error_batch
  on cblaero_app.import_row_error (batch_id, row_number);

create table if not exists cblaero_app.candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  email text,
  phone text,
  location text,
  skills jsonb not null default '[]'::jsonb,
  certifications jsonb not null default '[]'::jsonb,
  experience jsonb not null default '[]'::jsonb,
  extra_attributes jsonb not null default '{}'::jsonb,
  availability_status text not null default 'passive' check (availability_status in ('active', 'passive', 'unavailable')),
  availability_last_signal_at timestamptz,
  ingestion_state text not null default 'pending_dedup' check (ingestion_state in ('pending_dedup', 'pending_enrichment', 'active', 'rejected', 'pending_review', 'merged')),
  source text not null,
  source_batch_id uuid references cblaero_app.import_batch (id),
  created_by_actor_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidates_email_or_phone_required check (ingestion_state = 'merged' or email is not null or phone is not null)
);

alter table cblaero_app.candidates
  add column if not exists extra_attributes jsonb not null default '{}'::jsonb;

alter table cblaero_app.candidates
  add column if not exists first_name text not null default '',
  add column if not exists last_name text not null default '',
  add column if not exists middle_name text,
  add column if not exists home_phone text,
  add column if not exists work_phone text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists country text,
  add column if not exists postal_code text,
  add column if not exists current_company text,
  add column if not exists job_title text,
  add column if not exists alternate_email text;

alter table cblaero_app.candidates
  add column if not exists created_by_actor_id text;

create unique index if not exists uq_candidates_tenant_email
  on cblaero_app.candidates (tenant_id, email)
  where email is not null;

create unique index if not exists uq_candidates_tenant_phone
  on cblaero_app.candidates (tenant_id, phone)
  where phone is not null;

create index if not exists idx_candidates_source_batch
  on cblaero_app.candidates (source_batch_id)
  where source_batch_id is not null;

-- Full-text search on name fields (tsvector generated column)
alter table cblaero_app.candidates
  add column if not exists name_tsv tsvector
  generated always as (
    to_tsvector('english',
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '')
    )
  ) stored;

create index if not exists idx_candidates_name_fts
  on cblaero_app.candidates using gin (name_tsv)
  where ingestion_state = 'active';

-- GIN index for skills JSONB contains queries
create index if not exists idx_candidates_skills_gin
  on cblaero_app.candidates using gin (skills)
  where ingestion_state = 'active';

-- Composite index for tenant + ingestion_state filtering (used on every query)
create index if not exists idx_candidates_tenant_state
  on cblaero_app.candidates (tenant_id, ingestion_state);

-- Trigram indexes for fast ILIKE '%...%' substring searches (pg_trgm)
create extension if not exists pg_trgm;

create index if not exists idx_candidates_email_trgm
  on cblaero_app.candidates using gin (email gin_trgm_ops)
  where ingestion_state = 'active';

create index if not exists idx_candidates_job_title_trgm
  on cblaero_app.candidates using gin (job_title gin_trgm_ops)
  where ingestion_state = 'active';

create index if not exists idx_candidates_city_trgm
  on cblaero_app.candidates using gin (city gin_trgm_ops)
  where ingestion_state = 'active';

-- Source filter index
create index if not exists idx_candidates_tenant_source
  on cblaero_app.candidates (tenant_id, source)
  where ingestion_state = 'active';

-- Sync timestamp lookup (get_last_candidate_update_by_source)
create index if not exists idx_candidates_source_updated_at
  on cblaero_app.candidates (source, updated_at desc);

-- Sort performance indexes
create index if not exists idx_candidates_tenant_created_desc
  on cblaero_app.candidates (tenant_id, created_at desc)
  where ingestion_state = 'active';

create index if not exists idx_candidates_tenant_yoe_desc
  on cblaero_app.candidates (tenant_id, years_of_experience desc nulls last)
  where ingestion_state = 'active';

-- RPC: Candidate search with all filters, sorting, and pagination in SQL
-- Avoids PostgREST filter limitations; supports skills::text ILIKE, numeric casts, tsvector search
create or replace function cblaero_app.search_candidates(
  p_tenant_id text,
  p_search text default null,
  p_email text default null,
  p_job_title text default null,
  p_skills text default null,
  p_city text default null,
  p_state text default null,
  p_availability_status text default null,
  p_work_authorization text default null,
  p_source text default null,
  p_employment_type text default null,
  p_years_of_experience numeric default null,
  p_veteran_status text default null,
  p_has_ap_license boolean default null,
  p_cert_type text default null,
  p_current_company text default null,
  p_phone text default null,
  p_shift_preference text default null,
  p_created_after timestamptz default null,
  p_created_before timestamptz default null,
  p_deduced_role text default null,
  p_sort_by text default 'created_at',
  p_sort_dir text default 'desc',
  p_cursor_id uuid default null,
  p_cursor_created_at timestamptz default null,
  p_limit int default 25
)
returns table (
  id uuid, tenant_id text, first_name text, last_name text,
  email text, phone text, location text, city text, state text,
  availability_status text, ingestion_state text, job_title text,
  skills jsonb, years_of_experience text, source text,
  source_batch_id uuid, created_at timestamptz, updated_at timestamptz,
  deduced_roles jsonb, availability_last_signal_at timestamptz,
  linkedin_url text
)
language plpgsql stable
as $$
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
$$;

grant execute on function cblaero_app.search_candidates to anon, authenticated, service_role;

create or replace function cblaero_app.process_import_chunk(
  p_batch_id uuid,
  p_candidates jsonb,
  p_error_rows jsonb default '[]'::jsonb,
  p_total_imported int default 0,
  p_total_skipped int default 0,
  p_total_errors int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = cblaero_app
as $$
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
      batch_id,
      row_number,
      raw_data,
      error_code,
      error_detail
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
        batch_id,
        row_number,
        raw_data,
        error_code,
        error_detail
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
          v_candidate->>'tenant_id',
          v_email,
          v_phone,
          v_first_name,
          v_last_name,
          v_middle_name,
          v_home_phone,
          v_work_phone,
          nullif(v_candidate->>'location', ''),
          v_address,
          v_city,
          v_state,
          v_country,
          v_postal_code,
          v_current_company,
          v_job_title,
          v_alternate_email,
          coalesce(v_candidate->'skills', '[]'::jsonb),
          coalesce(v_candidate->'certifications', '[]'::jsonb),
          coalesce(v_candidate->'experience', '[]'::jsonb),
          coalesce(v_candidate->'extra_attributes', '{}'::jsonb),
          coalesce(v_candidate->>'availability_status', 'passive'),
          coalesce(v_candidate->>'ingestion_state', 'pending_dedup'),
          coalesce(v_candidate->>'source', 'migration'),
          coalesce((v_candidate->>'source_batch_id')::uuid, p_batch_id),
          nullif(trim(coalesce(v_candidate->>'created_by_actor_id', '')), ''),
          v_resume_url,
          v_linkedin_url,
          v_deduced_roles,
          coalesce((v_candidate->>'updated_at')::timestamptz, now())
        )
        on conflict (tenant_id, email) where email is not null
        do update set
          phone = excluded.phone,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          middle_name = excluded.middle_name,
          home_phone = excluded.home_phone,
          work_phone = excluded.work_phone,
          location = excluded.location,
          address = excluded.address,
          city = excluded.city,
          state = excluded.state,
          country = excluded.country,
          postal_code = excluded.postal_code,
          current_company = excluded.current_company,
          job_title = excluded.job_title,
          alternate_email = excluded.alternate_email,
          skills = excluded.skills,
          certifications = excluded.certifications,
          experience = excluded.experience,
          extra_attributes = excluded.extra_attributes,
          availability_status = excluded.availability_status,
          ingestion_state = case
            when candidates.ingestion_state in ('active', 'pending_review') then candidates.ingestion_state
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
          v_resume_url,
          v_linkedin_url,
          v_deduced_roles,
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
          ingestion_state = case
            when candidates.ingestion_state in ('active', 'pending_review') then candidates.ingestion_state
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
          batch_id,
          row_number,
          raw_data,
          error_code,
          error_detail
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
$$;

-- ============================================================
-- Permissions
-- Grant schema usage + table/function access to Supabase roles.
-- Re-run after adding new tables — grants are not retroactive.
-- schema usage is required for PostgREST to route into cblaero_app.
-- ============================================================

grant usage on schema cblaero_app to anon, authenticated, service_role;

-- Audit tables: append-only (§27) — INSERT + SELECT only, no UPDATE/DELETE
grant select, insert on cblaero_app.audit_authorization_denials
  to authenticated, service_role;

grant select, insert on cblaero_app.audit_admin_actions
  to authenticated, service_role;

grant select, insert on cblaero_app.audit_step_up_attempts
  to authenticated, service_role;

grant select, insert on cblaero_app.audit_client_context_confirmations
  to authenticated, service_role;

grant select, insert on cblaero_app.audit_data_residency_checks
  to authenticated, service_role;

grant select, insert on cblaero_app.audit_import_batch_accesses
  to authenticated, service_role;

grant select, insert, update on cblaero_app.import_batch
  to authenticated, service_role;

grant select, insert on cblaero_app.import_row_error
  to authenticated, service_role;

grant select, insert, update, delete on cblaero_app.candidates
  to authenticated, service_role;

grant execute on function cblaero_app.process_import_chunk(uuid, jsonb, jsonb, int, int, int)
  to service_role;

-- RPC: Get single candidate detail with explicit columns (replaces select(*))
create or replace function cblaero_app.get_candidate_detail(p_candidate_id uuid, p_tenant_id text)
returns table (
  id uuid, tenant_id text, first_name text, last_name text, middle_name text,
  email text, phone text, home_phone text, work_phone text,
  location text, address text, city text, state text, country text, postal_code text,
  availability_status text, ingestion_state text,
  current_company text, job_title text, alternate_email text,
  skills jsonb, certifications jsonb, experience jsonb, extra_attributes jsonb,
  work_authorization text, clearance text, aircraft_experience jsonb,
  employment_type text, current_rate text, per_diem text, has_ap_license boolean,
  years_of_experience text, ceipal_id text, submitted_by text, submitter_email text,
  shift_preference text, expected_start_date text, call_availability text,
  interview_availability text, veteran_status text, resume_url text,
  source text, source_batch_id uuid, created_at timestamptz, updated_at timestamptz,
  deduced_roles jsonb, availability_last_signal_at timestamptz
)
language sql stable
as $$
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
$$;

grant execute on function cblaero_app.get_candidate_detail to anon, authenticated, service_role;

-- RPC: Atomic rollback of import batch (delete candidates + mark batch rolled_back)
create or replace function cblaero_app.rollback_import_batch(p_batch_id uuid)
returns table (deleted_candidates bigint)
language plpgsql
as $$
declare v_count bigint;
begin
  delete from cblaero_app.candidates where source_batch_id = p_batch_id;
  get diagnostics v_count = row_count;
  update cblaero_app.import_batch set status = 'rolled_back', completed_at = now() where id = p_batch_id;
  deleted_candidates := v_count;
  return next;
end;
$$;

grant execute on function cblaero_app.rollback_import_batch to service_role;

-- RPC: Bulk load fingerprint hashes for in-memory dedup cache
create or replace function cblaero_app.load_recent_fingerprints(
  p_tenant_id text, p_type text, p_days int default 30, p_max_count int default 100000
)
returns table (fingerprint_hash text)
language sql stable
as $$
  select cf.fingerprint_hash from cblaero_app.content_fingerprints cf
  where cf.tenant_id = p_tenant_id and cf.fingerprint_type = p_type
    and cf.status = 'processed' and cf.created_at >= now() - (p_days || ' days')::interval
  limit p_max_count;
$$;

grant execute on function cblaero_app.load_recent_fingerprints to service_role;

-- RPC: Cleanup old audit logs across all tables atomically
create or replace function cblaero_app.cleanup_audit_logs(p_retention_days int default 90)
returns table (table_name text, deleted_count bigint)
language plpgsql
as $$
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
$$;

grant execute on function cblaero_app.cleanup_audit_logs to service_role;

-- RPC: Upsert single candidate with email dedup (insert or update)
-- Uses explicit column lists to avoid writing to generated columns (name_tsv)
create or replace function cblaero_app.upsert_candidate(p_candidate jsonb)
returns uuid language plpgsql as $$
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
end; $$;

grant execute on function cblaero_app.upsert_candidate to service_role;

-- RPC: Batch upsert candidates with per-row email dedup
-- Uses explicit column lists to avoid writing to generated columns (name_tsv)
create or replace function cblaero_app.upsert_candidate_batch(p_candidates jsonb)
returns table (inserted int, updated int) language plpgsql as $$
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
        created_by_actor_id, resume_url, linkedin_url,
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
          when cblaero_app.candidates.ingestion_state in ('active', 'pending_review') then cblaero_app.candidates.ingestion_state
          else excluded.ingestion_state
        end,
        source = excluded.source, source_batch_id = excluded.source_batch_id,
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
        created_by_actor_id, resume_url, linkedin_url,
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
end; $$;

grant execute on function cblaero_app.upsert_candidate_batch to service_role;

-- RPC: Atomic check-if-fingerprint-exists + record in one call (prevents race conditions)
create or replace function cblaero_app.check_and_record_fingerprint(
  p_tenant_id text, p_type text, p_hash text, p_source text,
  p_candidate_id uuid default null, p_metadata jsonb default '{}'::jsonb,
  p_status text default 'processed'
)
returns table (already_exists boolean) language plpgsql as $$
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
end; $$;

grant execute on function cblaero_app.check_and_record_fingerprint to service_role;

-- Story 2.4: find_candidate_ids_by_emails — lookup candidate IDs by email list
create or replace function cblaero_app.find_candidate_ids_by_emails(
  p_tenant_id text, p_emails text[]
)
returns table (id uuid, email text) language sql stable as $$
  select c.id, c.email
  from cblaero_app.candidates c
  where c.tenant_id = p_tenant_id
    and c.email = any(p_emails);
$$;

grant execute on function cblaero_app.find_candidate_ids_by_emails to service_role;

-- Story 2.4: count_candidates_by_source — count candidates for a given source
create or replace function cblaero_app.count_candidates_by_source(p_source text)
returns bigint language sql stable as $$
  select count(*) from cblaero_app.candidates where source = p_source;
$$;

grant execute on function cblaero_app.count_candidates_by_source to service_role;

-- Story 2.4: get_last_candidate_update_by_source — latest updated_at for a source
-- Uses ORDER BY + LIMIT 1 instead of MAX() to leverage idx_candidates_source_updated_at
create or replace function cblaero_app.get_last_candidate_update_by_source(p_source text)
returns timestamptz language sql stable as $$
  select updated_at from cblaero_app.candidates
  where source = p_source
  order by updated_at desc
  limit 1;
$$;

grant execute on function cblaero_app.get_last_candidate_update_by_source to service_role;

-- Story 2.4: upsert_fingerprint_batch — batch upsert fingerprints with dedup
create or replace function cblaero_app.upsert_fingerprint_batch(p_fingerprints jsonb)
returns void language plpgsql as $$
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
end; $$;

grant execute on function cblaero_app.upsert_fingerprint_batch to service_role;

-- Story 2.3: Extended candidate fields for ATS/email ingestion
alter table cblaero_app.candidates
  add column if not exists work_authorization text,
  add column if not exists clearance text,
  add column if not exists aircraft_experience jsonb not null default '[]'::jsonb,
  add column if not exists employment_type text,
  add column if not exists current_rate text,
  add column if not exists per_diem text,
  add column if not exists has_ap_license boolean,
  add column if not exists years_of_experience text,
  add column if not exists ceipal_id text,
  add column if not exists submitted_by text,
  add column if not exists submitter_email text,
  add column if not exists shift_preference text,
  add column if not exists expected_start_date text,
  add column if not exists call_availability text,
  add column if not exists interview_availability text,
  add column if not exists veteran_status text;

alter table cblaero_app.candidates
  add column if not exists resume_url text,
  add column if not exists linkedin_url text;

create index if not exists idx_candidates_ceipal_id
  on cblaero_app.candidates (ceipal_id) where ceipal_id is not null;

-- Story 2.3: Submission evidence table
create table if not exists cblaero_app.candidate_submissions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references cblaero_app.candidates(id) on delete set null,
  tenant_id text not null,
  source text not null check (source in ('email', 'ats', 'csv', 'ceipal', 'resume_upload')),
  email_message_id text,
  email_subject text,
  email_body text,
  email_from text,
  email_received_at timestamptz,
  extracted_data jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  extraction_model text,
  extraction_confidence text,
  created_at timestamptz not null default now()
);

create index if not exists idx_submissions_candidate
  on cblaero_app.candidate_submissions (candidate_id);
create index if not exists idx_submissions_source
  on cblaero_app.candidate_submissions (source);
create index if not exists idx_submissions_received
  on cblaero_app.candidate_submissions (email_received_at desc);

-- Story 2.3: Persistent sync error tracking
create table if not exists cblaero_app.sync_errors (
  id bigint generated always as identity primary key,
  source text not null,
  record_id text not null,
  message text not null,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_sync_errors_occurred
  on cblaero_app.sync_errors (occurred_at desc);
create index if not exists idx_sync_errors_source
  on cblaero_app.sync_errors (source);

-- Story 2.3: Grants for new tables
grant select, insert, update, delete on cblaero_app.candidate_submissions
  to anon, authenticated, service_role;

grant select, insert on cblaero_app.sync_errors
  to anon, authenticated, service_role;

grant usage on all sequences in schema cblaero_app
  to anon, authenticated, service_role;

-- Story 2.4 rework: Saved searches table
create table if not exists cblaero_app.saved_searches (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  actor_id text not null,
  actor_email text not null,
  name text not null,
  filters jsonb not null,
  digest_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_saved_searches_actor
  on cblaero_app.saved_searches (actor_id, tenant_id);
create index if not exists idx_saved_searches_digest
  on cblaero_app.saved_searches (digest_enabled)
  where digest_enabled = true;

grant select, insert, update, delete on cblaero_app.saved_searches
  to anon, authenticated, service_role;

-- RLS: users can only access their own saved searches within their tenant
alter table cblaero_app.saved_searches enable row level security;

create policy saved_searches_select on cblaero_app.saved_searches
  for select using (true);
create policy saved_searches_insert on cblaero_app.saved_searches
  for insert with check (true);
create policy saved_searches_update on cblaero_app.saved_searches
  for update using (true);
create policy saved_searches_delete on cblaero_app.saved_searches
  for delete using (true);

-- Note: Application-level enforcement via actor_id/tenant_id predicates in repository.
-- RLS policies are permissive because the admin client (service_role) bypasses RLS anyway.
-- If direct PostgREST access is enabled for authenticated users, tighten policies to:
--   using (actor_id = auth.uid()::text AND tenant_id = current_setting('app.tenant_id'))

-- Story 1.11: Content fingerprint gate for dedup before expensive processing
create table if not exists cblaero_app.content_fingerprints (
  id bigint generated always as identity primary key,
  tenant_id text not null,
  fingerprint_type text not null check (fingerprint_type in (
    'file_sha256', 'email_message_id', 'csv_row_hash', 'ats_external_id', 'candidate_identity'
  )),
  fingerprint_hash text not null,
  source text not null check (source in ('email', 'ats', 'csv', 'ceipal', 'resume_upload', 'onedrive', 'dedup')),
  status text not null default 'processed' check (status in ('processed', 'failed')),
  candidate_id uuid references cblaero_app.candidates(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_fingerprint_tenant_type_hash
  on cblaero_app.content_fingerprints (tenant_id, fingerprint_type, fingerprint_hash);

create index if not exists idx_fingerprints_tenant_type_created
  on cblaero_app.content_fingerprints (tenant_id, fingerprint_type, created_at desc);

grant select, insert, update, delete on cblaero_app.content_fingerprints
  to anon, authenticated, service_role;

-- Prompt Registry — append-only, versioned prompts for AI inference service (Story 1.9)
-- status column added in Story 1.9a for lifecycle management (active/staged/deprecated)
create table if not exists cblaero_app.prompt_registry (
  id bigint generated always as identity primary key,
  name text not null,
  version text not null,
  prompt_text text not null,
  model text not null,
  status text not null default 'active' check (status in ('active', 'staged', 'deprecated')),
  created_at timestamptz not null default now(),
  created_by text,
  notes text,
  unique (name, version)
);

-- Story 1.9a: add status column if table already exists (idempotent migration)
alter table cblaero_app.prompt_registry
  add column if not exists status text not null default 'active';

-- Story 1.9a: add CHECK constraint on status (idempotent — drops if exists first)
do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'prompt_registry_status_check'
  ) then
    alter table cblaero_app.prompt_registry
      add constraint prompt_registry_status_check
      check (status in ('active', 'staged', 'deprecated'));
  end if;
end $$;

create index if not exists idx_prompt_registry_name_created
  on cblaero_app.prompt_registry (name, created_at desc);

create index if not exists idx_prompt_registry_name_status
  on cblaero_app.prompt_registry (name, status);

grant select on cblaero_app.prompt_registry
  to anon, authenticated;

grant select, insert, update on cblaero_app.prompt_registry
  to service_role;

-- LLM Usage Log — per-call token counts and cost tracking (Story 1.9)
create table if not exists cblaero_app.llm_usage_log (
  id bigint generated always as identity primary key,
  model text not null,
  prompt_name text,
  prompt_version text,
  module text not null,
  action text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  duration_ms integer not null,
  estimated_cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_llm_usage_log_created
  on cblaero_app.llm_usage_log (created_at desc);

create index if not exists idx_llm_usage_log_model_created
  on cblaero_app.llm_usage_log (model, created_at desc);

grant select on cblaero_app.llm_usage_log
  to authenticated;

grant select, insert on cblaero_app.llm_usage_log
  to service_role;

-- Story 2.5: Dedup decisions audit table (append-only — no UPDATE/DELETE grants)
create table if not exists cblaero_app.dedup_decisions (
  id bigint generated always as identity primary key,
  tenant_id text not null,
  candidate_a_id uuid not null references cblaero_app.candidates(id),
  candidate_b_id uuid not null references cblaero_app.candidates(id),
  decision_type text not null check (decision_type in ('auto_merge', 'manual_merge', 'manual_reject', 'keep_separate')),
  confidence_score numeric(5,2) not null,
  rationale text not null,
  actor text not null default 'system',
  trace_id text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_dedup_decisions_tenant
  on cblaero_app.dedup_decisions (tenant_id, created_at desc);

create index if not exists idx_dedup_decisions_candidates
  on cblaero_app.dedup_decisions (candidate_a_id, candidate_b_id);

grant insert, select on cblaero_app.dedup_decisions
  to authenticated, service_role;

-- Story 2.5: Manual review queue for borderline dedup cases (70-94% confidence)
create table if not exists cblaero_app.dedup_review_queue (
  id bigint generated always as identity primary key,
  tenant_id text not null,
  candidate_a_id uuid not null references cblaero_app.candidates(id),
  candidate_b_id uuid not null references cblaero_app.candidates(id),
  confidence_score numeric(5,2) not null,
  field_diffs jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_dedup_review_tenant_status
  on cblaero_app.dedup_review_queue (tenant_id, status) where status = 'pending';

grant select, insert, update on cblaero_app.dedup_review_queue
  to authenticated, service_role;

-- Story 2.5: Atomic merge RPC — merges two candidate records into one
-- Handles: winner field update, loser nulling (unique constraints), reference migration,
-- loser state change, and audit decision insert — all in a single transaction.
create or replace function cblaero_app.merge_candidates(
  p_winner_id uuid,
  p_loser_id uuid,
  p_merged_fields jsonb,
  p_decision jsonb
)
returns void language plpgsql as $$
declare
  v_winner_tenant text;
  v_loser_tenant text;
begin
  -- Verify both candidates exist and belong to same tenant
  select tenant_id into v_winner_tenant from cblaero_app.candidates where id = p_winner_id;
  select tenant_id into v_loser_tenant from cblaero_app.candidates where id = p_loser_id;
  if v_winner_tenant is null or v_loser_tenant is null then
    raise exception 'Candidate not found: winner=% loser=%', p_winner_id, p_loser_id;
  end if;
  if v_winner_tenant != v_loser_tenant then
    raise exception 'Cannot merge candidates from different tenants';
  end if;

  -- Step 1: NULL out loser's email and phone to release unique constraints
  -- Preserve originals in extra_attributes before nulling
  update cblaero_app.candidates set
    extra_attributes = extra_attributes
      || jsonb_build_object('original_email', email)
      || jsonb_build_object('original_phone', phone)
      || jsonb_build_object('merged_into', p_winner_id::text),
    email = null,
    phone = null,
    ingestion_state = 'merged',
    updated_at = now()
  where id = p_loser_id;

  -- Step 2: Update winner with merged field values (no `name` column — was dropped)
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
    ingestion_state = 'active',
    updated_at = now()
  where id = p_winner_id;

  -- Step 3: Migrate references from loser to winner
  update cblaero_app.content_fingerprints set candidate_id = p_winner_id
    where candidate_id = p_loser_id;
  update cblaero_app.candidate_submissions set candidate_id = p_winner_id
    where candidate_id = p_loser_id;

  -- Step 4: Insert audit decision
  insert into cblaero_app.dedup_decisions (
    tenant_id, candidate_a_id, candidate_b_id, decision_type,
    confidence_score, rationale, actor, trace_id, metadata
  ) values (
    v_winner_tenant,
    p_winner_id,
    p_loser_id,
    p_decision->>'decision_type',
    (p_decision->>'confidence_score')::numeric,
    p_decision->>'rationale',
    coalesce(p_decision->>'actor', 'system'),
    p_decision->>'trace_id',
    coalesce(p_decision->'metadata', '{}'::jsonb)
  );
end; $$;

grant execute on function cblaero_app.merge_candidates to authenticated, service_role;

-- Immutable phone normalization wrapper (needed for functional index)
create or replace function cblaero_app.normalize_phone(phone text)
returns text language sql immutable parallel safe as $$
  select regexp_replace(phone, '\D', '', 'g');
$$;

-- Functional index on normalized phone for fast dedup matching
create index if not exists idx_candidates_phone_normalized
  on cblaero_app.candidates (cblaero_app.normalize_phone(phone))
  where phone is not null and ingestion_state in ('active', 'pending_review');

-- Index on lowered name for fast dedup name matching
create index if not exists idx_candidates_name_lower
  on cblaero_app.candidates (lower(trim(first_name)), lower(trim(last_name)))
  where ingestion_state in ('active', 'pending_review');

-- Story 2.5: RPC for phone/name field matching with server-side normalization (H1 fix)
create or replace function cblaero_app.find_dedup_field_matches(
  p_tenant_id text,
  p_normalized_phone text,
  p_first_name text,
  p_last_name text,
  p_exclude_id uuid default null
)
returns table (
  id uuid, tenant_id text, email text, phone text, first_name text, last_name text,
  job_title text, location text, city text, state text,
  skills jsonb, certifications jsonb, aircraft_experience jsonb,
  extra_attributes jsonb, years_of_experience text,
  resume_url text, linkedin_url text, source text, ingestion_state text,
  created_at timestamptz, updated_at timestamptz
) language plpgsql as $$
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
end; $$;

grant execute on function cblaero_app.find_dedup_field_matches to service_role;

-- Story 2.5: RPC for dedup stats with GROUP BY (H4 fix)
create or replace function cblaero_app.get_dedup_stats(p_tenant_id text)
returns table (decision_type text, cnt bigint) language plpgsql as $$
begin
  return query
  select d.decision_type, count(*) as cnt
  from cblaero_app.dedup_decisions d
  where d.tenant_id = p_tenant_id
  group by d.decision_type;
end; $$;

grant execute on function cblaero_app.get_dedup_stats to service_role;

-- Story 2.4b: Sync run summary tracking
create table if not exists cblaero_app.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  succeeded int not null default 0,
  failed int not null default 0,
  total int not null default 0,
  error_message text
);

create index if not exists idx_sync_runs_started_at
  on cblaero_app.sync_runs (started_at desc);

-- Story 2.4b: Add run_id FK to sync_errors (nullable — errors can exist without a run)
-- ON DELETE SET NULL: when a sync_run is pruned, orphaned errors keep their data with null run_id
alter table cblaero_app.sync_errors
  add column if not exists run_id uuid references cblaero_app.sync_runs(id) on delete set null;

create index if not exists idx_sync_errors_run_id
  on cblaero_app.sync_errors (run_id);

-- Story 2.4b: Grants for sync_runs (revoke defaults first, then grant minimal)
revoke insert, update, delete on cblaero_app.sync_runs from anon, authenticated;
grant select, insert, update on cblaero_app.sync_runs
  to service_role;
grant select on cblaero_app.sync_runs
  to authenticated;

-- Story 2.4b: Tighten sync_errors grants — revoke write access from anon/authenticated
-- (Story 2.3 over-granted INSERT to all roles; only service_role should write)
revoke insert, update, delete on cblaero_app.sync_errors from anon, authenticated;
grant select on cblaero_app.sync_errors to authenticated;
grant insert, update, delete on cblaero_app.sync_errors to service_role;

-- ============================================================
-- Story 2.5a: Role Taxonomy & Deduced Role Classification
-- ============================================================

-- Task 1: Role taxonomy reference table
create table if not exists cblaero_app.role_taxonomy (
  id serial primary key,
  tenant_id text not null,
  role_name text not null,
  category text not null check (category in ('aviation', 'it', 'other')),
  aliases jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_role_taxonomy_tenant_name
  on cblaero_app.role_taxonomy (tenant_id, lower(role_name));
create index if not exists idx_role_taxonomy_aliases
  on cblaero_app.role_taxonomy using gin (aliases);
create index if not exists idx_role_taxonomy_category
  on cblaero_app.role_taxonomy (tenant_id, category) where is_active = true;

-- RLS
alter table cblaero_app.role_taxonomy enable row level security;
create policy if not exists tenant_isolation_role_taxonomy on cblaero_app.role_taxonomy
  using (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'tenant_id');

-- Grants
grant select on cblaero_app.role_taxonomy to authenticated;
grant all on cblaero_app.role_taxonomy to service_role;
grant usage, select on sequence cblaero_app.role_taxonomy_id_seq to service_role;

-- Task 2: Deduced roles columns on candidates
alter table cblaero_app.candidates
  add column if not exists deduced_roles jsonb not null default '[]'::jsonb;
alter table cblaero_app.candidates
  add column if not exists role_deduction_metadata jsonb not null default '{}'::jsonb;

-- GIN index for role containment queries (e.g., deduced_roles @> '["A&P Mechanic"]')
create index if not exists idx_candidates_deduced_roles_gin
  on cblaero_app.candidates using gin (deduced_roles);

-- CHECK constraint: max 3 deduced roles
-- H9 fix: schema-scoped constraint check to avoid false matches from other schemas
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.conname = 'chk_deduced_roles_max3'
      and t.relname = 'candidates'
      and n.nspname = 'cblaero_app'
  ) then
    alter table cblaero_app.candidates
      add constraint chk_deduced_roles_max3
      check (jsonb_array_length(deduced_roles) <= 3);
  end if;
end $$;

-- Task 1.4: Seed canonical aviation roles (idempotent via ON CONFLICT)
-- Uses a function so tenant_id can be provided at runtime
create or replace function cblaero_app.seed_aviation_roles(p_tenant_id text)
returns int
language plpgsql
as $$
declare v_count int := 0;
begin
  insert into cblaero_app.role_taxonomy (tenant_id, role_name, category, aliases)
  values
    (p_tenant_id, 'A&P Aircraft Inspector', 'aviation', '["AP Aircraft Inspector", "A and P Aircraft Inspector"]'::jsonb),
    (p_tenant_id, 'A&P Mechanic', 'aviation', '["A&P Aircraft Maintenance Tech", "AP Mechanic", "Airframe and Powerplant Mechanic", "A&P AIRCRAFT MAINTENANCE TECH III", "A&P Tech"]'::jsonb),
    (p_tenant_id, 'Aircraft Maintenance Supervisor', 'aviation', '["Maintenance Supervisor", "Aircraft Maint Supervisor"]'::jsonb),
    (p_tenant_id, 'Aircraft Paint Technician', 'aviation', '["Aircraft Paint Tech"]'::jsonb),
    (p_tenant_id, 'Aircraft Painter', 'aviation', '["Painter Aircraft"]'::jsonb),
    (p_tenant_id, 'Aircraft Structures Technician/Sheet Metal', 'aviation', '["Aircraft Structures Tech"]'::jsonb),
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
    (p_tenant_id, 'Sheet Metal Technician', 'aviation', '["Sheet Metal Tech"]'::jsonb),
    (p_tenant_id, 'SR. Technical Writer', 'aviation', '["Senior Technical Writer", "Sr Tech Writer"]'::jsonb),
    (p_tenant_id, 'Structures Mechanic', 'aviation', '["Structural Mechanic"]'::jsonb),
    (p_tenant_id, 'Structures Technician', 'aviation', '["Structures Tech"]'::jsonb),
    (p_tenant_id, 'Upholstery Fabrication Tech', 'aviation', '["Upholstery Tech", "Upholstery Fabrication Technician"]'::jsonb),
    (p_tenant_id, 'Wire Fabrication Technician', 'aviation', '["Wire Fab Tech", "Wiring Technician"]'::jsonb),
    (p_tenant_id, 'Wire Harness Fab Shop Lead', 'aviation', '["Wire Harness Lead", "Harness Fab Lead"]'::jsonb)
  on conflict (tenant_id, lower(role_name)) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function cblaero_app.seed_aviation_roles to service_role;

-- H5 fix: Exact case-insensitive role lookup (replaces ilike which treats %/_ as wildcards)
create or replace function cblaero_app.find_role_by_name_exact(p_tenant_id text, p_role_name text)
returns setof cblaero_app.role_taxonomy
language sql stable
as $$
  select * from cblaero_app.role_taxonomy
  where tenant_id = p_tenant_id and lower(role_name) = lower(p_role_name)
  limit 1;
$$;

grant execute on function cblaero_app.find_role_by_name_exact to service_role;

-- Seed canonical IT roles (idempotent via ON CONFLICT)
create or replace function cblaero_app.seed_it_roles(p_tenant_id text)
returns int
language plpgsql
as $$
declare v_count int := 0;
begin
  insert into cblaero_app.role_taxonomy (tenant_id, role_name, category, aliases) values
    (p_tenant_id, 'Business Analyst', 'it', '["Sr. Business Analyst", "Senior Business Analyst", "Sr. Business Systems Analyst", "Business Systems Analyst", "Sr. Business System Analyst", "Business System Analyst"]'::jsonb),
    (p_tenant_id, 'Java Developer', 'it', '["Sr. Java Developer", "Senior Java Developer", "Full Stack Java Developer", "Java Full Stack Developer", "Sr. Java Full Stack Developer", "Sr. Full Stack Java Developer", "Java/J2EE Developer"]'::jsonb),
    (p_tenant_id, 'Project Manager', 'it', '["Sr. Project Manager", "Senior Project Manager", "IT Project Manager", "Technical Project Manager", "Program Manager"]'::jsonb),
    (p_tenant_id, 'Software Engineer', 'it', '["Senior Software Engineer", "Software Developer", "Senior Software Developer", "Developer", "Senior Developer"]'::jsonb),
    (p_tenant_id, 'DevOps Engineer', 'it', '["Sr. DevOps Engineer", "AWS DevOps Engineer", "Senior DevOps Engineer"]'::jsonb),
    (p_tenant_id, 'Full Stack Developer', 'it', '["Full Stack Web Developer", "Fullstack Developer"]'::jsonb),
    (p_tenant_id, 'Scrum Master', 'it', '["Agile Scrum Master", "Senior Scrum Master"]'::jsonb),
    (p_tenant_id, 'Network Engineer', 'it', '["Sr. Network Engineer", "Senior Network Engineer", "Network Security Engineer"]'::jsonb),
    (p_tenant_id, 'QA Automation Engineer', 'it', '["QA Engineer", "Software QA Engineer", "QA Analyst", "QA Automation Tester", "Quality Assurance Engineer"]'::jsonb),
    (p_tenant_id, 'Data Engineer', 'it', '["Sr. Data Engineer", "Senior Data Engineer", "Big Data Engineer"]'::jsonb),
    (p_tenant_id, 'Data Scientist', 'it', '["Senior Data Scientist", "Sr. Data Scientist"]'::jsonb),
    (p_tenant_id, 'Data Analyst', 'it', '["Senior Data Analyst", "Sr. Data Analyst"]'::jsonb),
    (p_tenant_id, 'Salesforce Developer', 'it', '["Sr. Salesforce Developer", "Senior Salesforce Developer", "Salesforce Admin"]'::jsonb),
    (p_tenant_id, 'Python Developer', 'it', '["Sr. Python Developer", "Senior Python Developer"]'::jsonb),
    (p_tenant_id, 'Consultant', 'it', '["Senior Consultant", "Independent Consultant", "IT Consultant"]'::jsonb),
    (p_tenant_id, 'UI Developer', 'it', '["Sr. UI Developer", "Senior UI Developer", "UI/UX Developer", "Frontend Developer", "Front End Developer"]'::jsonb),
    (p_tenant_id, '.NET Developer', 'it', '[".Net Developer", "Senior .Net Developer", "Sr. .Net Developer", "C# Developer", "ASP.NET Developer"]'::jsonb),
    (p_tenant_id, 'Android Developer', 'it', '["Senior Android Developer", "Mobile Developer", "iOS Developer"]'::jsonb),
    (p_tenant_id, 'System Administrator', 'it', '["Systems Administrator", "Sr. System Administrator", "Linux Administrator", "Windows Administrator"]'::jsonb),
    (p_tenant_id, 'Systems Engineer', 'it', '["Senior Systems Engineer", "Sr. Systems Engineer"]'::jsonb),
    (p_tenant_id, 'Solution Architect', 'it', '["Technical Architect", "Enterprise Architect", "Sr. Solution Architect", "Senior Architect"]'::jsonb),
    (p_tenant_id, 'Technical Lead', 'it', '["Tech Lead", "Lead Developer", "Development Lead"]'::jsonb),
    (p_tenant_id, 'IT Support Specialist', 'it', '["IT Specialist", "IT Technician", "Technical Support Specialist", "Desktop Support Technician", "Desktop Support", "Help Desk Technician"]'::jsonb),
    (p_tenant_id, 'Service Desk Analyst', 'it', '["Help Desk Analyst", "IT Service Desk"]'::jsonb),
    (p_tenant_id, 'Web Developer', 'it', '["Senior Web Developer", "Web Designer"]'::jsonb),
    (p_tenant_id, 'MuleSoft Developer', 'it', '["MuleSoft Integration Developer", "Mule Developer"]'::jsonb),
    (p_tenant_id, 'ServiceNow Developer', 'it', '["ServiceNow Admin", "ServiceNow Consultant"]'::jsonb),
    (p_tenant_id, 'Product Manager', 'it', '["Senior Product Manager", "Product Owner", "Sr. Product Manager"]'::jsonb),
    (p_tenant_id, 'IT Manager', 'it', '["IT Director", "Manager"]'::jsonb),
    (p_tenant_id, 'Customer Service Representative', 'it', '["Customer Support Representative", "Customer Service Agent"]'::jsonb),
    (p_tenant_id, 'Database Administrator', 'it', '["DBA", "Sr. DBA", "Senior Database Administrator", "Oracle DBA", "SQL Server DBA"]'::jsonb),
    (p_tenant_id, 'Cloud Engineer', 'it', '["AWS Engineer", "Azure Engineer", "Cloud Architect", "Sr. Cloud Engineer"]'::jsonb),
    (p_tenant_id, 'Security Engineer', 'it', '["Cybersecurity Engineer", "Information Security Engineer", "Security Analyst", "Cybersecurity Analyst"]'::jsonb),
    (p_tenant_id, 'ETL Developer', 'it', '["Informatica Developer", "SSIS Developer", "Sr. ETL Developer"]'::jsonb),
    (p_tenant_id, 'SAP Consultant', 'it', '["SAP Developer", "SAP ABAP Developer", "SAP Functional Consultant", "Sr. SAP Consultant"]'::jsonb),
    (p_tenant_id, 'Tableau Developer', 'it', '["Power BI Developer", "BI Developer", "Business Intelligence Developer", "Sr. Tableau Developer"]'::jsonb),
    (p_tenant_id, 'Machine Learning Engineer', 'it', '["ML Engineer", "AI Engineer", "Deep Learning Engineer"]'::jsonb),
    (p_tenant_id, 'React Developer', 'it', '["React.js Developer", "ReactJS Developer", "Senior React Developer"]'::jsonb),
    (p_tenant_id, 'Angular Developer', 'it', '["AngularJS Developer", "Senior Angular Developer"]'::jsonb),
    (p_tenant_id, 'Automation Engineer', 'it', '["RPA Developer", "Automation Tester", "Test Automation Engineer"]'::jsonb),
    (p_tenant_id, 'Network Administrator', 'it', '["Network Technician", "Sr. Network Administrator"]'::jsonb),
    (p_tenant_id, 'SharePoint Developer', 'it', '["SharePoint Administrator", "SharePoint Consultant"]'::jsonb),
    (p_tenant_id, 'Release Engineer', 'it', '["Build Engineer", "Release Manager", "CI/CD Engineer"]'::jsonb),
    (p_tenant_id, 'Pega Developer', 'it', '["Pega Architect", "Sr. Pega Developer"]'::jsonb),
    (p_tenant_id, 'Mainframe Developer', 'it', '["COBOL Developer", "Mainframe Programmer", "z/OS Developer"]'::jsonb),
    (p_tenant_id, 'Recruiter', 'other', '["Technical Recruiter", "IT Recruiter", "Staffing Specialist", "Talent Acquisition"]'::jsonb),
    (p_tenant_id, 'Accountant', 'other', '["Senior Accountant", "Staff Accountant", "CPA"]'::jsonb)
  on conflict (tenant_id, lower(role_name)) do update set aliases = excluded.aliases;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function cblaero_app.seed_it_roles to service_role;

-- Batch update deduced_roles (used by backfill script)
create or replace function cblaero_app.batch_update_deduced_roles(p_updates jsonb)
returns int
language plpgsql as $$
declare v_row jsonb; v_count int := 0;
begin
  for v_row in select value from jsonb_array_elements(p_updates)
  loop
    update cblaero_app.candidates set
      deduced_roles = coalesce(v_row->'deduced_roles', '[]'::jsonb),
      role_deduction_metadata = coalesce(v_row->'role_deduction_metadata', '{}'::jsonb),
      updated_at = now()
    where id = (v_row->>'id')::uuid;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;

grant execute on function cblaero_app.batch_update_deduced_roles to service_role;

-- Server-side heuristic backfill (runs entirely in Postgres)
create or replace function cblaero_app.backfill_deduced_roles_heuristic(
  p_tenant_id text, p_batch_size int default 5000
)
returns table (processed int, assigned int, empty int)
language plpgsql as $$
declare
  v_processed int := 0; v_assigned int := 0; v_empty int := 0;
  v_candidate record; v_role record;
  v_roles text[]; v_best_confidence numeric; v_title text;
begin
  for v_candidate in
    select c.id, c.job_title, c.skills
    from cblaero_app.candidates c
    where c.deduced_roles = '[]'::jsonb and c.tenant_id = p_tenant_id and c.ingestion_state != 'merged'
    order by c.id limit p_batch_size
  loop
    v_roles := '{}'; v_best_confidence := 0;
    v_title := lower(trim(coalesce(v_candidate.job_title, '')));

    if v_title != '' then
      for v_role in select r.role_name, r.aliases from cblaero_app.role_taxonomy r where r.tenant_id = p_tenant_id and r.is_active = true
      loop
        if array_length(v_roles, 1) is not null and array_length(v_roles, 1) >= 3 then exit; end if;
        if v_title = lower(v_role.role_name) then
          v_roles := array_append(v_roles, v_role.role_name);
          if v_best_confidence < 1.0 then v_best_confidence := 1.0; end if; continue;
        end if;
        if exists (select 1 from jsonb_array_elements_text(v_role.aliases) as alias where v_title = lower(alias) or v_title like '%' || lower(alias) || '%') then
          v_roles := array_append(v_roles, v_role.role_name);
          if v_best_confidence < 0.9 then v_best_confidence := 0.9; end if; continue;
        end if;
        if length(v_title) >= 3 and (v_title like '%' || lower(v_role.role_name) || '%' or lower(v_role.role_name) like '%' || v_title || '%') then
          v_roles := array_append(v_roles, v_role.role_name);
          if v_best_confidence < 0.7 then v_best_confidence := 0.7; end if;
        end if;
      end loop;
    end if;

    update cblaero_app.candidates set
      deduced_roles = to_jsonb(v_roles),
      role_deduction_metadata = jsonb_build_object('source','heuristic','confidence',v_best_confidence,'rawJobTitle',v_candidate.job_title,'deducedAt',now()::text),
      ingestion_state = 'active', updated_at = now()
    where id = v_candidate.id;

    v_processed := v_processed + 1;
    if array_length(v_roles, 1) > 0 then v_assigned := v_assigned + 1; else v_empty := v_empty + 1; end if;
  end loop;
  processed := v_processed; assigned := v_assigned; empty := v_empty; return next;
end; $$;

grant execute on function cblaero_app.backfill_deduced_roles_heuristic to service_role;

-- Self-looping wrapper: runs batches until all done
create or replace function cblaero_app.backfill_all_deduced_roles(p_tenant_id text)
returns table (total_processed int, total_assigned int, total_empty int, batches_run int)
language plpgsql as $$
declare
  v_total_processed int := 0; v_total_assigned int := 0; v_total_empty int := 0;
  v_batches int := 0; v_batch record;
begin
  loop
    select * into v_batch from cblaero_app.backfill_deduced_roles_heuristic(p_tenant_id, 5000);
    if v_batch.processed = 0 then exit; end if;
    v_total_processed := v_total_processed + v_batch.processed;
    v_total_assigned := v_total_assigned + v_batch.assigned;
    v_total_empty := v_total_empty + v_batch.empty;
    v_batches := v_batches + 1;
    raise notice 'Batch %: % processed (% assigned, % empty) — cumulative: %', v_batches, v_batch.processed, v_batch.assigned, v_batch.empty, v_total_processed;
  end loop;
  total_processed := v_total_processed; total_assigned := v_total_assigned; total_empty := v_total_empty; batches_run := v_batches; return next;
end; $$;

grant execute on function cblaero_app.backfill_all_deduced_roles to service_role;

-- -----------------------------------------------------------------------
-- Story 2.6: Availability signal history (append-only audit trail)
-- -----------------------------------------------------------------------

create table if not exists cblaero_app.candidate_availability_signals (
  id bigint generated always as identity primary key,
  tenant_id text not null,
  candidate_id uuid not null references cblaero_app.candidates(id) on delete cascade,
  previous_state text not null check (previous_state in ('active', 'passive', 'unavailable')),
  new_state text not null check (new_state in ('active', 'passive', 'unavailable')),
  source text not null check (source in ('self_report', 'engagement', 'manual_refresh', 'system')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_avail_signals_candidate
  on cblaero_app.candidate_availability_signals (tenant_id, candidate_id, created_at desc);
create index idx_avail_signals_tenant_time
  on cblaero_app.candidate_availability_signals (tenant_id, created_at desc);

alter table cblaero_app.candidates
  add column if not exists availability_last_signal_at timestamptz;

create index if not exists idx_candidates_availability_signal_at
  on cblaero_app.candidates (tenant_id, availability_last_signal_at);

-- Atomic state update RPC
create or replace function cblaero_app.update_availability_status(
  p_tenant_id text,
  p_candidate_id uuid,
  p_new_state text,
  p_source text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb as $$
declare
  v_previous_state text;
  v_signal_id bigint;
begin
  select availability_status into v_previous_state
  from cblaero_app.candidates
  where id = p_candidate_id and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Candidate not found: % in tenant %', p_candidate_id, p_tenant_id;
  end if;

  -- Guard against NULL for pre-migration rows
  if v_previous_state is null then
    v_previous_state := 'passive';
  end if;

  update cblaero_app.candidates
  set availability_status = p_new_state,
      availability_last_signal_at = now(),
      updated_at = now()
  where id = p_candidate_id and tenant_id = p_tenant_id;

  insert into cblaero_app.candidate_availability_signals
    (tenant_id, candidate_id, previous_state, new_state, source, metadata)
  values
    (p_tenant_id, p_candidate_id, v_previous_state, p_new_state, p_source, p_metadata)
  returning id into v_signal_id;

  return jsonb_build_object(
    'signal_id', v_signal_id,
    'previous_state', v_previous_state,
    'new_state', p_new_state,
    'source', p_source
  );
end;
$$ language plpgsql security definer;

alter table cblaero_app.candidate_availability_signals enable row level security;
create policy tenant_isolation on cblaero_app.candidate_availability_signals
  using (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'tenant_id');

grant select, insert on cblaero_app.candidate_availability_signals to authenticated;
grant all on cblaero_app.candidate_availability_signals to service_role;
grant execute on function cblaero_app.update_availability_status to authenticated;
grant execute on function cblaero_app.update_availability_status to service_role;

-- -----------------------------------------------------------------------
-- Policy Registry (architecture spec — shared config for refresh cadences, etc.)
-- -----------------------------------------------------------------------

create table if not exists cblaero_app.policy_registry (
  id bigint generated always as identity primary key,
  family text not null,
  key text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  unique (family, key)
);

create table if not exists cblaero_app.policy_versions (
  id bigint generated always as identity primary key,
  policy_id bigint not null references cblaero_app.policy_registry(id) on delete cascade,
  value jsonb not null,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_by_actor_id text not null default 'system',
  created_at timestamptz not null default now()
);

create index if not exists idx_policy_versions_lookup
  on cblaero_app.policy_versions (policy_id, effective_from desc);

alter table cblaero_app.policy_registry enable row level security;
alter table cblaero_app.policy_versions enable row level security;

create policy policy_registry_read on cblaero_app.policy_registry
  for select using (true);
create policy policy_versions_read on cblaero_app.policy_versions
  for select using (true);

grant select on cblaero_app.policy_registry to authenticated, service_role;
grant select on cblaero_app.policy_versions to authenticated, service_role;
grant all on cblaero_app.policy_registry to service_role;
grant all on cblaero_app.policy_versions to service_role;

-- Seed: availability refresh cadence policy
insert into cblaero_app.policy_registry (family, key, description)
values ('refresh_cadences', 'candidate_availability', 'Candidate availability refresh interval')
on conflict (family, key) do nothing;

insert into cblaero_app.policy_versions (policy_id, value, effective_from, created_by_actor_id)
select id, '{"interval_hours": 4}'::jsonb, now(), 'system'
from cblaero_app.policy_registry
where family = 'refresh_cadences' and key = 'candidate_availability'
  and not exists (
    select 1 from cblaero_app.policy_versions pv where pv.policy_id = policy_registry.id
  );
