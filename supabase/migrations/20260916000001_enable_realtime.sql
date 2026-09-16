-- ============================================================================
-- Orbit Works CRM — Enable Realtime
-- ============================================================================
-- Technical spec: "Supabase Realtime for live dashboard metric updates.
-- Contacts list refreshes on new lead from website form."
--
-- Realtime broadcasts row changes over a websocket. Two things are required:
--   1. the table must belong to the `supabase_realtime` publication;
--   2. the subscriber must pass RLS — Realtime enforces the same policies as a
--      normal query, so a sales user is only notified about rows they could
--      already read. No extra policies are needed here, and none are added.
--
-- Only the three tables that drive live views are published. Publishing
-- everything would put invoice and settings traffic on the wire for users who
-- cannot read it — wasted bandwidth, and a needlessly large surface.
-- ============================================================================

-- `add table` errors if the table is already a member, so each is guarded.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'contacts'
  ) then
    alter publication supabase_realtime add table contacts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'deals'
  ) then
    alter publication supabase_realtime add table deals;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'notes'
  ) then
    alter publication supabase_realtime add table notes;
  end if;
end $$;

-- REPLICA IDENTITY FULL makes the old row available on UPDATE and DELETE.
-- Without it Postgres sends only the primary key, so a subscriber cannot tell
-- which columns changed — and RLS on an UPDATE event cannot be evaluated
-- against the previous values.
alter table contacts replica identity full;
alter table deals    replica identity full;
alter table notes    replica identity full;

comment on table contacts is
  'Leads and customers. Published to supabase_realtime so the contacts list and dashboard refresh when a website lead arrives.';
