-- ============================================================================
-- Orbit Works CRM — Phase 2: Task and Reminder System
-- ============================================================================
-- Brief: "Assign tasks, set deadlines, get notifications when a follow-up is
-- due."
--
-- Phase 1 already stores reminders on notes (next_action_at). Those stay: they
-- are the natural way to record "call them back Tuesday" while writing a note.
-- What they cannot do is carry an assignee or a completed state, so they cannot
-- express "assign tasks" — hence a real table alongside, not instead.
--
-- The Tasks page reads both, so a reminder written on a note appears in the
-- same list as a deliberately created task.
-- ============================================================================

create type task_priority as enum ('low', 'normal', 'high');

create table tasks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,

  title           text        not null,
  description     text,

  -- Optional links. A task can stand alone ("prepare Q4 report"), or hang off
  -- a contact or deal. Both nullable, and both may be set: a task about a deal
  -- is implicitly about its contact too.
  contact_id      uuid        references contacts(id) on delete cascade,
  deal_id         uuid        references deals(id) on delete cascade,

  -- Date, not timestamp: "due Tuesday" is how people actually think about
  -- follow-ups, and a time would imply a precision nobody maintains.
  due_date        date,
  priority        task_priority not null default 'normal',

  -- Completion is a timestamp rather than a boolean, so "what did we finish
  -- last week" is answerable without a separate audit trail.
  completed_at    timestamptz,
  completed_by    uuid        references profiles(id) on delete set null,

  assigned_to     uuid        references profiles(id) on delete set null,
  created_by      uuid        references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint task_title_not_blank check (length(trim(title)) > 0)
);

-- The Tasks page's primary query: my open tasks, soonest first.
create index tasks_assignee_due_idx on tasks(assigned_to, due_date)
  where completed_at is null;
-- The sidebar badge counts overdue and due-today per organization.
create index tasks_org_due_idx on tasks(organization_id, due_date)
  where completed_at is null;
create index tasks_contact_id_idx on tasks(contact_id);
create index tasks_deal_id_idx on tasks(deal_id);

comment on table tasks is
  'Assignable follow-ups with a deadline. Complements note reminders (notes.next_action_at), which cannot carry an assignee or completion.';
comment on column tasks.completed_at is
  'Null while open. A timestamp rather than a boolean so completion history is queryable without a separate log.';

create trigger tasks_set_updated_at before update on tasks
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Admins see everything in their organization. Sales see tasks they created or
-- were assigned — assignment is the point of the feature, so a task handed to
-- someone must be visible to them even though they did not create it.

alter table tasks enable row level security;

create policy tasks_select on tasks
  for select using (
    organization_id = current_org_id()
    and (is_admin() or assigned_to = auth.uid() or created_by = auth.uid())
  );

create policy tasks_insert on tasks
  for insert with check (
    organization_id = current_org_id()
    -- Anyone may create a task; sales users may only assign to themselves,
    -- while admins may delegate to anyone.
    and (is_admin() or assigned_to = auth.uid() or assigned_to is null)
  );

create policy tasks_update on tasks
  for update using (
    organization_id = current_org_id()
    and (is_admin() or assigned_to = auth.uid() or created_by = auth.uid())
  )
  with check (organization_id = current_org_id());

create policy tasks_delete on tasks
  for delete using (
    organization_id = current_org_id()
    and (is_admin() or created_by = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Completion bookkeeping
-- ---------------------------------------------------------------------------
-- Stamping completed_by in a trigger keeps it truthful: it records whoever
-- actually closed the task, not whatever the client claimed.

create or replace function sync_task_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.completed_at is not null and old.completed_at is null then
    new.completed_by := auth.uid();
  elsif new.completed_at is null then
    new.completed_by := null;
  end if;
  return new;
end;
$$;

create trigger tasks_sync_completion before update on tasks
  for each row execute function sync_task_completion();

-- ---------------------------------------------------------------------------
-- Unified reminder feed
-- ---------------------------------------------------------------------------
-- Tasks and note reminders are different shapes but the same idea: something
-- that needs doing on a date. This view merges them so the Tasks page and the
-- sidebar badge read one source rather than stitching two together in the app.

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
where n.next_action_at is not null;

comment on view pending_reminders is
  'Open tasks and outstanding note reminders in one shape. security_invoker=true, so each row is still filtered by the caller''s RLS on the underlying table.';
