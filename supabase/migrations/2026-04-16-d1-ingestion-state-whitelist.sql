-- D1 (Epic 2 retro): expand ingestion_state preservation whitelist in upsert RPCs
--
-- Bug: the ON CONFLICT DO UPDATE clause in upsert_candidate_batch and
-- process_import_chunk only preserved 'active' and 'pending_review' states.
-- Candidates in 'rejected', 'merged', or 'pending_enrichment' states would
-- be stomped back to 'pending_dedup' on re-import (Clay re-push, CSV re-upload,
-- ATS re-sync). This is wrong — only 'pending_dedup' should be overwritable
-- because it means "fresh/unprocessed and safe to replace."
--
-- Fix: expand whitelist to all non-pending_dedup states. Now only candidates
-- still waiting for initial dedup processing will have their ingestion_state
-- overwritten by a re-import.
-- Affects: upsert_candidate_batch (both branches) and process_import_chunk
-- (both branches). All 4 CASE expressions get the same expanded whitelist.
--
-- Safe to re-run (create or replace function is idempotent).

-- ── upsert_candidate_batch ──────────────────────────────────────────────────
-- This RPC was last redefined by 2026-04-15-story-2-8-null-name-safety.sql.
-- We redefine it here with the expanded whitelist. The function body is
-- identical except for the CASE whitelist on ingestion_state (4 values → 5).

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
    v_first_name := trim(coalesce(v_row->>'first_name', ''));
    v_last_name  := trim(coalesce(v_row->>'last_name', ''));

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
        -- D1: preserve ALL non-pending_dedup states. Only pending_dedup (fresh/unprocessed) is safe to overwrite.
        ingestion_state = case
          when cblaero_app.candidates.ingestion_state in ('active', 'pending_review', 'rejected', 'merged', 'pending_enrichment') then cblaero_app.candidates.ingestion_state
          else excluded.ingestion_state
        end,
        source = excluded.source, source_batch_id = excluded.source_batch_id,
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


-- ── process_import_chunk ────────────────────────────────────────────────────
-- Same D1 fix applied to the CSV / initial-migration import RPC. Body copied
-- verbatim from schema.sql §process_import_chunk with the CASE whitelist
-- already expanded to 5 states (both email and phone branches).

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
$$;

grant execute on function cblaero_app.process_import_chunk(uuid, jsonb, jsonb, int, int, int) to service_role;
