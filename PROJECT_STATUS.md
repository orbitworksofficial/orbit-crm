# Orbit Works CRM — Project Status

Living status file. **Update it as part of the same change it describes**, not afterwards —
a status file that lags the code is worse than none, because it is trusted and wrong.

Last verified against the live database: **2026-10-07**

---

## What this is

A custom CRM for Orbit Works (digital agency, Dubai) replacing spreadsheet-based
lead and invoice tracking. Built from `OrbitWorks_CRM_Phase1_Brief.pdf`.

- **Live:** https://crm.orb-itworks.com (Vercel)
- **Database:** Supabase (Postgres + Auth + Storage + Realtime)
- **Stack:** Next.js 16.3.1 App Router, React 19.2.8, TypeScript, Tailwind v4

---

## Architecture decisions that constrain everything else

Read these before proposing changes — each was a deliberate choice with a cost.

**RLS is the security boundary, not the UI.** `current_org_id()` returns NULL for a
signed-out or deactivated user, so every policy fails closed by construction. The
middleware is a routing convenience; bypassing it still returns zero rows. Never
"fix" an empty-data bug by loosening a policy.

**Derived state is never stored.** Invoice `overdue` and proposal `expired` are
computed in views (`invoices_with_status`, `proposals_with_status`). A stored flag
would need a cron job to stay true and would be wrong between runs.

**Lookup tables, not Postgres enums,** for anything a user can edit (lead sources,
statuses, pipeline stages). Enums need a migration to add a value. `is_won`/`is_lost`
boolean flags carry the meaning, so renaming "Closed Won" cannot break metrics.

**Slugs are the machine contract.** Display names are editable; slugs are not. The
chatbot and website form post `slug`, so renaming a label in Settings never breaks
intake.

**`organization_id` on all tables** — single org today, but multi-tenancy without it
later would mean backfilling every table and rewriting every policy.

---

## Built and working

### Phase 1 — complete
- **Auth** — email/password, password reset, idle-timeout session expiry
- **User management** — admin creates users, sets any password; users set their own
- **Contacts** — CRUD, lead source/status, services, notes, activity timeline
- **Deals** — CRUD, line items, won/lost tracking
- **Invoices** — CRUD, line items, auto-numbering (`next_invoice_number()`),
  computed overdue status, branding/logo upload
- **Reports** — CSV export for leads, revenue, services
- **Dashboard** — real SVG charts (trend, funnel, column, bar list, stat tiles)
- **Settings** — org profile, services, lead sources/statuses, branding
- **Realtime** — Supabase publication enabled, `REPLICA IDENTITY FULL`

### Phase 2 — delivered so far
- **Pipeline (Kanban)** — drag-and-drop board, `sync_deal_stage_status` trigger keeps
  deal status and stage from drifting apart
- **Tasks & reminders** — `pending_reminders` view, sidebar due-count badge
- **Documents** — private Supabase Storage bucket, per-org paths
- **Proposals & quotes** — line items, auto-numbering, computed expiry
- **Lead scoring** — `lead_scores` view, admin-tunable `scoring_weights`
- **Subscriptions / retainers** — recurring billing, `advance_subscription_billing()`
- **Client portal** — separate login at `/portal`, clients see only their own
  invoices and projects; `portal_signup_guard` migration stops a portal signup
  from creating a staff profile
- **Ad platform settings** — AES-256-GCM encrypted credential storage (UI only;
  no API calls yet)
- **AI chatbot lead capture** — chatbot POSTs to `/api/leads` with
  `"source": "ai_chatbot"`
- **Meta integration (two-way)** — see its own section below

---

## Current live data

| Table | Rows | | Table | Rows |
|---|---|---|---|---|
| organizations | 1 | | services | 13 |
| profiles | 3 | | lead_sources | 9 |
| contacts | 16 | | lead_statuses | 7 |
| deals | 8 | | pipeline_stages | 6 |
| invoices | 6 | | proposals | 0 |
| subscriptions | 0 | | tasks | 0 |
| portal_users | 0 | | documents | 0 |

**Pipeline:** New → Qualified → Proposal Sent → Negotiation → Closed Won → Closed Lost

**Lead sources:** `website_form`, `google_ads`, `meta_ads`, `linkedin`, `referral`,
`cold_outreach`, `other`, `ai_chatbot`, `meta_lead_ads`

`meta_ads` and `meta_lead_ads` are deliberately separate: the first is a click-through
to our site, the second a form completed inside Facebook or Instagram. They convert
differently.

**Services (the real Orbit Works catalogue):** Web Design, Web Development,
E-Commerce Development, Custom Software, AI Chatbot Development, SEO,
Google Ads Management, Meta Ads Management, Social Media Management,
Content Marketing, Email Marketing, Marketing Automation, Branding and Identity

The zero-row tables are built and working, just unused — proposals, tasks,
subscriptions, portal users and documents have had no real data entered yet.

---

## Blocked / not started

| Feature | Blocked on |
|---|---|
| **Email sync** (Gmail/Outlook threads on contacts) | OAuth app approval |
| **WhatsApp integration** | Meta Business verification |
| **Google / LinkedIn Ads APIs** | Their own app reviews. Credential storage exists; no API client written. |

These are external approvals, not code problems.

---

## Meta integration — built, awaiting Meta's approval

All three halves are written and verified. What is missing is Meta's permission,
not code.

### How it is wired

**Leads in.** Meta POSTs to `/api/meta/webhook`. That delivery carries only a
`leadgen_id`, so the route fetches the answers with a second Graph call, then
goes through the same `createInboundContact` path as the website form and the
chatbot. Signed with `X-Hub-Signature-256`; an unsigned delivery is refused.

**Analytics in.** *Sync spend* in Settings pulls `/insights` at ad grain into
`ad_spend`. The dashboard shows spend, cost per lead and ROAS per campaign, plus
a Meta funnel from impressions to won.

**Feedback out.** Changing a contact to a won or lost status sends Meta a
`Qualified` or `Disqualified` event, so it optimises for lead quality rather than
volume. Quality signals only — no monetary values.

### Dynamic form fields

Meta Lead Ads forms are edited per campaign, so their questions cannot be known
ahead of time. `contacts.custom_fields` (jsonb) stores whatever arrives and the
contact page renders it as a "Form responses" card. Nothing is dropped: Meta
deletes lead data after 90 days, so a field discarded at import is gone for good.
There is no field-mapping table — add one only if someone needs to filter or
report on a specific answer.

### Configuration lives in Settings, not env

Everything is entered in the Meta card on `/settings`: ad account, ads token,
page id, app id, app secret, pixel id, Conversions API token. The webhook verify
token is generated by the CRM for the user to paste into Meta, and the callback
URL is derived from the request host. Blank secret fields mean "keep the stored
value", so changing one id does not require re-pasting three tokens.

### What Meta still has to approve

| Capability | Needs |
|---|---|
| Lead retrieval, insights | App Review + Business Verification: `ads_management`, `leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads` |
| Lead-quality feedback | **Nothing.** Works as soon as a pixel id and Conversions API token are entered. |

Note the ordering trap: Meta only unlocks the *Request advanced access* button
after at least one successful call per permission, so the integration has to
exist and run in Development Mode before review can be requested. It does.

### Known limitations

1. **Delivery is webhook-only — no automatic recovery.** A failed import writes
   to the credential's `last_error`, which surfaces on the Settings card, and
   *Backfill leads* re-fetches anything missed. But noticing is manual.
2. **ROAS joins on the campaign name.** Lead Ads have no click-through and so no
   real UTM parameters; both sides derive the key through `campaignKey`.
   Renaming a campaign in Meta splits its history. `contacts.meta_ad_id ->
   ad_spend.ad_id` is the stable fix and both columns already exist.
3. **Spend syncing is manual** (no cron on this plan), so the dashboard labels
   it "Ad spend as of <time>".
4. **Meta receives no revenue figures**, by choice, so its value-based
   optimisation is unused.

---

## Action items outstanding

1. **`CREDENTIALS_ENCRYPTION_KEY` is not set on Vercel.** The Integrations page shows
   a warning and refuses to store credentials until it is. Read via
   `process.env` in `src/lib/crypto.ts`, deliberately *not* in `src/lib/env.ts`
   so the whole app does not fail to boot when only one page needs it.
2. **Rotate the keys pasted into chat transcripts** — Supabase service role, OpenAI,
   Groq, Resend, LinkedIn Ads secret.
3. **Wire the chatbot's own code** to POST to `/api/leads`. The CRM side is done and
   verified; the chatbot at `127.0.0.1:18000` has not been changed.
4. **Start Meta Business Verification** — it gates lead retrieval and insights and is
   the slowest step. The Conversions API half needs none of it and can go live now.
5. **The demo admin password is `DemoAdmin123!`** (`admin-demo@orbit.com`). It was reset
   during verification; the original could not be preserved, since passwords are hashed.
6. **Supabase free tier pauses after 7 days idle** — this already caused one outage
   (2026-10-06, login failed). Real risk for a client-facing CRM; a paid tier or a
   keepalive ping is the fix.

---

## Environment variables

Validated in `src/lib/env.ts` (app will not boot without these):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `LEAD_INTAKE_SECRET`, `SESSION_IDLE_TIMEOUT_MINUTES`

Read directly from `process.env` (feature-scoped, absence degrades one page):
`CREDENTIALS_ENCRYPTION_KEY`

---

## Migrations

All 18 applied to the live database.

| File | Adds |
|---|---|
| `20260817000001_core_schema` | 13 core tables |
| `20260817000002_functions_and_views` | triggers, `invoices_with_status`, `next_invoice_number()` |
| `20260817000003_rls_policies` | 44 org-scoped policies |
| `20260817000004_storage` | public branding bucket |
| `20260916000001_enable_realtime` | publication + `REPLICA IDENTITY FULL` |
| `20260916000002_pipeline_stages` | Kanban + `sync_deal_stage_status` |
| `20260916000003_tasks` | tasks + `pending_reminders` view |
| `20260916000004_documents` | private documents bucket |
| `20260916000005_proposals` | `proposals_with_status`, `next_proposal_number()` |
| `20260916000006_ad_credentials` | encrypted credentials + `ad_spend` |
| `20260916000007_lead_scoring` | `lead_scores` view, `scoring_weights` |
| `20260917000001_subscriptions` | retainers, `advance_subscription_billing()` |
| `20260922000001_client_portal` | `portal_users`, `portal_contact_id()` |
| `20260922000002_portal_signup_guard` | stops clients getting staff profiles |
| `20261006000001_chatbot_source` | `ai_chatbot` lead source |
| `20261007000001_meta_lead_ads` | `contacts.custom_fields` + Meta ids, `meta_lead_ads` source |
| `20261007000002_meta_credentials` | Meta secrets/config on `ad_credentials`, `meta_conversion_events` |
| `20261007000003_ad_spend_grain` | ad-set/ad grain on `ad_spend`, generated `grain_key` |
