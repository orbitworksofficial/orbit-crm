-- ============================================================================
-- Orbit Works CRM — Phase 2: Visual Kanban Pipeline
-- ============================================================================
-- Brief: "Drag-and-drop deal board with colour-coded stages. Replaces the
-- simple status list in Phase 1."
--
-- The design this schema was built for (see the comment on deal_status in
-- 0001): stages are ADDITIVE, not a replacement. `deals.status` remains the
-- coarse outcome — open / won / lost — and every existing report, the revenue
-- calculation, and the dashboard keep reading it unchanged. `stage_id` carries
-- the finer board position alongside it.
--
-- That split is what makes this a Phase 2 feature rather than a rewrite: no
-- existing column changes type, and no existing query needs revisiting.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Pipeline stages — an admin-editable vocabulary, like lead_statuses.
-- ---------------------------------------------------------------------------

create table pipeline_stages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,

  name            text        not null,
  -- Stable machine key, so renaming a stage in Settings never breaks an
  -- integration or a saved filter.
  slug            text        not null,

  -- Board colour. Stored as a token name rather than a hex value so the board
  -- stays theme-aware: a hex picked for the light theme would be wrong in dark.
  color           text        not null default 'blue',

  -- Which coarse outcome a deal takes when dropped into this stage. Lets the
  -- board drive `status` automatically, so moving a card to "Closed Won" marks
  -- the deal won and feeds revenue without a second action.
  maps_to_status  deal_status not null default 'open',

  -- Left-to-right board order.
  position        integer     not null default 0,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (organization_id, slug),
  constraint pipeline_stage_color_valid
    check (color in ('blue', 'pink', 'amber', 'green', 'neutral')),
  constraint pipeline_stage_position_non_negative check (position >= 0)
);

create index pipeline_stages_organization_id_idx on pipeline_stages(organization_id, position);

comment on table pipeline_stages is
  'Kanban board columns. Additive to deals.status, which remains the coarse outcome every report reads.';
comment on column pipeline_stages.maps_to_status is
  'Dropping a deal into this stage sets deals.status to this value, so the board drives revenue without a separate step.';
comment on column pipeline_stages.color is
  'Design token name, not a hex value, so board colours resolve correctly in both themes.';

-- ---------------------------------------------------------------------------
-- Deals gain a board position.
-- ---------------------------------------------------------------------------
-- Both columns are nullable: a deal that has never been placed on the board is
-- valid, and back-fills below rather than blocking the migration.

alter table deals
  add column stage_id uuid references pipeline_stages(id) on delete set null,
  -- Ordering *within* a column. Fractional, so dropping a card between two
  -- others is a single UPDATE rather than renumbering the whole column.
  add column board_position numeric(20, 10);

create index deals_stage_id_idx on deals(stage_id, board_position);

comment on column deals.board_position is
  'Order within a Kanban column. Fractional so an insert between two cards is one UPDATE, not a renumber of the column.';

-- ---------------------------------------------------------------------------
-- RLS — same shape as every other table.
-- ---------------------------------------------------------------------------

alter table pipeline_stages enable row level security;

create policy pipeline_stages_select on pipeline_stages
  for select using (organization_id = current_org_id());

create policy pipeline_stages_write on pipeline_stages
  for all using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id() and is_admin());

create trigger pipeline_stages_set_updated_at before update on pipeline_stages
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Keep status and stage consistent.
-- ---------------------------------------------------------------------------
-- Moving a card on the board is the natural way to mark a deal won, so the
-- stage drives the status. Enforced in the database rather than the UI so it
-- holds however the row is updated.

create or replace function sync_deal_stage_status()
returns trigger
language plpgsql
as $$
declare
  v_maps_to deal_status;
begin
  -- Only act when the stage actually changed, so a plain status edit is never
  -- overridden by the stage it happens to sit in.
  if new.stage_id is not null
     and new.stage_id is distinct from coalesce(old.stage_id, '00000000-0000-0000-0000-000000000000'::uuid)
  then
    select maps_to_status into v_maps_to
      from pipeline_stages where id = new.stage_id;

    if v_maps_to is not null then
      new.status := v_maps_to;
    end if;
  end if;

  return new;
end;
$$;

-- Runs before deals_sync_closed_at (alphabetical order), so closed_at is
-- stamped from the status this trigger has just set.
create trigger deals_aa_sync_stage_status before insert or update on deals
  for each row execute function sync_deal_stage_status();

-- ---------------------------------------------------------------------------
-- Seed the default board and place existing deals.
-- ---------------------------------------------------------------------------

do $$
declare
  v_org uuid;
begin
  for v_org in select id from organizations loop
    insert into pipeline_stages (organization_id, name, slug, color, maps_to_status, position)
    values
      (v_org, 'New',           'new',           'blue',    'open', 1),
      (v_org, 'Qualified',     'qualified',     'blue',    'open', 2),
      (v_org, 'Proposal Sent', 'proposal_sent', 'amber',   'open', 3),
      (v_org, 'Negotiation',   'negotiation',   'pink',    'open', 4),
      (v_org, 'Closed Won',    'closed_won',    'green',   'won',  5),
      (v_org, 'Closed Lost',   'closed_lost',   'neutral', 'lost', 6)
    on conflict (organization_id, slug) do nothing;
  end loop;
end $$;

-- Place existing deals on the board from their current outcome, so the board is
-- populated the first time it is opened rather than empty.
update deals d
   set stage_id = s.id,
       board_position = extract(epoch from d.created_at)
  from pipeline_stages s
 where s.organization_id = d.organization_id
   and d.stage_id is null
   and s.slug = case d.status
                  when 'won'  then 'closed_won'
                  when 'lost' then 'closed_lost'
                  else 'new'
                end;
