-- ============================================================================
-- Orbit Works CRM — Phase 2: Subscription Tracking
-- ============================================================================
-- Brief: "Track recurring retainer clients, billing cycles, and renewal dates."
--
-- A retainer is a standing agreement to bill a contact on a cycle. This table
-- records the agreement; it does NOT generate invoices. Per the decision taken
-- when this was specced, the billing date produces a reminder and a human
-- raises the invoice — so a wrong amount or a quietly cancelled client cannot
-- be billed before anyone notices.
--
-- Because of that, `next_billing_date` is the load-bearing column: everything
-- the feature does hangs off knowing what is due and when.
-- ============================================================================

create type billing_cycle as enum ('monthly', 'quarterly', 'annual');
create type subscription_status as enum ('active', 'paused', 'cancelled');

create table subscriptions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,

  -- Restricted: a contact with a live retainer must not vanish silently.
  contact_id      uuid        not null references contacts(id) on delete restrict,
  -- The deal the retainer came from, when there was one.
  deal_id         uuid        references deals(id) on delete set null,

  name            text        not null,
  description     text,

  amount          numeric(12,2) not null,
  currency        text        not null default 'USD',
  cycle           billing_cycle not null default 'monthly',

  status          subscription_status not null default 'active',

  started_on      date        not null default current_date,
  -- Next date to invoice. Advanced by advance_subscription_billing() once an
  -- invoice has actually been raised, never by a clock — so a missed month
  -- stays visibly overdue rather than silently rolling forward.
  next_billing_date date      not null,
  -- Optional fixed end. A retainer with no end date runs until cancelled.
  ends_on         date,
  cancelled_at    timestamptz,

  -- How many days before the billing date a reminder should appear.
  reminder_days   integer     not null default 7,

  created_by      uuid        references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint subscription_amount_positive check (amount > 0),
  constraint subscription_name_not_blank check (length(trim(name)) > 0),
  constraint subscription_reminder_days_valid check (reminder_days >= 0 and reminder_days <= 90),
  constraint subscription_ends_after_start check (ends_on is null or ends_on >= started_on)
);

create index subscriptions_organization_id_idx on subscriptions(organization_id);
create index subscriptions_contact_id_idx on subscriptions(contact_id);
-- The query behind the due list and the dashboard figure.
create index subscriptions_due_idx on subscriptions(organization_id, next_billing_date)
  where status = 'active';

comment on table subscriptions is
  'Recurring retainers. Records the agreement and when it is next due; raising the invoice stays a deliberate human act.';
comment on column subscriptions.next_billing_date is
  'Advanced only when an invoice is actually raised, so a missed cycle stays visibly overdue instead of rolling forward on its own.';

-- Which services the retainer covers, so an invoice raised from it can be
-- pre-filled rather than retyped each cycle.
create table subscription_services (
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  service_id      uuid not null references services(id) on delete cascade,
  -- Snapshotted, as invoice line items are: repricing the catalogue must not
  -- silently change what an existing retainer bills.
  quantity        numeric(12,2) not null default 1,
  rate            numeric(12,2) not null default 0,
  primary key (subscription_id, service_id),
  constraint subscription_service_quantity_positive check (quantity > 0),
  constraint subscription_service_rate_non_negative check (rate >= 0)
);

create index subscription_services_service_id_idx on subscription_services(service_id);

create trigger subscriptions_set_updated_at before update on subscriptions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Cancellation bookkeeping
-- ---------------------------------------------------------------------------

create or replace function sync_subscription_cancellation()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  elsif new.status <> 'cancelled' then
    new.cancelled_at := null;
  end if;
  return new;
end;
$$;

create trigger subscriptions_sync_cancellation before update on subscriptions
  for each row execute function sync_subscription_cancellation();

-- ---------------------------------------------------------------------------
-- Advancing the cycle
-- ---------------------------------------------------------------------------
-- Called after an invoice has been raised for the period. Kept as a function
-- rather than inline arithmetic so "what is a quarter" is defined in exactly
-- one place, and so the rule holds however the row is updated.

create or replace function advance_subscription_billing(p_subscription_id uuid)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle billing_cycle;
  v_current date;
  v_next date;
begin
  select cycle, next_billing_date into v_cycle, v_current
    from subscriptions
   where id = p_subscription_id
     and organization_id = current_org_id();

  if v_current is null then
    raise exception 'Subscription not found';
  end if;

  -- Advance from the scheduled date, not from today: billing three days late
  -- must not shift every future cycle three days later.
  v_next := case v_cycle
    when 'monthly'   then v_current + interval '1 month'
    when 'quarterly' then v_current + interval '3 months'
    when 'annual'    then v_current + interval '1 year'
  end::date;

  update subscriptions
     set next_billing_date = v_next
   where id = p_subscription_id;

  return v_next;
end;
$$;

comment on function advance_subscription_billing is
  'Moves a retainer to its next cycle after invoicing. Advances from the scheduled date rather than today, so invoicing late does not drift the schedule.';

-- ---------------------------------------------------------------------------
-- RLS — follows contact ownership, like proposals.
-- ---------------------------------------------------------------------------

alter table subscriptions enable row level security;
alter table subscription_services enable row level security;

create policy subscriptions_select on subscriptions
  for select using (
    organization_id = current_org_id()
    and (
      is_admin()
      or exists (
        select 1 from contacts c
        where c.id = subscriptions.contact_id and c.assigned_to = auth.uid()
      )
    )
  );

create policy subscriptions_write on subscriptions
  for all using (
    organization_id = current_org_id()
    and (
      is_admin()
      or exists (
        select 1 from contacts c
        where c.id = subscriptions.contact_id and c.assigned_to = auth.uid()
      )
    )
  )
  with check (organization_id = current_org_id());

create policy subscription_services_all on subscription_services
  for all using (
    exists (
      select 1 from subscriptions s
      where s.id = subscription_services.subscription_id
        and s.organization_id = current_org_id()
        and (
          is_admin()
          or exists (
            select 1 from contacts c
            where c.id = s.contact_id and c.assigned_to = auth.uid()
          )
        )
    )
  )
  with check (
    exists (
      select 1 from subscriptions s
      where s.id = subscription_services.subscription_id
        and s.organization_id = current_org_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Surface due retainers in the existing reminder feed.
-- ---------------------------------------------------------------------------
-- Rather than a separate alert system, a retainer coming due joins the same
-- pending_reminders view that Tasks and the sidebar badge already read. One
-- place to look for "what needs doing" is the whole point of that view.

create or replace view pending_reminders
with (security_invoker = true)
as
select
  t.id,
  'task'::text          as kind,
  t.organization_id,
  t.title,
  t.description         as detail,
  t.due_date,
  t.priority::text      as priority,
  t.assigned_to,
  t.contact_id,
  t.deal_id,
  t.created_at
from tasks t
where t.completed_at is null

union all

select
  n.id,
  'note'::text          as kind,
  n.organization_id,
  coalesce(n.next_action_description, 'Follow up') as title,
  n.body                as detail,
  n.next_action_at      as due_date,
  'normal'::text        as priority,
  n.author_id           as assigned_to,
  n.contact_id,
  n.deal_id,
  n.created_at
from notes n
where n.next_action_at is not null

union all

select
  s.id,
  'subscription'::text  as kind,
  s.organization_id,
  'Invoice ' || s.name  as title,
  s.description         as detail,
  -- Surface it `reminder_days` early, so the invoice can be prepared before
  -- the date rather than after it.
  (s.next_billing_date - s.reminder_days)::date as due_date,
  'normal'::text        as priority,
  null::uuid            as assigned_to,
  s.contact_id,
  s.deal_id,
  s.created_at
from subscriptions s
where s.status = 'active'
  and (s.ends_on is null or s.next_billing_date <= s.ends_on);

comment on view pending_reminders is
  'Open tasks, outstanding note reminders, and retainers coming due — one shape, so "what needs doing" has a single answer. security_invoker=true, so each row is still filtered by RLS on its underlying table.';
