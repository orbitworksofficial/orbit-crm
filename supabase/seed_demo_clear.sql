-- ============================================================================
-- Orbit Works CRM — Remove Demo Data
-- ============================================================================
--   Run: npm run db:demo:clear
--
-- Removes only what seed_demo.sql created, tracked via demo_data_marker.
-- Real records entered through the app are never touched.
--
-- Reference data (organization, lead sources, statuses, services) is left
-- alone — that is production configuration, not demo data.
-- ============================================================================

do $$
declare
  v_contacts int := 0;
  v_deals    int := 0;
  v_invoices int := 0;
begin

  if to_regclass('public.demo_data_marker') is null then
    raise notice 'No demo_data_marker table — nothing to clear.';
    return;
  end if;

  -- Invoices first: contacts are referenced with ON DELETE RESTRICT, so a
  -- contact carrying an invoice cannot be removed until the invoice is gone.
  -- Line items cascade from the invoice.
  with removed as (
    delete from invoices
     where id in (select record_id from demo_data_marker where table_name = 'invoices')
    returning 1
  )
  select count(*) into v_invoices from removed;

  -- Deals cascade their notes, activity, and service tags.
  with removed as (
    delete from deals
     where id in (select record_id from demo_data_marker where table_name = 'deals')
    returning 1
  )
  select count(*) into v_deals from removed;

  -- Contacts cascade their remaining notes, activity, tags, and any deals not
  -- individually marked.
  with removed as (
    delete from contacts
     where id in (select record_id from demo_data_marker where table_name = 'contacts')
    returning 1
  )
  select count(*) into v_contacts from removed;

  delete from demo_data_marker;

  raise notice 'Removed % contacts, % deals, % invoices.', v_contacts, v_deals, v_invoices;

  -- Reset invoice numbering so the first real invoice is 0001 again. Safe only
  -- because every demo invoice has just been deleted; if any real invoice
  -- exists, resume above its number instead.
  update organizations o
     set invoice_next_number = greatest(
           1,
           coalesce((
             select max(nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::int)
               from invoices i where i.organization_id = o.id
           ), 0) + 1
         );

end $$;

-- Drop the bookkeeping table: with the demo rows gone it has no further use.
-- Re-running seed_demo.sql recreates it.
drop table if exists demo_data_marker;

select 'contacts' as table_name, count(*) from contacts
union all select 'deals', count(*) from deals
union all select 'invoices', count(*) from invoices
union all select 'notes', count(*) from notes
order by table_name;
