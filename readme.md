# Orbit Works CRM — Phase 1

A custom CRM for Orbit Works, built on Next.js and Supabase. Contacts, deals,
invoices, dashboards, and reporting, with role-based access enforced in the
database.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
Supabase (Postgres, Auth, Storage) · Vercel

---

## Getting started

### 1. Create a Supabase project

Create a project at [supabase.com](https://supabase.com) (the free tier is
sufficient for Phase 1), then collect three values from **Project Settings → API**:

- Project URL
- `anon` / publishable key
- `service_role` key — **server-side only, never expose this to the browser**

### 2. Configure the environment

```bash
cp .env.example .env.local
```

Fill in the Supabase values, then generate a lead-intake secret:

```bash
openssl rand -base64 32
```

Put the result in `LEAD_INTAKE_SECRET`. The website contact form must send this
same value as the `x-orbit-lead-secret` header. Without it the intake endpoint
rejects every request, so an unset secret fails closed rather than open.

### 3. Apply the database schema

In the Supabase SQL editor, run these in order:

| Order | File | Contents |
|-------|------|----------|
| 1 | `supabase/migrations/0001_core_schema.sql` | Tables, enums, indexes |
| 2 | `supabase/migrations/0002_functions_and_views.sql` | Triggers, helper functions, derived views |
| 3 | `supabase/migrations/0003_rls_policies.sql` | Row Level Security |
| 4 | `supabase/migrations/0004_storage.sql` | Logo storage bucket |
| 5 | `supabase/seed.sql` | Organization, lead sources, statuses, services |

> **Before seeding:** `supabase/seed.sql` contains **13 placeholder services**.
> Replace the `name`, `description`, and `default_rate` values with the real
> Orbit Works catalogue. Keep the `slug` values stable — the website form and
> historical records reference them.

### 4. Create the first admin

Supabase Dashboard → **Authentication → Users → Add user**. The
`handle_new_auth_user` trigger creates the matching profile automatically and
attaches it to the seeded organization.

The first user is created as `sales` by default. Promote them in the SQL editor:

```sql
update profiles set role = 'admin' where email = 'you@orbitworks.com';
```

Every subsequent user can be invited from **Settings → Team** inside the app.

### 5. Run it

```bash
npm install
npm run dev
```

---

## Project structure

```
src/
├── app/
│   ├── (auth)/              Login, forgot password, reset password
│   ├── (app)/               Authenticated application
│   │   ├── dashboard/       Live metrics with date filtering
│   │   ├── contacts/        Leads and customers
│   │   ├── deals/           Opportunities
│   │   ├── invoices/        Billing, PDF export (admin only)
│   │   ├── reports/         Reporting + CSV exports
│   │   └── settings/        Company, catalogue, team (admin only)
│   ├── api/leads/           Public website-form intake
│   └── auth/callback/       Supabase email-link handler
├── components/
│   ├── ui/                  Design-system primitives
│   ├── charts/              Stat tiles and bar lists
│   ├── crm/                 Cross-module CRM components
│   └── pdf/                 Invoice PDF document
├── lib/
│   ├── supabase/            Server, browser, and admin clients + types
│   ├── auth.ts              Session and role helpers
│   ├── metrics.ts           Dashboard and report calculations
│   ├── date-range.ts        Date-range presets
│   └── csv.ts               CSV export
└── middleware.ts            Session refresh, route guards, idle timeout

supabase/
├── migrations/              Schema, functions, RLS, storage
└── seed.sql                 Reference data
```

---

## Access model

Two roles, per the Phase 1 brief:

| | Admin | Sales |
|---|---|---|
| Contacts & deals | All | Own only |
| Invoices | Full access | No access |
| Reports | All data | Own data |
| Settings | Full access | No access |

**Row Level Security is the actual security boundary.** Page-level guards
(`requireAdmin()`) control what the UI offers; the database controls what the
data layer will return. A missing UI check cannot leak data, because every
policy is scoped by `current_org_id()` first — and that function returns `NULL`
for deactivated or unauthenticated callers, so all policies fail closed.

---

## Website form integration

The website contact form POSTs JSON to `/api/leads`:

```bash
curl -X POST https://your-crm.vercel.app/api/leads \
  -H "Content-Type: application/json" \
  -H "x-orbit-lead-secret: $LEAD_INTAKE_SECRET" \
  -d '{
    "full_name": "Jane Doe",
    "email": "jane@example.com",
    "whatsapp_number": "+971501234567",
    "company_name": "Example Ltd",
    "source": "website_form",
    "services": ["web-design", "seo"],
    "message": "Interested in a redesign.",
    "utm_source": "google",
    "utm_campaign": "spring-2026"
  }'
```

**Responses:** `201` with the new contact id · `400` validation failed ·
`401` bad or missing secret · `429` rate limited · `503` secret not configured.

The endpoint is defended by a constant-time secret comparison, per-IP rate
limiting (10 requests/minute), and strict schema validation that drops unknown
fields. Inbound leads arrive unassigned with status `New`, visible to admins for
triage.

`services` are matched by **slug**, not display name, so renaming a service in
Settings never breaks the form.

---

## Deployment (Vercel)

1. Push the repository to GitHub and import it into Vercel.
2. Add all environment variables from `.env.example` under
   **Project Settings → Environment Variables**.
3. Deploy — no build configuration is required.
4. In Supabase → **Authentication → URL Configuration**, add your production
   URL to the redirect allowlist so password-reset links work.

Both free tiers are sufficient for Phase 1: hosting cost is zero.

---

## Built for Phase 2

The brief asks that Phase 2 arrive without a rebuild. These decisions are the
groundwork:

- **`organization_id` on every table**, with all RLS scoped by it. Phase 1 runs
  one organization; multi-tenancy becomes a data concern rather than a
  migration. This is the one thing that genuinely cannot be retrofitted, which
  is why it is present now.
- **Lookup tables, not enums**, for lead sources and statuses — admins rename
  them in Settings without a migration. Metrics read the `is_won` / `is_lost`
  flags rather than matching names, so renaming a status never breaks a report.
- **Attribution columns** (`utm_source`, `utm_medium`, `utm_campaign`,
  `external_ref`) are captured on every contact today, ready for ad-platform
  integration.
- **`deals.closed_at`** is maintained by a trigger, so revenue is reported in
  the period a deal actually closed. A Kanban pipeline can add a `stage_id`
  alongside the coarse `status` without touching existing data.
- **Polymorphic `notes` and `activity_log`** already carry both `contact_id` and
  `deal_id`, so email and WhatsApp sync can log against either.
- **Line items snapshot** their name and rate at creation, so editing the
  catalogue never rewrites a historical invoice.

---

## Notes for review

Three things worth flagging explicitly:

1. **The 13 services are placeholders.** Replace them in `supabase/seed.sql`
   before going live.
2. **Rate limiting is in-memory**, which is per-instance and resets on cold
   start. It is a spam dampener, adequate for Phase 1 traffic. If abuse becomes
   real, move it to Postgres or Upstash — the route's shape does not change.
3. **"Overdue" is computed, never stored.** It is derived in the
   `invoices_with_status` view from `status = 'sent' AND due_date < today`, so
   it can never drift out of sync with the dates.

Full schema documentation, including the reasoning behind each table, is in
[docs/SCHEMA.md](docs/SCHEMA.md).
