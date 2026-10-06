<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Orbit Works CRM

**Read `PROJECT_STATUS.md` first, before doing anything else.** It holds what is built,
what is in progress, what is blocked, and the current live data. Update it in the same
change that makes it out of date.

Live: https://crm.orb-itworks.com · Supabase (Postgres/Auth/Storage/Realtime) · Vercel

## How this project is worked on

One feature at a time. Build it, report, wait for the user to check it, then move on.
Do not batch several features into one change.

**Verify against the live database before claiming a feature works.** Not against the
types, not against the code reading correctly — query the actual rows. This has caught
real bugs every time it was done: a portal signup trigger that would have given clients
full staff access, and an idle-timeout fix that silently disabled the timeout entirely.
Delete test records afterwards and confirm they are gone.

Migrations are applied directly to the live Supabase database, in order, as part of the
feature that needs them.

## Traps already hit here — do not re-learn these

**supabase-js types:** row types must be `type` aliases, never `interface`. Interfaces
lack an implicit index signature and fail the `Record<string, unknown>` constraint.
`Relationships` arrays must declare the real foreign keys or embedded selects fail at
runtime with "could not find the relation". `src/lib/supabase/database.types.ts` is
hand-maintained.

**Never key session freshness off `last_sign_in_at`.** Supabase updates it on every
token refresh, so an idle timeout built on it never fires. Use the token `iat` claim.
The bug was invisible until the feature was tested for still *firing*, not just for
not false-positiving.

**A dev-server 404 on a route that exists on disk is a stale route table.** Check the
compiled artifact in `.next/dev/server/app/.../route.js` before touching the code. Fix
by stopping the server, `rm -rf .next/dev`, restarting.

**Charts mean SVG.** Div-based progress bars are not charts. If asked for a graph,
build real marks and verify by counting the rendered elements.

**Vercel region must stay pinned to `sin1`** (`vercel.json`) to co-locate with Supabase.
Unpinned, the functions ran in Washington against a Singapore database: 4–5s per click,
down to ~0.4s once pinned.

**Supabase free tier pauses after ~7 days idle.** When the API returns nothing for
every table, check whether the project is `INACTIVE` before concluding the data is gone.

## Conventions

- Slugs are the machine contract; display names are editable. Never match on a label.
- Derived state lives in views, never in a stored column.
- RLS is the security boundary. An empty result is usually correct behaviour, not a bug
  to be fixed by loosening a policy.
- Comments explain *why*, not *what*. Match the density of the surrounding file.
