-- ============================================================================
-- Orbit Works CRM — Phase 2: Client Portal
-- ============================================================================
-- Brief: "A separate login for clients to view their invoices, project status,
-- and reports."
--
-- This is the first feature that lets people OUTSIDE the company sign in, so
-- the security model matters more here than anywhere else in the CRM.
--
-- The design rule: a client is not a user of the CRM. They get their own table,
-- their own role, and their own policies. Reusing `profiles` with a third role
-- would mean every existing policy that says "is this an active member of the
-- organization" silently starts admitting clients — a change in meaning spread
-- across forty policies, which is how data leaks happen.
--
-- Instead, portal access is a separate identity linked to exactly one contact,
-- and portal policies grant read-only access to that contact's own records.
-- ============================================================================

create table portal_users (
  -- 1:1 with auth.users, like profiles — Supabase Auth handles credentials, so
  -- no password ever lands in this schema.
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid        not null references organizations(id) on delete cascade,

  -- The contact this login represents. Restricted: deleting a contact who has
  -- portal access should fail loudly rather than orphan a working login.
  contact_id      uuid        not null references contacts(id) on delete restrict,

  email           text        not null,
  full_name       text        not null,

  -- Revoking access must not delete the account: a client who returns later
  -- should be re-enabled, not recreated, and their audit trail kept.
  is_active       boolean     not null default true,

  last_seen_at    timestamptz,
  invited_by      uuid        references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- One portal login per contact. Two logins for the same client would make
  -- "who saw this invoice" unanswerable.
  unique (contact_id)
);

create index portal_users_organization_id_idx on portal_users(organization_id);
create index portal_users_contact_id_idx on portal_users(contact_id);

comment on table portal_users is
  'External client logins. Deliberately separate from profiles: adding a third role there would silently widen every existing policy that means "member of this organization".';

create trigger portal_users_set_updated_at before update on portal_users
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Identity helpers for portal policies.
-- ---------------------------------------------------------------------------
-- Same pattern as current_org_id(): SECURITY DEFINER with a locked search_path,
-- so a policy can read portal_users without recursing into its own policy.
-- Both return NULL for a deactivated or non-portal caller, which makes every
-- portal policy fail closed.

create or replace function portal_contact_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select contact_id from portal_users where id = auth.uid() and is_active
$$;

comment on function portal_contact_id is
  'The contact a portal user represents, or NULL when the caller is not an active portal user. Portal policies compare against this, so they fail closed for staff and deactivated clients alike.';

create or replace function is_portal_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from portal_users where id = auth.uid() and is_active)
$$;

-- ---------------------------------------------------------------------------
-- RLS on portal_users itself.
-- ---------------------------------------------------------------------------

alter table portal_users enable row level security;

-- Staff manage portal access; admins only, since granting someone outside the
-- company a login is a decision with consequences.
create policy portal_users_staff_select on portal_users
  for select using (organization_id = current_org_id() and is_admin());

create policy portal_users_staff_write on portal_users
  for all using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id() and is_admin());

-- A portal user may read their own row, so the portal can show their name.
create policy portal_users_self_select on portal_users
  for select using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Portal read access to the client's own records.
-- ---------------------------------------------------------------------------
-- Each of these is additive: staff policies already exist on these tables and
-- are untouched. A portal user matches only via portal_contact_id(), which is
-- NULL for staff, so these policies cannot widen staff access.
--
-- All are SELECT only. A client viewing their invoices must never be able to
-- edit one.

create policy contacts_portal_select on contacts
  for select using (id = portal_contact_id());

create policy invoices_portal_select on invoices
  for select using (contact_id = portal_contact_id());

create policy invoice_line_items_portal_select on invoice_line_items
  for select using (
    exists (
      select 1 from invoices i
      where i.id = invoice_line_items.invoice_id
        and i.contact_id = portal_contact_id()
    )
  );

-- Project status: the client's own deals. Note this exposes deal titles and
-- values, which is intended — it is their project — but NOT the internal
-- pipeline stage, which the portal does not query.
create policy deals_portal_select on deals
  for select using (contact_id = portal_contact_id());

create policy proposals_portal_select on proposals
  for select using (contact_id = portal_contact_id());

create policy proposal_line_items_portal_select on proposal_line_items
  for select using (
    exists (
      select 1 from proposals p
      where p.id = proposal_line_items.proposal_id
        and p.contact_id = portal_contact_id()
    )
  );

-- Documents shared with the client. Contracts and signed agreements are theirs
-- to see; internal notes are not, and notes are deliberately absent here.
create policy documents_portal_select on documents
  for select using (contact_id = portal_contact_id());

-- Services are needed to render invoice line items meaningfully. Read-only and
-- organization-scoped, and a service catalogue is not sensitive.
create policy services_portal_select on services
  for select using (
    is_portal_user()
    and organization_id = (
      select organization_id from portal_users where id = auth.uid()
    )
  );

-- Organization name and logo, for the portal header and invoice PDFs.
create policy organizations_portal_select on organizations
  for select using (
    is_portal_user()
    and id = (select organization_id from portal_users where id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- What portal users must NOT reach
-- ---------------------------------------------------------------------------
-- No policy is added for: notes, activity_log, tasks, pipeline_stages,
-- lead_scores, ad_credentials, ad_spend, scoring_weights, profiles,
-- subscriptions, or any lookup table beyond services.
--
-- Those tables have RLS enabled and no portal-matching policy, so a portal
-- user's query returns zero rows. That is the intended outcome: internal notes
-- about a client, their lead score, and what their ads cost are all things the
-- client should never see.
