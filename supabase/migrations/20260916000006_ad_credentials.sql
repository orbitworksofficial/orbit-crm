-- ============================================================================
-- Orbit Works CRM — Phase 2 groundwork: Ad Platform Credentials
-- ============================================================================
-- Storage for the Meta / Google / LinkedIn Ads API credentials that the ad
-- integration will use. Configured in Settings rather than environment
-- variables for two reasons:
--
--   1. Tokens expire and need rotating. From Settings that is paste-and-save;
--      as an env var it is a Vercel visit and a redeploy every time.
--   2. Phase 2 multi-tenancy. Each customer connects their OWN ad accounts,
--      which one value per deployment physically cannot express.
--
-- The trade-off is that a database leak would otherwise expose live tokens, so
-- `access_token` holds AES-256-GCM ciphertext, encrypted in the application
-- with a key that lives in the environment and never touches Postgres. A
-- stolen dump is useless without it. See src/lib/crypto.ts.
-- ============================================================================

create type ad_platform as enum ('meta', 'google', 'linkedin');

create table ad_credentials (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,

  platform        ad_platform not null,

  -- Ciphertext, never plaintext. Format is "v1.<iv>.<tag>.<data>".
  access_token    text        not null,
  -- Google needs a refresh token to mint access tokens; the others do not.
  refresh_token   text,

  -- Which ad account to pull. Not secret — it appears in the platform's own UI
  -- — so it is stored in the clear and can be shown back to the user.
  account_id      text        not null,

  -- Last four characters of the token, for display. Kept so listing
  -- credentials never has to decrypt anything.
  token_hint      text        not null,

  -- Bookkeeping for the sync job that will consume these.
  is_active       boolean     not null default true,
  last_synced_at  timestamptz,
  last_error      text,
  expires_at      timestamptz,

  created_by      uuid        references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- One credential per platform per organization. Reconnecting replaces rather
  -- than accumulating stale tokens.
  unique (organization_id, platform),
  constraint ad_credential_account_not_blank check (length(trim(account_id)) > 0)
);

create index ad_credentials_organization_id_idx on ad_credentials(organization_id);

comment on table ad_credentials is
  'Ad platform API credentials. access_token and refresh_token hold AES-256-GCM ciphertext encrypted in the application; the key lives in the environment, never in this database.';
comment on column ad_credentials.token_hint is
  'Last four characters, for display. Avoids decrypting merely to list what is configured.';
comment on column ad_credentials.account_id is
  'Ad account identifier. Not secret — visible in the platform UI — so stored in the clear.';

create trigger ad_credentials_set_updated_at before update on ad_credentials
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — admin only, in both directions.
-- ---------------------------------------------------------------------------
-- These are billing-adjacent secrets. A sales user has no reason to read them
-- even in encrypted form, and SELECT is restricted accordingly rather than
-- relying on the ciphertext as the only protection.

alter table ad_credentials enable row level security;

create policy ad_credentials_select on ad_credentials
  for select using (organization_id = current_org_id() and is_admin());

create policy ad_credentials_write on ad_credentials
  for all using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id() and is_admin());

-- ---------------------------------------------------------------------------
-- Daily ad spend — the table the sync job will populate.
-- ---------------------------------------------------------------------------
-- Created now, empty, so the schema is settled before the integration is
-- written and the dashboard can be built against a real shape.
--
-- Spend is stored per campaign per day: the finest grain every platform
-- reliably reports, and the grain a "cost per lead this month" query needs.

create table ad_spend (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,

  platform        ad_platform not null,
  spend_date      date        not null,

  -- The platform's own campaign id, plus its name at sync time. Both are kept:
  -- the id is stable, the name is what a human recognises, and campaigns get
  -- renamed.
  campaign_id     text        not null,
  campaign_name   text        not null,

  -- Matching key against contacts.utm_campaign. Populated by the sync job from
  -- the campaign name, and the join that makes ROAS possible.
  utm_campaign    text,

  spend           numeric(12,2) not null default 0,
  impressions     bigint      not null default 0,
  clicks          bigint      not null default 0,
  -- The platform's own conversion count, kept alongside the CRM's own lead
  -- count rather than replacing it — they measure different things and
  -- disagreeing is informative.
  platform_conversions integer not null default 0,

  synced_at       timestamptz not null default now(),

  -- Re-syncing a day must overwrite rather than duplicate.
  unique (organization_id, platform, campaign_id, spend_date),
  constraint ad_spend_non_negative check (spend >= 0 and impressions >= 0 and clicks >= 0)
);

create index ad_spend_org_date_idx on ad_spend(organization_id, spend_date desc);
create index ad_spend_campaign_idx on ad_spend(organization_id, utm_campaign)
  where utm_campaign is not null;

comment on table ad_spend is
  'Daily spend per campaign, pulled from the ad platforms. Joins to contacts via utm_campaign, which is what turns lead counts into cost-per-lead and ROAS.';
comment on column ad_spend.platform_conversions is
  'The platform''s own conversion count. Kept beside the CRM lead count rather than replacing it — they measure different things, and a discrepancy is worth seeing.';

alter table ad_spend enable row level security;

-- Spend figures are readable by anyone who can see the reports they feed, but
-- only the sync job (service role) and admins write them.
create policy ad_spend_select on ad_spend
  for select using (organization_id = current_org_id());

create policy ad_spend_write on ad_spend
  for all using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id() and is_admin());
