-- ============================================================================
-- Orbit Works CRM — Phase 2: ad spend at ad-set and ad grain
-- ============================================================================
-- `ad_spend` was created one row per campaign per day. That is the right grain
-- for a spend total, but it cannot answer the question Lead Ads actually raises:
-- which *ad* produced the leads that closed. Meta reports insights down to ad
-- level, and the stable join back to a contact is the ad id, so the table needs
-- to carry it.
--
-- The table has no readers yet, so widening the grain now costs nothing. Doing
-- it later would mean rewriting history that had already been summarised.
-- ============================================================================

alter table ad_spend
  add column adset_id   text,
  add column adset_name text,
  add column ad_id      text,
  add column ad_name    text,
  -- The platform's own lead count, kept beside the CRM's. They measure
  -- different things — Meta counts form submissions, the CRM counts contacts
  -- that survived deduplication — and a gap between them is informative rather
  -- than a bug.
  add column platform_leads integer not null default 0;

alter table ad_spend
  add constraint ad_spend_platform_leads_non_negative
  check (platform_leads >= 0);

-- ----------------------------------------------------------------------------
-- Re-keying for the finer grain
-- ----------------------------------------------------------------------------
-- The old key was (organization_id, platform, campaign_id, spend_date), which
-- now collides: one campaign-day holds many ads.
--
-- The obvious replacement — adding adset_id and ad_id to the unique tuple —
-- does not work, because Postgres treats NULLs as distinct in a unique
-- constraint. A campaign-level row (no ad set, no ad) would therefore be
-- insertable without limit, and every re-sync would duplicate it. `unique nulls
-- not distinct` fixes that but needs Postgres 15+.
--
-- Coalescing to '' in a generated column avoids the version question entirely
-- and makes the intent explicit: absent grain is one specific value, not an
-- unknown one. The upsert in the sync job targets this column.
alter table ad_spend
  add column grain_key text
  generated always as (
    coalesce(campaign_id, '') || '|' || coalesce(adset_id, '') || '|' || coalesce(ad_id, '')
  ) stored;

alter table ad_spend
  drop constraint ad_spend_organization_id_platform_campaign_id_spend_date_key;

alter table ad_spend
  add constraint ad_spend_grain_key
  unique (organization_id, platform, spend_date, grain_key);

comment on column ad_spend.grain_key is
  'Generated identity of the reporting row: campaign|adset|ad with absent levels as empty strings. Exists because a unique constraint over nullable id columns would let campaign-level rows duplicate on every re-sync.';
comment on column ad_spend.ad_id is
  'The platform''s ad id. The stable join to contacts.meta_ad_id — campaign-name matching breaks whenever a campaign is renamed.';

create index ad_spend_ad_id_idx
  on ad_spend(organization_id, ad_id)
  where ad_id is not null;
