-- ============================================================================
-- Orbit Works CRM — Phase 2: Meta Lead Ads
-- ============================================================================
-- Brief: "Leads captured by Meta Lead Ads auto-populate contacts."
--
-- A Meta Lead Ads form is filled in INSIDE Facebook or Instagram — the person
-- never visits our site. That has two consequences this migration exists to
-- handle.
--
-- First, the form's questions are written by whoever builds the campaign, and
-- they change per campaign. There is no fixed set of columns to map them onto,
-- so `custom_fields` keeps whatever Meta sends, verbatim. Nothing is discarded:
-- Meta permanently deletes lead data 90 days after submission, so a field we
-- failed to store is not recoverable later.
--
-- Second, because there is no click-through, there are no UTM parameters. The
-- only attribution Meta gives us is the ad and campaign the lead came from,
-- which is why the Meta identifiers below are first-class columns rather than
-- being buried in `custom_fields`.
-- ============================================================================

alter table contacts
  -- Whatever the source form sent, as label/value pairs. Not Meta-specific by
  -- name because any future intake with user-defined questions belongs here too.
  add column custom_fields  jsonb not null default '{}'::jsonb,

  -- Meta's own lead id (15-17 digits). Required by the Conversions API for CRM
  -- to attribute lead-quality feedback back to the originating ad, so without
  -- it the outbound half of the integration cannot work at all.
  add column meta_lead_id   text,

  add column meta_form_id   text,
  -- The form's name at capture time. Kept alongside the id because the id is
  -- stable but meaningless to a human, and forms get renamed.
  add column meta_form_name text,

  -- The stable join key against ad_spend.ad_id. Campaign-name matching breaks
  -- when a campaign is renamed; this does not.
  add column meta_ad_id     text,

  -- Meta's timestamp, not ours. The Conversions API only accepts feedback
  -- within 28 days of lead creation, and that window is measured from here —
  -- a lead backfilled a week late must not appear to have 28 fresh days.
  add column meta_created_at timestamptz;

-- Idempotency key for every inbound path. Meta retries webhook deliveries
-- aggressively, and the Backfill button deliberately re-walks leads that were
-- already imported; both rely on a duplicate insert failing rather than
-- creating a second contact for the same person.
--
-- Partial, so the ~all contacts that have no Meta lead id stay unconstrained.
create unique index contacts_meta_lead_id_key
  on contacts(organization_id, meta_lead_id)
  where meta_lead_id is not null;

create index contacts_meta_ad_id_idx
  on contacts(organization_id, meta_ad_id)
  where meta_ad_id is not null;

comment on column contacts.custom_fields is
  'Answers to questions the CRM does not have columns for, as label/value pairs. Meta Lead Ads forms are edited per campaign, so their field names cannot be known at migration time.';
comment on column contacts.meta_lead_id is
  'Meta leadgen_id. Required by the Conversions API for CRM to attribute lead-quality feedback, and the idempotency key for webhook and backfill imports.';
comment on column contacts.meta_created_at is
  'Meta''s own lead creation time. The 28-day Conversions API feedback window is measured from this, never from contacts.created_at.';

-- ----------------------------------------------------------------------------
-- Lead source
-- ----------------------------------------------------------------------------
-- Deliberately distinct from the existing `meta_ads` source. That one means
-- "clicked a Meta ad and landed on our website"; this means "completed a form
-- without ever leaving Facebook". They convert differently, so collapsing them
-- into one source would hide the difference exactly where it matters.
insert into lead_sources (organization_id, name, slug, sort_order)
select
  id,
  'Meta Lead Ads',
  -- The slug is the contract: the webhook resolves the source by it, so
  -- renaming the display label in Settings must never break intake.
  'meta_lead_ads',
  9
from organizations
on conflict (organization_id, slug) do nothing;

-- No RLS changes: the contacts policies are column-agnostic, so the new
-- columns inherit the existing org scoping unchanged.
