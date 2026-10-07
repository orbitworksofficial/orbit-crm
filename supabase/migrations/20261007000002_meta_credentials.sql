-- ============================================================================
-- Orbit Works CRM — Phase 2: Meta credentials and outbound event log
-- ============================================================================
-- `ad_credentials` was built for the simple case: one account id, one access
-- token. Meta needs considerably more, and the extra values are not all the
-- same kind of thing, so they are not all stored the same way.
--
--   * Non-secret identifiers (pixel, page, app id) go in `config` jsonb. They
--     appear in Meta's own UI, so there is nothing to protect, and each ad
--     platform needs a different set — columns would mean a migration per
--     platform and a table of mostly-NULL columns.
--
--   * Secrets get real encrypted columns, NOT jsonb. Keeping ciphertext in a
--     jsonb blob defeats the token_hint pattern and makes it far too easy to
--     select the whole object into a client payload by accident.
--
-- The Conversions API token is separate from the ads token on purpose: it has a
-- different scope and lifetime, and — the practical reason — the Conversions
-- API needs no App Review while lead retrieval does. One has to be usable
-- months before the other, so they cannot share a column.
-- ============================================================================

alter table ad_credentials
  add column config jsonb not null default '{}'::jsonb,

  -- HMAC key for verifying X-Hub-Signature-256 on inbound webhook deliveries.
  -- Without it the webhook has no way to tell Meta's POSTs from anyone else's,
  -- so the route refuses to accept leads rather than trusting unsigned input.
  add column app_secret_encrypted text,

  add column capi_token_encrypted text,
  add column capi_token_hint      text,

  -- See the hash column's comment for why both forms are stored.
  add column webhook_verify_token_encrypted text,
  add column webhook_verify_token_hash      text;

-- Meta's webhook verification request is unauthenticated and carries no
-- organization, page or app identifier — only `hub.verify_token`. The
-- credential therefore has to be findable by the token's own value.
--
-- Storing a SHA-256 hash makes that a single indexed equality lookup. The
-- alternatives are both worse: decrypting every organization's token on each
-- verification attempt, or storing the token in the clear so it can be indexed.
-- The encrypted plaintext is kept only so Settings can redisplay the token for
-- the user to copy into Meta.
create unique index ad_credentials_webhook_verify_token_hash_key
  on ad_credentials(webhook_verify_token_hash)
  where webhook_verify_token_hash is not null;

comment on column ad_credentials.config is
  'Non-secret platform identifiers (Meta: pixel_id, page_id, app_id). Visible in the platform''s own UI, so stored in the clear and shown back to the user. jsonb because each platform needs a different set.';
comment on column ad_credentials.capi_token_encrypted is
  'Conversions API token from Events Manager. A different credential from access_token: the Conversions API needs no App Review, so it is configurable long before lead retrieval is approved.';
comment on column ad_credentials.app_secret_encrypted is
  'Meta App Secret, used as the HMAC key for X-Hub-Signature-256. The webhook rejects deliveries when this is unset rather than accepting unsigned input.';
comment on column ad_credentials.webhook_verify_token_hash is
  'SHA-256 of the verify token. Meta''s unauthenticated verification GET identifies the credential by token value alone, and hashing keeps that a single indexed lookup without storing the token in the clear.';

-- ----------------------------------------------------------------------------
-- Outbound Conversions API event log
-- ----------------------------------------------------------------------------
-- Three jobs, each of which would otherwise be impossible:
--
--   1. Deduplication. A salesperson moving a lead Won -> Lost -> Won must not
--      send three events. The unique constraint below is what stops that.
--   2. Diagnosis. Meta's Conversions API errors are terse and arrive
--      asynchronously; without a log, a silently failing feedback loop looks
--      identical to a working one.
--   3. Answering "did this lead's feedback actually go out?" — including the
--      cases where it deliberately did not, which is what `skipped` records.
--
-- No value or currency columns: this integration sends quality signals only,
-- never monetary amounts.
-- ----------------------------------------------------------------------------

create table meta_conversion_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,
  -- Nulled rather than deleted if the contact goes: the fact that feedback was
  -- sent to Meta remains true, and the log is the only record of it.
  contact_id      uuid        references contacts(id) on delete set null,

  meta_lead_id    text        not null,

  -- 'Qualified' | 'Disqualified'. Text rather than an enum because Meta's
  -- recommended event names are theirs to change, and a migration to add one
  -- would be pure friction.
  event_name      text        not null,

  -- Sent to Meta as `event_id`. Meta keeps only the first copy of a given
  -- (event_id, event_name) pair, so this is simultaneously our idempotency key
  -- and theirs. Derived deterministically from contact id + event name.
  event_id        text        not null,

  status          text        not null default 'pending',
  http_status     integer,
  response        jsonb,
  -- Populated for 'failed' AND for 'skipped', where it holds the reason
  -- nothing was sent. "Outside the 28-day window" is a useful thing to be able
  -- to read back.
  error           text,
  attempts        integer     not null default 0,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),

  unique (organization_id, event_id, event_name),
  constraint meta_conversion_status_known
    check (status in ('pending', 'sent', 'failed', 'skipped'))
);

create index meta_conversion_events_contact_idx
  on meta_conversion_events(contact_id);
create index meta_conversion_events_org_created_idx
  on meta_conversion_events(organization_id, created_at desc);

alter table meta_conversion_events enable row level security;

-- Readable by the whole organization: it is diagnostic, holds no credentials,
-- and a salesperson asking "was this marked good in Meta?" should not need an
-- admin. Writes are admin-only, matching every other ad table.
create policy meta_conversion_events_select on meta_conversion_events
  for select using (organization_id = current_org_id());

create policy meta_conversion_events_write on meta_conversion_events
  for all using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id() and is_admin());
