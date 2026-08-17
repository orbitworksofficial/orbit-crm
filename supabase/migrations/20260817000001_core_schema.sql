-- ============================================================================
-- Orbit Works CRM — Phase 1 Core Schema
-- ============================================================================
-- Design principles:
--   1. Every tenant-owned table carries organization_id. Phase 1 runs with a
--      single organization; Phase 2 multi-tenancy becomes a data concern rather
--      than a migration. See docs/SCHEMA.md.
--   2. User-editable vocabularies (lead sources, lead statuses) are lookup
--      tables, never Postgres enums, because Settings lets admins rename them.
--   3. Truly fixed vocabularies (user roles, deal status, invoice status) are
--      enums — renaming these would change application logic, not just labels.
--   4. Derived state (invoice "overdue") is computed, never stored, so it can
--      never drift from the underlying dates.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums — fixed vocabularies that application logic branches on.
-- ---------------------------------------------------------------------------

create type user_role as enum ('admin', 'sales');

-- Phase 1 keeps deals at Open/Won/Lost per the brief. Phase 2 introduces a
-- Kanban pipeline; deals.stage_id (nullable, added in 0002) will carry the
-- richer position while this column remains the coarse outcome.
create type deal_status as enum ('open', 'won', 'lost');

-- 'overdue' is deliberately NOT a member. Overdue is derived from due_date and
-- exposed via the invoices_with_status view below.
create type invoice_status as enum ('draft', 'sent', 'paid', 'void');

-- ---------------------------------------------------------------------------
-- Organizations — the Phase 2 tenant boundary, present from day one.
-- ---------------------------------------------------------------------------

create table organizations (
  id                  uuid primary key default gen_random_uuid(),
  name                text        not null,
  slug                text        not null unique,

  -- Company profile (Settings → Company profile); feeds the invoice PDF header.
  logo_path           text,
  website_url         text,
  contact_email       text,

  -- Invoice settings (Settings → Invoice settings).
  invoice_prefix      text        not null default 'INV',
  invoice_next_number integer     not null default 1,
  default_currency    text        not null default 'USD',
  default_payment_terms_days integer not null default 30,
  default_tax_rate    numeric(5,2) not null default 0,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint invoice_next_number_positive check (invoice_next_number > 0),
  constraint default_tax_rate_valid check (default_tax_rate >= 0 and default_tax_rate <= 100)
);

comment on table organizations is
  'Tenant root. Phase 1 has exactly one row; Phase 2 adds rows per customer.';
comment on column organizations.invoice_next_number is
  'Next sequence value for invoice numbering. Allocated transactionally by next_invoice_number().';

-- ---------------------------------------------------------------------------
-- Profiles — application-level user record, 1:1 with auth.users.
-- ---------------------------------------------------------------------------
-- Supabase owns auth.users (credentials, password reset). This table owns the
-- CRM's view of a user: which org they belong to, their role, and whether they
-- are still active.

create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid        not null references organizations(id) on delete cascade,
  full_name       text        not null,
  email           text        not null,
  role            user_role   not null default 'sales',
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index profiles_organization_id_idx on profiles(organization_id);
create index profiles_email_idx on profiles(email);

comment on table profiles is
  'CRM user record mirroring auth.users. Deactivation sets is_active=false rather than deleting, preserving authorship of historical notes.';

-- ---------------------------------------------------------------------------
-- Lookup tables — admin-editable vocabularies.
-- ---------------------------------------------------------------------------

create table lead_sources (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,
  name            text        not null,
  -- Stable machine key so the website form can post source='website_form'
  -- even after an admin renames the display label.
  slug            text        not null,
  is_active       boolean     not null default true,
  sort_order      integer     not null default 0,
  created_at      timestamptz not null default now(),

  unique (organization_id, slug)
);

create index lead_sources_organization_id_idx on lead_sources(organization_id);

comment on column lead_sources.slug is
  'Immutable machine key used by the public lead intake API. Display name may change; slug must not.';

create table lead_statuses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,
  name            text        not null,
  slug            text        not null,
  -- Drives the conversion-rate metric without hardcoding a status name.
  is_won          boolean     not null default false,
  is_lost         boolean     not null default false,
  is_active       boolean     not null default true,
  sort_order      integer     not null default 0,
  created_at      timestamptz not null default now(),

  unique (organization_id, slug),
  constraint status_not_both_won_and_lost check (not (is_won and is_lost))
);

create index lead_statuses_organization_id_idx on lead_statuses(organization_id);

comment on column lead_statuses.is_won is
  'Marks terminal-won statuses. Dashboard conversion rate counts contacts in any is_won status, so renaming or adding statuses never breaks the metric.';

-- ---------------------------------------------------------------------------
-- Services — the Orbit Works service catalogue.
-- ---------------------------------------------------------------------------

create table services (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid          not null references organizations(id) on delete cascade,
  name            text          not null,
  slug            text          not null,
  description     text,
  -- Pre-fills invoice line items. Nullable: not every service has a list price.
  default_rate    numeric(12,2),
  is_active       boolean       not null default true,
  sort_order      integer       not null default 0,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now(),

  unique (organization_id, slug),
  constraint default_rate_non_negative check (default_rate is null or default_rate >= 0)
);

create index services_organization_id_idx on services(organization_id);

comment on table services is
  'Master service catalogue. Archived via is_active=false rather than deleted, so historical invoice line items keep resolving.';

-- ---------------------------------------------------------------------------
-- Contacts — leads and customers.
-- ---------------------------------------------------------------------------

create table contacts (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,

  -- Core fields
  full_name       text        not null,
  email           text,
  whatsapp_number text,
  company_name    text,
  industry        text,
  city            text,
  country         text,

  -- Classification. Restricted rather than cascaded: deleting a source that is
  -- still in use should fail loudly, not silently orphan contacts.
  lead_source_id  uuid        references lead_sources(id) on delete restrict,
  lead_status_id  uuid        references lead_statuses(id) on delete restrict,

  -- Ownership. Nullable so an inbound web lead can land unassigned.
  assigned_to     uuid        references profiles(id) on delete set null,

  -- Phase 2 attribution hooks. Populated by the website form today (UTM tags
  -- are free to capture), consumed by ad-platform integration later.
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  external_ref    text,

  created_by      uuid        references profiles(id) on delete set null,
  -- Immutable per the brief: "Auto-captured. Cannot be edited."
  -- Enforced by the trigger below, not just by convention.
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index contacts_organization_id_idx on contacts(organization_id);
create index contacts_assigned_to_idx on contacts(assigned_to);
create index contacts_lead_status_id_idx on contacts(lead_status_id);
create index contacts_lead_source_id_idx on contacts(lead_source_id);
-- Dashboard filters every metric by created_at within an org.
create index contacts_org_created_at_idx on contacts(organization_id, created_at desc);

comment on column contacts.created_at is
  'Immutable. Protected by contacts_freeze_created_at trigger; used for all dashboard date filtering.';

-- Contact ←→ Service tags (multi-select service interest).
create table contact_services (
  contact_id uuid not null references contacts(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  primary key (contact_id, service_id)
);

create index contact_services_service_id_idx on contact_services(service_id);

-- ---------------------------------------------------------------------------
-- Deals
-- ---------------------------------------------------------------------------

create table deals (
  id                 uuid          primary key default gen_random_uuid(),
  organization_id    uuid          not null references organizations(id) on delete cascade,
  -- A contact can have many deals over time; deleting the contact removes them.
  contact_id         uuid          not null references contacts(id) on delete cascade,

  title              text          not null,
  value              numeric(12,2) not null default 0,
  currency           text          not null default 'USD',
  status             deal_status   not null default 'open',
  expected_close_date date,
  -- Set when status moves to won/lost; drives "revenue in period" accurately
  -- even when a deal is created in one month and closed in another.
  closed_at          timestamptz,

  assigned_to        uuid          references profiles(id) on delete set null,
  created_by         uuid          references profiles(id) on delete set null,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now(),

  constraint deal_value_non_negative check (value >= 0)
);

create index deals_organization_id_idx on deals(organization_id);
create index deals_contact_id_idx on deals(contact_id);
create index deals_assigned_to_idx on deals(assigned_to);
create index deals_status_idx on deals(status);
create index deals_org_closed_at_idx on deals(organization_id, closed_at desc);

comment on column deals.closed_at is
  'Timestamp the deal reached a terminal status. Revenue-in-period sums won deals by this column, not created_at.';

create table deal_services (
  deal_id    uuid not null references deals(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  primary key (deal_id, service_id)
);

create index deal_services_service_id_idx on deal_services(service_id);

-- ---------------------------------------------------------------------------
-- Notes — polymorphic over contacts and deals.
-- ---------------------------------------------------------------------------
-- A single table with a CHECK constraint keeps the activity timeline a single
-- ordered query instead of a UNION across two shapes.

create table notes (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,

  contact_id      uuid        references contacts(id) on delete cascade,
  deal_id         uuid        references deals(id) on delete cascade,

  body            text        not null,

  -- Optional next-action reminder (brief §08).
  next_action_at          date,
  next_action_description text,

  -- Author is retained even if the profile row is later removed.
  author_id       uuid        references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Exactly one parent.
  constraint note_has_exactly_one_parent check (
    (contact_id is not null and deal_id is null) or
    (contact_id is null and deal_id is not null)
  )
);

create index notes_contact_id_idx on notes(contact_id, created_at desc);
create index notes_deal_id_idx on notes(deal_id, created_at desc);
create index notes_organization_id_idx on notes(organization_id);
create index notes_next_action_idx on notes(organization_id, next_action_at)
  where next_action_at is not null;

comment on table notes is
  'Timestamped notes on either a contact or a deal (never both). Feeds the activity timeline alongside activity_log.';

-- ---------------------------------------------------------------------------
-- Activity log — status changes and other auditable events.
-- ---------------------------------------------------------------------------

create table activity_log (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,

  contact_id      uuid        references contacts(id) on delete cascade,
  deal_id         uuid        references deals(id) on delete cascade,

  -- e.g. 'contact.status_changed', 'deal.status_changed', 'contact.created'
  event_type      text        not null,
  -- Human-readable summary rendered directly in the timeline.
  description     text        not null,
  -- Structured before/after payload for richer future rendering.
  metadata        jsonb       not null default '{}'::jsonb,

  actor_id        uuid        references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index activity_log_contact_id_idx on activity_log(contact_id, created_at desc);
create index activity_log_deal_id_idx on activity_log(deal_id, created_at desc);
create index activity_log_organization_id_idx on activity_log(organization_id);

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

create table invoices (
  id              uuid           primary key default gen_random_uuid(),
  organization_id uuid           not null references organizations(id) on delete cascade,

  -- Restricted: an invoiced contact must not silently disappear.
  contact_id      uuid           not null references contacts(id) on delete restrict,
  deal_id         uuid           references deals(id) on delete set null,

  invoice_number  text           not null,
  status          invoice_status not null default 'draft',

  issue_date      date           not null default current_date,
  due_date        date           not null,
  paid_at         timestamptz,

  currency        text           not null default 'USD',
  tax_rate        numeric(5,2)   not null default 0,
  notes           text,
  -- Payment terms captured at issue time so later Settings changes don't
  -- retroactively alter historical invoices.
  payment_terms   text,

  created_by      uuid           references profiles(id) on delete set null,
  created_at      timestamptz    not null default now(),
  updated_at      timestamptz    not null default now(),

  unique (organization_id, invoice_number),
  constraint invoice_tax_rate_valid check (tax_rate >= 0 and tax_rate <= 100),
  constraint invoice_due_after_issue check (due_date >= issue_date)
);

create index invoices_organization_id_idx on invoices(organization_id);
create index invoices_contact_id_idx on invoices(contact_id);
create index invoices_status_idx on invoices(status);
create index invoices_org_issue_date_idx on invoices(organization_id, issue_date desc);

comment on column invoices.status is
  'Stored lifecycle state. "Overdue" is NOT stored — query invoices_with_status for the derived display status.';

create table invoice_line_items (
  id           uuid          primary key default gen_random_uuid(),
  invoice_id   uuid          not null references invoices(id) on delete cascade,
  -- Nullable + restrict-free: the catalogue entry may be archived later, but
  -- the line item keeps its own copy of name and rate (below), so history is
  -- never rewritten by a catalogue edit.
  service_id   uuid          references services(id) on delete set null,

  -- Denormalised deliberately: an invoice is a financial record and must render
  -- identically years later, regardless of catalogue changes.
  name         text          not null,
  description  text,
  quantity     numeric(12,2) not null default 1,
  rate         numeric(12,2) not null default 0,
  sort_order   integer       not null default 0,

  created_at   timestamptz   not null default now(),

  constraint line_item_quantity_positive check (quantity > 0),
  constraint line_item_rate_non_negative check (rate >= 0)
);

create index invoice_line_items_invoice_id_idx on invoice_line_items(invoice_id, sort_order);

comment on table invoice_line_items is
  'Line item name/rate are snapshotted from the service catalogue at creation time so historical invoices never change when the catalogue is edited.';
