# Database workflow

How schema changes get from your machine to the live database.

The short version: **you never edit the live database by hand.** You write a
migration file, run one command, and the CLI applies it. Every environment ends
up with the same schema because they all replay the same ordered files.

---

## One-time setup

```bash
npx supabase login          # opens a browser, paste the token back
npm run db:link             # connects this repo to the hosted project
```

`db:link` asks for your **database password** — the one you set when creating
the project (not an API key). Forgotten it? Reset at
**Dashboard → Settings → Database → Reset database password**.

You only do this once per machine.

---

## The everyday loop

### Applying what already exists

```bash
npm run db:push
```

Reads `supabase/migrations/`, compares against what the live database has
already run, and applies **only the new ones, in order**. Running it twice is
safe — the second run does nothing.

This is the command for a fresh project too. It applies all four migrations in
sequence.

To include the reference data (organization, lead sources, statuses, services):

```bash
npm run db:seed
```

### Changing the schema

**1. Create a migration**

```bash
npm run db:new add_deal_priority
```

Creates `supabase/migrations/<timestamp>_add_deal_priority.sql`, empty.

**2. Write the change**

```sql
alter table deals
  add column priority text not null default 'normal';

comment on column deals.priority is
  'Triage hint for the pipeline view. Not a workflow state.';
```

**3. Push it**

```bash
npm run db:push
```

**4. Regenerate the TypeScript types**

```bash
npm run db:types
```

This rewrites `src/lib/supabase/database.types.ts` from the live schema, so
TypeScript knows about the new column immediately. Any code that needs updating
now fails typecheck instead of failing in production.

**5. Commit the migration and the types together.** They are one change.

---

## Checking state

```bash
npm run db:status     # which migrations have run, local vs remote
npm run db:diff       # what the live DB has that your files don't
```

`db:diff` is the drift detector. It should print nothing. If it prints SQL,
somebody changed the live database by hand — through the dashboard's table
editor, most likely. Capture that change into a migration file before it gets
overwritten or forgotten:

```bash
npm run db:diff > supabase/migrations/<timestamp>_capture_drift.sql
```

Then review the file before committing — `db:diff` output usually needs
tidying.

---

## Command reference

| Command | Does |
|---|---|
| `npm run db:push` | Apply pending migrations to the live database |
| `npm run db:seed` | Apply migrations **and** re-run `seed.sql` |
| `npm run db:new <name>` | Create an empty timestamped migration |
| `npm run db:status` | List which migrations have run |
| `npm run db:diff` | Show live-vs-files drift |
| `npm run db:types` | Regenerate TypeScript types from the live schema |
| `npm run db:link` | Connect the repo to the hosted project (once) |

---

## Rules worth keeping

**Never edit an applied migration.** Once a file has run against the live
database, its contents are history. Editing it means your files and the database
disagree, and the CLI has no way to notice. Write a new migration instead.

**Never change the schema through the dashboard.** The table editor is
convenient and it is how drift starts. Use it to *look* at data, not to alter
structure.

**One logical change per migration.** "Add deal priority" is a migration.
"Add deal priority, rename two columns, and drop an index" is three.

**Migrations run in filename order**, which is why they are timestamped.
`db:new` handles this; don't rename files by hand.

---

## Backups before risky changes

The free tier keeps daily backups for 7 days
(**Dashboard → Database → Backups**). Before anything destructive — dropping a
column, changing a type, deleting rows — take a manual snapshot first:

```bash
npx supabase db dump --linked -f backup-$(date +%Y%m%d).sql
```

Postgres cannot undo a `DROP COLUMN`. The data is simply gone.

---

## Deploying

Vercel does **not** run migrations. Deploying the app and migrating the database
are separate acts, and the order matters:

1. `npm run db:push` — schema first
2. `git push` — Vercel builds and deploys the app

Schema-first means the new code never arrives before the columns it expects.
For a change that removes something, invert it: deploy code that no longer uses
the column, *then* drop it.

---

## Troubleshooting

**"Cannot find project ref"** — run `npm run db:link`.

**"Password authentication failed"** — that is the database password, not an
API key. Reset it in Settings → Database.

**"Migration already applied"** — the file already ran. If you edited it after
the fact, that is the problem; write a new migration.

**Push fails halfway** — Postgres runs each migration in a transaction, so a
failed file rolls back completely. Fix the SQL and push again. Files that
already succeeded are not re-run.
