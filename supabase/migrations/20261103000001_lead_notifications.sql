-- ============================================================================
-- Orbit Works CRM — Lead notifications
-- ============================================================================
-- A lead that arrives at 2am currently sits unseen until someone opens the
-- CRM. The realtime refresh only helps whoever already has the page open, and
-- a lead nobody knows about is worth the same as no lead at all.
--
-- This stores who gets told, and a record of what was sent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Recipients
-- ----------------------------------------------------------------------------
-- A table rather than a column on organizations: several people need telling,
-- the list changes without a deploy, and each needs its own enabled flag so one
-- person can be paused without losing their address.
create table notification_recipients (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,

  email           text        not null,
  -- Shown in the UI so a list of addresses is readable at a glance.
  label           text,

  is_active       boolean     not null default true,

  created_by      uuid        references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),

  -- Case-insensitive, so the same person cannot be added twice under a
  -- different capitalisation and then receive everything in duplicate.
  unique (organization_id, email),
  constraint notification_recipient_email_shape
    check (position('@' in email) > 1)
);

create index notification_recipients_org_idx
  on notification_recipients(organization_id)
  where is_active;

alter table notification_recipients enable row level security;

-- Visible org-wide, since knowing who gets alerted is not sensitive; only
-- admins decide the list.
create policy notification_recipients_select on notification_recipients
  for select using (organization_id = current_org_id());

create policy notification_recipients_write on notification_recipients
  for all using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id() and is_admin());

-- ----------------------------------------------------------------------------
-- Delivery log
-- ----------------------------------------------------------------------------
-- One row per lead alerted on. Three jobs: it stops a duplicate alert if the
-- same lead is processed twice, it makes a silent failure visible — "why
-- didn't I hear about that lead?" is otherwise unanswerable — and it records
-- deliberate skips, which look identical to failures without it.
create table lead_notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,
  contact_id      uuid        not null references contacts(id) on delete cascade,

  -- sent | failed | skipped
  status          text        not null,
  -- Who it actually went to, so the log stays true even after the recipient
  -- list changes.
  recipients      text[]      not null default '{}',
  -- The failure, or for `skipped` rows the reason nothing was sent.
  error           text,
  provider_id     text,

  created_at      timestamptz not null default now(),

  unique (contact_id),
  constraint lead_notification_status_known
    check (status in ('sent', 'failed', 'skipped'))
);

create index lead_notifications_org_created_idx
  on lead_notifications(organization_id, created_at desc);

alter table lead_notifications enable row level security;

create policy lead_notifications_select on lead_notifications
  for select using (organization_id = current_org_id());

create policy lead_notifications_write on lead_notifications
  for all using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id() and is_admin());

-- ----------------------------------------------------------------------------
-- Which sources are worth an alert
-- ----------------------------------------------------------------------------
-- Separate from triggers_outreach: that decides whether the LEAD is emailed,
-- this decides whether YOU are. A referral should not get automated outreach
-- but is certainly worth knowing about, so the two cannot share a flag.
--
-- On by default, because the cost of a missed lead is higher than the cost of
-- an extra email.
alter table lead_sources
  add column notify_on_lead boolean not null default true;

comment on column lead_sources.notify_on_lead is
  'Whether a new lead from this source sends an internal alert. Distinct from triggers_outreach, which decides whether the lead itself is emailed.';
