-- ============================================================================
-- Orbit Works CRM — Keep portal signups out of `profiles`
-- ============================================================================
-- `handle_new_auth_user` creates a staff profile for EVERY new auth.users row.
-- Portal clients are created through the same Auth API, so without this change
-- inviting a client would also hand them a staff profile — and therefore full
-- CRM access to the whole organization.
--
-- The fix is a marker in user metadata. Portal invitations set
-- `account_type: 'portal'`, and the trigger skips profile creation for those.
-- Anything without the marker is still treated as staff, so existing behaviour
-- and existing users are unchanged.
-- ============================================================================

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  -- Portal clients get a portal_users row instead, written by the invite
  -- action. Creating a profile here would grant them staff access to every
  -- record in the organization.
  if coalesce(new.raw_user_meta_data ->> 'account_type', '') = 'portal' then
    return new;
  end if;

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

comment on function handle_new_auth_user is
  'Creates the staff profile for a new auth user. Skips accounts marked account_type=portal, which get a portal_users row instead — without this, inviting a client would grant them staff access.';

-- ---------------------------------------------------------------------------
-- Defence in depth
-- ---------------------------------------------------------------------------
-- The metadata marker is set by the application, so it is only as reliable as
-- the code that sets it. This constraint makes the invariant structural: an
-- account cannot be both staff and a portal client, whatever the metadata said.

create or replace function assert_not_portal_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from portal_users where id = new.id) then
    raise exception 'User % already has portal access and cannot also be a staff member', new.id;
  end if;
  return new;
end;
$$;

create trigger profiles_reject_portal_users before insert on profiles
  for each row execute function assert_not_portal_user();

create or replace function assert_not_staff_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from profiles where id = new.id) then
    raise exception 'User % is a staff member and cannot also have portal access', new.id;
  end if;
  return new;
end;
$$;

create trigger portal_users_reject_staff before insert on portal_users
  for each row execute function assert_not_staff_user();
