-- ============================================================================
-- Orbit Works CRM — Functions, Triggers, and Derived Views
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Auth helpers used by RLS policies.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER + a locked search_path lets policies read the caller's
-- profile without recursing into profiles' own RLS policy.
-- STABLE allows the planner to cache the result within a statement.

create or replace function current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from profiles where id = auth.uid() and is_active
$$;

comment on function current_org_id is
  'Organization of the authenticated caller. Returns NULL for deactivated users, which makes every org-scoped RLS policy fail closed.';

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and is_active
  )
$$;

comment on function is_admin is
  'True when the caller is an active admin. Deactivated admins lose access immediately.';

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on organizations
  for each row execute function set_updated_at();
create trigger profiles_set_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger services_set_updated_at before update on services
  for each row execute function set_updated_at();
create trigger contacts_set_updated_at before update on contacts
  for each row execute function set_updated_at();
create trigger deals_set_updated_at before update on deals
  for each row execute function set_updated_at();
create trigger notes_set_updated_at before update on notes
  for each row execute function set_updated_at();
create trigger invoices_set_updated_at before update on invoices
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- contacts.created_at is immutable (brief §02: "Cannot be edited").
-- ---------------------------------------------------------------------------

create or replace function freeze_created_at()
returns trigger
language plpgsql
as $$
begin
  -- Silently restore rather than raise: a client sending a full-row update
  -- should not fail, it should simply be unable to move this column.
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger contacts_freeze_created_at before update on contacts
  for each row execute function freeze_created_at();

-- ---------------------------------------------------------------------------
-- Deal close tracking — keeps closed_at consistent with status automatically.
-- ---------------------------------------------------------------------------

create or replace function sync_deal_closed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('won', 'lost') then
    -- Stamp only on transition, so re-saving a won deal doesn't move revenue
    -- into the current reporting period.
    if old.status is distinct from new.status or new.closed_at is null then
      new.closed_at := coalesce(new.closed_at, now());
    end if;
  else
    -- Reopening a deal removes it from closed-period revenue.
    new.closed_at := null;
  end if;
  return new;
end;
$$;

create trigger deals_sync_closed_at before insert or update on deals
  for each row execute function sync_deal_closed_at();

-- ---------------------------------------------------------------------------
-- Invoice numbering — sequential per organization, gap-free, race-safe.
-- ---------------------------------------------------------------------------

create or replace function next_invoice_number(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_number integer;
begin
  -- UPDATE ... RETURNING takes a row lock, so concurrent invoice creation
  -- serialises here rather than producing duplicate numbers.
  update organizations
     set invoice_prefix     = invoice_prefix,
         invoice_next_number = invoice_next_number + 1
   where id = p_organization_id
  returning invoice_prefix, invoice_next_number - 1
    into v_prefix, v_number;

  if v_number is null then
    raise exception 'Organization % not found', p_organization_id;
  end if;

  return v_prefix || '-' || lpad(v_number::text, 4, '0');
end;
$$;

comment on function next_invoice_number is
  'Allocates the next invoice number (e.g. INV-0001) under a row lock. Call inside the same transaction as the invoice INSERT.';

-- ---------------------------------------------------------------------------
-- Derived invoice status — "overdue" is computed, never stored.
-- ---------------------------------------------------------------------------

create or replace view invoices_with_status
with (security_invoker = true)
as
select
  i.*,
  case
    when i.status = 'sent' and i.due_date < current_date then 'overdue'
    else i.status::text
  end as display_status,
  coalesce(li.subtotal, 0)                                   as subtotal,
  round(coalesce(li.subtotal, 0) * i.tax_rate / 100, 2)      as tax_amount,
  round(coalesce(li.subtotal, 0) * (1 + i.tax_rate / 100), 2) as total
from invoices i
left join lateral (
  select sum(quantity * rate) as subtotal
  from invoice_line_items
  where invoice_id = i.id
) li on true;

comment on view invoices_with_status is
  'Invoices with derived display_status (adds "overdue") and computed money totals. security_invoker=true means the caller''s RLS on invoices still applies.';

-- ---------------------------------------------------------------------------
-- Automatic activity logging for status changes (brief §08: activity history).
-- ---------------------------------------------------------------------------

create or replace function log_contact_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_name text;
  v_new_name text;
begin
  if old.lead_status_id is distinct from new.lead_status_id then
    select name into v_old_name from lead_statuses where id = old.lead_status_id;
    select name into v_new_name from lead_statuses where id = new.lead_status_id;

    insert into activity_log (organization_id, contact_id, event_type, description, metadata, actor_id)
    values (
      new.organization_id,
      new.id,
      'contact.status_changed',
      format('Status changed from %s to %s',
             coalesce(v_old_name, 'none'), coalesce(v_new_name, 'none')),
      jsonb_build_object(
        'from_status_id', old.lead_status_id,
        'to_status_id',   new.lead_status_id,
        'from_status',    v_old_name,
        'to_status',      v_new_name
      ),
      auth.uid()
    );
  end if;
  return new;
end;
$$;

create trigger contacts_log_status_change after update on contacts
  for each row execute function log_contact_status_change();

create or replace function log_deal_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into activity_log (organization_id, contact_id, deal_id, event_type, description, metadata, actor_id)
    values (
      new.organization_id,
      new.contact_id,
      new.id,
      'deal.status_changed',
      format('Deal "%s" moved from %s to %s', new.title, old.status, new.status),
      jsonb_build_object('from_status', old.status, 'to_status', new.status),
      auth.uid()
    );
  end if;
  return new;
end;
$$;

create trigger deals_log_status_change after update on deals
  for each row execute function log_deal_status_change();

-- ---------------------------------------------------------------------------
-- New auth user → profile.
-- ---------------------------------------------------------------------------
-- Invited users arrive via Supabase Auth. The invite carries organization_id,
-- full_name, and role in raw_user_meta_data; this trigger materialises the
-- matching profile row so the app never has a user without a profile.

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  v_org_id := nullif(new.raw_user_meta_data ->> 'organization_id', '')::uuid;

  -- Fallback for the very first user (bootstrap) when only one org exists.
  if v_org_id is null then
    select id into v_org_id from organizations order by created_at limit 1;
  end if;

  if v_org_id is null then
    raise exception 'Cannot create profile: no organization available';
  end if;

  insert into profiles (id, organization_id, full_name, email, role)
  values (
    new.id,
    v_org_id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'sales')::user_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_auth_user();
