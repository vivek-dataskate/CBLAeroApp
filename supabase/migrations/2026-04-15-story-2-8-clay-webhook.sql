-- Story 2.8: Clay Webhook Ingestion
-- Reuses existing ingestion types — content_fingerprints stores Clay rows with
-- `fingerprint_type='ats_external_id'` and `source='ats'`. The hash carries the
-- `clay:{profile_id}:{last_refresh}` prefix to avoid collision with Ceipal's
-- `ceipal:...` prefix. candidates.source and sync_runs.source are free-text and
-- use 'clay_enrichment' — only the content_fingerprints table is CHECK-constrained,
-- and we reuse its existing enum rather than extending it.
--
-- Adds a single nullable column to candidates that identifies which CBLAero user
-- a Clay-ingested candidate was stamped to at ingestion time, as source provenance.
-- Recruiter-level assignment model is deferred — this column is forward-looking
-- and consumed only by the Clay webhook ingestion path for now.
--
-- Safe to run repeatedly (idempotent via `if not exists`).

alter table cblaero_app.candidates
  add column if not exists source_recruiter_actor_id text;

-- Partial index: skip nulls, which will be the vast majority of existing rows
-- (only Clay-ingested candidates populate this column in the 2.8 scope).
create index if not exists idx_candidates_source_recruiter
  on cblaero_app.candidates (tenant_id, source_recruiter_actor_id)
  where source_recruiter_actor_id is not null;

comment on column cblaero_app.candidates.source_recruiter_actor_id is
  'User ID (cblaero_app.user.id) of the CBLAero user to whom this candidate was stamped at ingestion time. '
  'Populated by the Clay webhook ingestion path (Story 2.8) using CLAY_DEFAULT_ASSIGNEE_EMAIL. '
  'Forward-looking provenance column — a real candidate-to-recruiter assignment model will consume this in a later story (likely Epic 4).';

-- Redefine upsert_candidate_batch RPC to include source_recruiter_actor_id in both branches.
-- This matches the updated schema.sql definition — the `create or replace` is a drop-in
-- replacement and the function is idempotent.
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
          when cblaero_app.candidates.ingestion_state in ('active', 'pending_review') then cblaero_app.candidates.ingestion_state
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
end; $$;

grant execute on function cblaero_app.upsert_candidate_batch(jsonb) to service_role;
