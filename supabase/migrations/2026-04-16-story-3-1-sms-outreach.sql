-- Story 3.1: SMS Outreach Template and Scheduling Workflow
-- Tables for SMS template management, send tracking, consent/opt-out, and audit.
-- Run after schema.sql and story-2-7-global-scheduler.sql have been applied.

SET search_path TO cblaero_app;

-- ── sms_templates ────────────────────────────────────────────────────────────
-- Admin-managed SMS templates organized by recruiting workflow agenda.
-- Versioned: updates INSERT a new row; previous version auto-archived.

CREATE TABLE IF NOT EXISTS cblaero_app.sms_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  agenda          text        NOT NULL
                    CONSTRAINT sms_templates_agenda_valid
                    CHECK (agenda IN (
                      'new_opportunity','availability_check','job_followup',
                      'submission_followup','interview_schedule','interview_reminder',
                      'interview_followup','bgv_initiation','bgv_followup',
                      'offer_extended','onboarding','reengagement','general'
                    )),
  name            text        NOT NULL,
  template_key    text        NOT NULL,
  body            text        NOT NULL
                    CONSTRAINT sms_templates_body_length CHECK (length(body) <= 1600),
  variables       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  version         int         NOT NULL DEFAULT 1,
  status          text        NOT NULL DEFAULT 'active'
                    CONSTRAINT sms_templates_status_valid
                    CHECK (status IN ('active','archived')),
  created_by      text,
  updated_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_templates_tenant_key_version
  ON cblaero_app.sms_templates (tenant_id, template_key, version);

CREATE INDEX IF NOT EXISTS idx_sms_templates_tenant_agenda_status
  ON cblaero_app.sms_templates (tenant_id, agenda, status);

ALTER TABLE cblaero_app.sms_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY sms_templates_read ON cblaero_app.sms_templates
  FOR SELECT USING (true);

GRANT SELECT ON cblaero_app.sms_templates TO authenticated, service_role;
GRANT ALL    ON cblaero_app.sms_templates TO service_role;


-- ── sms_sends ────────────────────────────────────────────────────────────────
-- One row per scheduled SMS send.  Tracks the full lifecycle from pending
-- through delivery or failure.

CREATE TABLE IF NOT EXISTS cblaero_app.sms_sends (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   text        NOT NULL,
  campaign_id                 uuid,
  candidate_id                uuid        NOT NULL,
  template_id                 uuid        NOT NULL REFERENCES cblaero_app.sms_templates(id),
  template_version            int         NOT NULL,
  rendered_body               text,
  rendered_body_hash          text,
  context_params              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  provider                    text,
  provider_message_id         text,
  status                      text        NOT NULL DEFAULT 'pending'
                                CONSTRAINT sms_sends_status_valid
                                CHECK (status IN (
                                  'pending','queued','sent','delivered',
                                  'failed','bounced','undeliverable',
                                  'blocked_opt_out','deferred_window'
                                )),
  delivery_attempt_count      int         NOT NULL DEFAULT 0,
  last_attempt_at             timestamptz,
  scheduled_for               timestamptz NOT NULL DEFAULT now(),
  sent_at                     timestamptz,
  contact_window_deferred_until timestamptz,
  blocked_reason              text,
  sender_user_id              text,
  -- Engagement tracking
  tracking_token              text        UNIQUE,  -- short token for click-tracking URL
  tracking_url                text,                -- full URL embedded in message: /api/outreach/track/{token}
  clicked_at                  timestamptz,         -- when candidate clicked the tracking link
  click_count                 int         NOT NULL DEFAULT 0,
  -- Response tracking (includes STOP replies)
  response_received_at        timestamptz,
  response_body               text,                -- raw reply text (STOP, YES, NO, etc.)
  response_type               text                 -- 'opt_out', 'affirmative', 'negative', 'freeform'
                                CONSTRAINT sms_sends_response_type_valid
                                CHECK (response_type IS NULL OR response_type IN (
                                  'opt_out','affirmative','negative','freeform'
                                )),
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_sends_tenant_candidate_status
  ON cblaero_app.sms_sends (tenant_id, candidate_id, status);

CREATE INDEX IF NOT EXISTS idx_sms_sends_pending_due
  ON cblaero_app.sms_sends (tenant_id, scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_sms_sends_deferred_window
  ON cblaero_app.sms_sends (tenant_id, contact_window_deferred_until)
  WHERE status = 'deferred_window';

ALTER TABLE cblaero_app.sms_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY sms_sends_read ON cblaero_app.sms_sends
  FOR SELECT USING (true);

GRANT SELECT ON cblaero_app.sms_sends TO authenticated, service_role;
GRANT ALL    ON cblaero_app.sms_sends TO service_role;


-- ── candidate_channel_preferences ────────────────────────────────────────────
-- One row per candidate.  Shared by SMS and email (Story 3.2 reuses email cols).
-- Defaults: opted-in for both channels.

CREATE TABLE IF NOT EXISTS cblaero_app.candidate_channel_preferences (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id      uuid        NOT NULL,
  tenant_id         text        NOT NULL,
  sms_opted_in      boolean     NOT NULL DEFAULT true,
  sms_opt_out_at    timestamptz,
  sms_opt_out_reason text,
  email_opted_in    boolean     NOT NULL DEFAULT true,
  email_opt_out_at  timestamptz,
  email_opt_out_reason text,
  contact_windows   jsonb,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_prefs_candidate
  ON cblaero_app.candidate_channel_preferences (candidate_id);

CREATE INDEX IF NOT EXISTS idx_channel_prefs_tenant
  ON cblaero_app.candidate_channel_preferences (tenant_id);

ALTER TABLE cblaero_app.candidate_channel_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY channel_prefs_read ON cblaero_app.candidate_channel_preferences
  FOR SELECT USING (true);

GRANT SELECT ON cblaero_app.candidate_channel_preferences TO authenticated, service_role;
GRANT ALL    ON cblaero_app.candidate_channel_preferences TO service_role;


-- ── outreach_audit_log ───────────────────────────────────────────────────────
-- Append-only audit trail for all outreach events (SMS and email).
-- NEVER DELETE from this table (Epic 2 postmortem lesson).

CREATE TABLE IF NOT EXISTS cblaero_app.outreach_audit_log (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text        NOT NULL,
  channel                 text        NOT NULL
                            CONSTRAINT outreach_audit_channel_valid
                            CHECK (channel IN ('sms','email')),
  send_id                 uuid,
  candidate_id            uuid        NOT NULL,
  sender_user_id          text,
  sender_role             text,
  template_id             uuid,
  template_agenda         text,
  delivery_status         text,
  content_hash            text,
  compliance_check_passed boolean,
  blocked_reason          text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_audit_tenant_created
  ON cblaero_app.outreach_audit_log (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_outreach_audit_candidate
  ON cblaero_app.outreach_audit_log (candidate_id);

ALTER TABLE cblaero_app.outreach_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY outreach_audit_read ON cblaero_app.outreach_audit_log
  FOR SELECT USING (true);

GRANT SELECT ON cblaero_app.outreach_audit_log TO authenticated, service_role;
GRANT ALL    ON cblaero_app.outreach_audit_log TO service_role;


-- ── Seed templates ───────────────────────────────────────────────────────────
-- 12 base templates for the default tenant.  ON CONFLICT DO NOTHING = safe re-run.
-- Uses CBL_APP_TENANT_ID placeholder — replace with actual tenant ID at runtime
-- or use a bootstrap function.  For migration, we use a known default.

DO $$
DECLARE
  v_tenant text := coalesce(current_setting('app.tenant_id', true), 'cbl-default');
BEGIN

-- {{tracking_link}} is auto-injected at render time — it resolves to
-- /api/outreach/track/{token} which logs the click and redirects.
-- Templates use persuasive angles: urgency, exclusivity, social proof, curiosity.

INSERT INTO cblaero_app.sms_templates (tenant_id, agenda, name, template_key, body, variables, version, status, created_by)
VALUES
  -- 1. New Opportunity — urgency + exclusivity angle
  (v_tenant, 'new_opportunity', 'New Opportunity', 'new_opportunity_default',
   'Hi {{first_name}}, {{recruiter_name}} here from CBL Solutions. A {{job_title}} role just opened at {{company}} in {{location}} — your skills are a strong match and they''re interviewing this week. See details: {{tracking_link}} Reply YES if interested or STOP to opt out.',
   '["first_name","recruiter_name","job_title","company","location","tracking_link"]'::jsonb, 1, 'active', 'system'),

  -- 2. Availability Check — low-friction + value prop
  (v_tenant, 'availability_check', 'Availability Check', 'availability_check_default',
   'Hi {{first_name}}, CBL Solutions here. We''re matching top aviation talent with urgent roles right now. Are you open to new opportunities? Takes 10 seconds: {{tracking_link}} Reply YES/NO or STOP to opt out.',
   '["first_name","tracking_link"]'::jsonb, 1, 'active', 'system'),

  -- 3. Job Follow-up — scarcity + next step clarity
  (v_tenant, 'job_followup', 'Job Follow-up', 'job_followup_default',
   'Hi {{first_name}}, checking in on the {{job_title}} role at {{company}}. They''re down to final candidates — wanted to make sure you don''t miss out. Still interested? Reply YES or view details: {{tracking_link}} STOP to opt out.',
   '["first_name","job_title","company","tracking_link"]'::jsonb, 1, 'active', 'system'),

  -- 4. Submission Follow-up — transparency + status update
  (v_tenant, 'submission_followup', 'Submission Follow-up', 'submission_followup_default',
   'Hi {{first_name}}, good news — your profile was submitted to {{company}} for {{job_title}}. We typically hear back within 48-72 hrs. Track your status: {{tracking_link}} Reply STOP to opt out.',
   '["first_name","company","job_title","tracking_link"]'::jsonb, 1, 'active', 'system'),

  -- 5. Interview Schedule — excitement + clear action
  (v_tenant, 'interview_schedule', 'Interview Schedule', 'interview_schedule_default',
   'Congrats {{first_name}}! {{company}} wants to interview you for {{job_title}} on {{interview_date}} at {{interview_time}}. Location: {{interview_location}}. Confirm here: {{tracking_link}} Reply YES to confirm or STOP to opt out.',
   '["first_name","job_title","company","interview_date","interview_time","interview_location","tracking_link"]'::jsonb, 1, 'active', 'system'),

  -- 6. Interview Reminder — helpful + reduce no-shows
  (v_tenant, 'interview_reminder', 'Interview Reminder', 'interview_reminder_default',
   'Hi {{first_name}}, friendly reminder — your interview for {{job_title}} at {{company}} is tomorrow at {{interview_time}}. Location: {{interview_location}}. Prep tips: {{tracking_link}} You''ve got this! Reply STOP to opt out.',
   '["first_name","job_title","company","interview_time","interview_location","tracking_link"]'::jsonb, 1, 'active', 'system'),

  -- 7. Interview Follow-up — empathy + next steps
  (v_tenant, 'interview_followup', 'Interview Follow-up', 'interview_followup_default',
   'Hi {{first_name}}, great job on your {{job_title}} interview at {{company}}! We''re gathering feedback now — expect an update within 2-3 business days. Questions? Reply here or check status: {{tracking_link}} STOP to opt out.',
   '["first_name","job_title","company","tracking_link"]'::jsonb, 1, 'active', 'system'),

  -- 8. BGV Initiation — milestone celebration + clear CTA
  (v_tenant, 'bgv_initiation', 'BGV Initiation', 'bgv_initiation_default',
   'Hi {{first_name}}, you''re moving forward with {{company}}! Next step: background verification. Please complete the form (5 min): {{tracking_link}} The sooner it''s done, the sooner we can finalize. Reply STOP to opt out.',
   '["first_name","company","tracking_link"]'::jsonb, 1, 'active', 'system'),

  -- 9. BGV Follow-up — gentle urgency + blocker removal
  (v_tenant, 'bgv_followup', 'BGV Follow-up', 'bgv_followup_default',
   'Hi {{first_name}}, your background check for {{company}} is almost done but has a pending item. This is the last step before your offer — complete it here: {{tracking_link}} Need help? Reply to this message. STOP to opt out.',
   '["first_name","company","tracking_link"]'::jsonb, 1, 'active', 'system'),

  -- 10. Offer Extended — celebration + urgency to act
  (v_tenant, 'offer_extended', 'Offer Extended', 'offer_extended_default',
   'Hi {{first_name}}, amazing news — {{company}} has extended an offer for {{job_title}}! Review the details and next steps: {{tracking_link}} We''re thrilled for you. Reply with any questions! STOP to opt out.',
   '["first_name","company","job_title","tracking_link"]'::jsonb, 1, 'active', 'system'),

  -- 11. Onboarding — excitement + practical info
  (v_tenant, 'onboarding', 'Onboarding', 'onboarding_default',
   'Welcome aboard {{first_name}}! Your start date at {{company}} is {{start_date}}. Everything you need for day one is here: {{tracking_link}} We''re excited to have you on the team! Reply STOP to opt out.',
   '["first_name","company","start_date","tracking_link"]'::jsonb, 1, 'active', 'system'),

  -- 12. Re-engagement — curiosity + value-first
  (v_tenant, 'reengagement', 'Re-engagement', 'reengagement_default',
   'Hi {{first_name}}, aviation hiring is surging right now and we have roles that match your background. Curious? See what''s available: {{tracking_link}} Reply YES to reconnect or STOP to opt out.',
   '["first_name","tracking_link"]'::jsonb, 1, 'active', 'system')

ON CONFLICT DO NOTHING;

END $$;
