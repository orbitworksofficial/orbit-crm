-- ============================================================================
-- Orbit Works CRM — Phase 2: Email Engine integration
-- ============================================================================
-- The CRM is the single source of truth for leads; the Email Engine turns them
-- into booked calls. When a lead is captured here, the Engine is notified, it
-- writes and sends personalised outreach, and it reports back what happened.
--
-- This migration adds the CRM's half of that: a record of what was sent, and
-- somewhere to honour an unsubscribe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Do not contact
-- ----------------------------------------------------------------------------
-- A lead who unsubscribes must stop receiving outreach. Storing that as a flag
-- on the contact rather than only in the Engine's suppression list means the
-- CRM can refuse to hand them over again — otherwise a re-import or a second
-- form submission would quietly resume emailing someone who opted out.
alter table contacts
  add column do_not_contact boolean not null default false,
  add column do_not_contact_at timestamptz,
  add column do_not_contact_reason text;

comment on column contacts.do_not_contact is
  'Set when the lead unsubscribes or is manually suppressed. Checked before any outreach is triggered, so a re-import cannot resume emailing someone who opted out.';

-- ----------------------------------------------------------------------------
-- Outreach log
-- ----------------------------------------------------------------------------
-- One row per lead handed to the Engine, updated as it reports back.
--
-- It earns its place three times over: it is the idempotency key, so a retried
-- webhook or a re-saved contact cannot trigger a second sequence; it is the
-- only place a failure is visible, since the Engine's callback has no retries
-- and a dropped one would otherwise vanish; and it answers "was this lead
-- actually contacted?", which is the first thing anyone asks.
create table email_outreach (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,
  contact_id      uuid        not null references contacts(id) on delete cascade,

  -- pending  — queued locally, not yet accepted by the Engine
  -- accepted — the Engine returned 202 and owns it now
  -- failed   — could not be handed over; see error
  -- skipped  — deliberately not sent; see error for why
  status          text        not null default 'pending',

  -- The Engine's own progress, from its callbacks. Null until it reports.
  -- Kept separate from `status` because they answer different questions:
  -- status is "did we hand it over", stage is "what has the Engine done".
  stage           text,

  error           text,
  http_status     integer,
  /** Whatever the Engine sent with its last callback, for diagnosis. */
  last_event      jsonb,

  sent_at         timestamptz,
  booked_at       timestamptz,
  opted_out_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- One outreach sequence per contact. A second attempt updates this row
  -- rather than starting a parallel sequence.
  unique (contact_id),

  constraint email_outreach_status_known
    check (status in ('pending', 'accepted', 'failed', 'skipped'))
);

create index email_outreach_org_created_idx
  on email_outreach(organization_id, created_at desc);
create index email_outreach_status_idx
  on email_outreach(organization_id, status);

create trigger email_outreach_set_updated_at before update on email_outreach
  for each row execute function set_updated_at();

alter table email_outreach enable row level security;

-- Readable org-wide: "has this lead been emailed yet" is a question a
-- salesperson needs answered, and the row holds no credentials. Writes are
-- admin and service-role only, since the callback arrives unauthenticated by
-- any CRM session.
create policy email_outreach_select on email_outreach
  for select using (organization_id = current_org_id());

create policy email_outreach_write on email_outreach
  for all using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id() and is_admin());

-- ----------------------------------------------------------------------------
-- Which sources trigger outreach
-- ----------------------------------------------------------------------------
-- A referral from a friend should not receive an automated "thanks for your
-- interest, book a call" email; a cold ad click should. That judgement belongs
-- to whoever runs the marketing, not to a constant in the code, so it lives on
-- the lead source itself and is editable in Settings.
alter table lead_sources
  add column triggers_outreach boolean not null default false;

comment on column lead_sources.triggers_outreach is
  'Whether a lead from this source is handed to the Email Engine for automated outreach. Off by default: sending is the exception that has to be chosen, not the default that has to be remembered.';

-- Paid channels, the website form and the chatbot: all are strangers who
-- asked to be contacted. Referral and cold outreach are deliberately excluded,
-- since both are already a personal relationship.
update lead_sources
set triggers_outreach = true
where slug in (
  'meta_lead_ads',
  'meta_ads',
  'google_ads',
  'linkedin',
  'website_form',
  'ai_chatbot'
);
