-- ============================================================================
-- Orbit Works CRM — Row Level Security
-- ============================================================================
-- Access model (brief §01):
--   Admin — full access to all data within their organization.
--   Sales — access to contacts and deals assigned to them only.
--
-- Every policy is org-scoped FIRST. Because current_org_id() returns NULL for
-- deactivated or unauthenticated callers, and `organization_id = NULL` is never
-- true, all policies fail closed by construction.
--
-- Note: the service-role key bypasses RLS entirely. It is used only by the
-- public lead intake route, which does its own explicit org scoping.
-- ============================================================================

alter table organizations      enable row level security;
alter table profiles           enable row level security;
alter table lead_sources       enable row level security;
alter table lead_statuses      enable row level security;
alter table services           enable row level security;
alter table contacts           enable row level security;
alter table contact_services   enable row level security;
alter table deals              enable row level security;
alter table deal_services      enable row level security;
alter table notes              enable row level security;
alter table activity_log       enable row level security;
alter table invoices           enable row level security;
alter table invoice_line_items enable row level security;

-- ---------------------------------------------------------------------------
-- Organizations — everyone reads their own; only admins may change settings.
-- ---------------------------------------------------------------------------

create policy organizations_select on organizations
  for select using (id = current_org_id());

create policy organizations_update on organizations
  for update using (id = current_org_id() and is_admin())
  with check (id = current_org_id());

-- ---------------------------------------------------------------------------
-- Profiles — all members are visible (needed for "assigned to" pickers);
-- only admins manage them. Users may edit their own name.
-- ---------------------------------------------------------------------------

create policy profiles_select on profiles
  for select using (organization_id = current_org_id());

create policy profiles_insert on profiles
  for insert with check (organization_id = current_org_id() and is_admin());

create policy profiles_update_self on profiles
  for update using (id = auth.uid())
  -- Prevents self-promotion: the row must still match the caller's own id and
  -- org. Role escalation is blocked by the column grant below.
  with check (id = auth.uid() and organization_id = current_org_id());

create policy profiles_update_admin on profiles
  for update using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id());

-- Nobody may move a profile between organizations through the API; that is a
-- data-migration concern, not an application one.
revoke update (organization_id) on profiles from authenticated;

-- Role and activation are managed through the functions below rather than by
-- direct UPDATE. A plain column revoke would also block admins (column
-- privileges are checked before RLS policies), so the privilege stays and these
-- SECURITY DEFINER functions carry the admin check instead.

create or replace function set_user_role(p_user_id uuid, p_role user_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only administrators can change user roles';
  end if;

  -- An admin must not be able to demote themselves and orphan the org.
  if p_user_id = auth.uid() and p_role <> 'admin' then
    raise exception 'You cannot remove your own admin access';
  end if;

  update profiles
     set role = p_role
   where id = p_user_id
     and organization_id = current_org_id();
end;
$$;

create or replace function set_user_active(p_user_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only administrators can activate or deactivate users';
  end if;

  if p_user_id = auth.uid() and not p_is_active then
    raise exception 'You cannot deactivate your own account';
  end if;

  update profiles
     set is_active = p_is_active
   where id = p_user_id
     and organization_id = current_org_id();
end;
$$;

comment on function set_user_role is
  'Admin-only role change. Enforced in the database so the rule holds regardless of which client calls it.';

-- ---------------------------------------------------------------------------
-- Lookup tables — readable by all members, writable by admins.
-- ---------------------------------------------------------------------------

create policy lead_sources_select on lead_sources
  for select using (organization_id = current_org_id());
create policy lead_sources_write on lead_sources
  for all using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id() and is_admin());

create policy lead_statuses_select on lead_statuses
  for select using (organization_id = current_org_id());
create policy lead_statuses_write on lead_statuses
  for all using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id() and is_admin());

create policy services_select on services
  for select using (organization_id = current_org_id());
create policy services_write on services
  for all using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id() and is_admin());

-- ---------------------------------------------------------------------------
-- Contacts — admins see all; sales see only what they own.
-- ---------------------------------------------------------------------------
-- Unassigned contacts (assigned_to IS NULL, e.g. fresh web leads) are visible
-- to admins only, so nothing lands in a shared blind spot.

create policy contacts_select on contacts
  for select using (
    organization_id = current_org_id()
    and (is_admin() or assigned_to = auth.uid())
  );

create policy contacts_insert on contacts
  for insert with check (
    organization_id = current_org_id()
    -- Sales may only create contacts owned by themselves.
    and (is_admin() or assigned_to = auth.uid())
  );

create policy contacts_update on contacts
  for update using (
    organization_id = current_org_id()
    and (is_admin() or assigned_to = auth.uid())
  )
  with check (
    organization_id = current_org_id()
    -- A sales user cannot reassign a contact away from themselves, which would
    -- otherwise let them silently drop records out of their own visibility.
    and (is_admin() or assigned_to = auth.uid())
  );

create policy contacts_delete on contacts
  for delete using (organization_id = current_org_id() and is_admin());

-- Tag tables inherit visibility from their parent row.
create policy contact_services_all on contact_services
  for all using (
    exists (
      select 1 from contacts c
      where c.id = contact_services.contact_id
        and c.organization_id = current_org_id()
        and (is_admin() or c.assigned_to = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from contacts c
      where c.id = contact_services.contact_id
        and c.organization_id = current_org_id()
        and (is_admin() or c.assigned_to = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Deals — same ownership model as contacts.
-- ---------------------------------------------------------------------------

create policy deals_select on deals
  for select using (
    organization_id = current_org_id()
    and (is_admin() or assigned_to = auth.uid())
  );

create policy deals_insert on deals
  for insert with check (
    organization_id = current_org_id()
    and (is_admin() or assigned_to = auth.uid())
  );

create policy deals_update on deals
  for update using (
    organization_id = current_org_id()
    and (is_admin() or assigned_to = auth.uid())
  )
  with check (
    organization_id = current_org_id()
    and (is_admin() or assigned_to = auth.uid())
  );

create policy deals_delete on deals
  for delete using (organization_id = current_org_id() and is_admin());

create policy deal_services_all on deal_services
  for all using (
    exists (
      select 1 from deals d
      where d.id = deal_services.deal_id
        and d.organization_id = current_org_id()
        and (is_admin() or d.assigned_to = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from deals d
      where d.id = deal_services.deal_id
        and d.organization_id = current_org_id()
        and (is_admin() or d.assigned_to = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Notes — visible when the parent record is visible.
-- ---------------------------------------------------------------------------

create policy notes_select on notes
  for select using (
    organization_id = current_org_id()
    and (
      is_admin()
      or exists (
        select 1 from contacts c
        where c.id = notes.contact_id and c.assigned_to = auth.uid()
      )
      or exists (
        select 1 from deals d
        where d.id = notes.deal_id and d.assigned_to = auth.uid()
      )
    )
  );

create policy notes_insert on notes
  for insert with check (
    organization_id = current_org_id()
    and author_id = auth.uid()
    and (
      is_admin()
      or exists (
        select 1 from contacts c
        where c.id = notes.contact_id and c.assigned_to = auth.uid()
      )
      or exists (
        select 1 from deals d
        where d.id = notes.deal_id and d.assigned_to = auth.uid()
      )
    )
  );

-- Notes are an audit trail: authors may edit their own, admins may remove.
create policy notes_update on notes
  for update using (organization_id = current_org_id() and author_id = auth.uid())
  with check (organization_id = current_org_id() and author_id = auth.uid());

create policy notes_delete on notes
  for delete using (
    organization_id = current_org_id()
    and (is_admin() or author_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Activity log — read-only to the application; written by triggers only.
-- ---------------------------------------------------------------------------

create policy activity_log_select on activity_log
  for select using (
    organization_id = current_org_id()
    and (
      is_admin()
      or exists (
        select 1 from contacts c
        where c.id = activity_log.contact_id and c.assigned_to = auth.uid()
      )
      or exists (
        select 1 from deals d
        where d.id = activity_log.deal_id and d.assigned_to = auth.uid()
      )
    )
  );

-- No INSERT/UPDATE/DELETE policies: the log is append-only via SECURITY DEFINER
-- triggers, and unreachable to clients even with a valid session.

-- ---------------------------------------------------------------------------
-- Invoices — admin-only (brief §01: "Admin: full access to ... invoices").
-- ---------------------------------------------------------------------------

create policy invoices_all on invoices
  for all using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id() and is_admin());

create policy invoice_line_items_all on invoice_line_items
  for all using (
    exists (
      select 1 from invoices i
      where i.id = invoice_line_items.invoice_id
        and i.organization_id = current_org_id()
        and is_admin()
    )
  )
  with check (
    exists (
      select 1 from invoices i
      where i.id = invoice_line_items.invoice_id
        and i.organization_id = current_org_id()
        and is_admin()
    )
  );
