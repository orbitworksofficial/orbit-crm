-- ============================================================================
-- Orbit Works CRM — Phase 2: Proposals and Quotes
-- ============================================================================
-- Brief: "Generate branded proposal PDFs with service packages and pricing
-- from within the CRM."
--
-- Deliberately shaped like invoices — same numbering pattern, same line-item
-- snapshotting, same derived-totals view. A proposal is what an invoice was
-- before anyone agreed to it, and reusing the shape means the PDF renderer,
-- the money maths, and the service-catalogue pre-fill all carry straight over.
--
-- One difference that matters: a proposal EXPIRES. "Valid until" is the whole
-- point of a quote, so it is first-class here and the status view derives
-- 'expired' the same way invoices derive 'overdue'.
-- ============================================================================

create type proposal_status as enum ('draft', 'sent', 'accepted', 'declined');

create table proposals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,

  contact_id      uuid        not null references contacts(id) on delete restrict,
  -- Optional: a proposal often precedes the deal it creates. When it is
  -- accepted, this is where the resulting deal gets linked.
  deal_id         uuid        references deals(id) on delete set null,

  proposal_number text        not null,
  title           text        not null,
  status          proposal_status not null default 'draft',

  -- Free text that appears above the pricing table. This is where the actual
  -- pitch lives, so it is a real column rather than a note.
  summary         text,
  terms           text,

  issue_date      date        not null default current_date,
  -- 'expired' is derived from this, never stored — same reasoning as invoice
  -- overdue: a stored flag needs a cron job and is wrong between runs.
  valid_until     date        not null,
  responded_at    timestamptz,

  currency        text        not null default 'USD',
  tax_rate        numeric(5,2) not null default 0,
  -- A percentage off the subtotal. Quotes routinely carry one; invoices do not,
  -- which is the other real difference between the two.
  discount_rate   numeric(5,2) not null default 0,

  created_by      uuid        references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (organization_id, proposal_number),
  constraint proposal_tax_rate_valid check (tax_rate >= 0 and tax_rate <= 100),
  constraint proposal_discount_valid check (discount_rate >= 0 and discount_rate <= 100),
  constraint proposal_valid_until_after_issue check (valid_until >= issue_date),
  constraint proposal_title_not_blank check (length(trim(title)) > 0)
);

create index proposals_organization_id_idx on proposals(organization_id, issue_date desc);
create index proposals_contact_id_idx on proposals(contact_id);
create index proposals_deal_id_idx on proposals(deal_id);
create index proposals_status_idx on proposals(status);

comment on table proposals is
  'Branded quotes sent to a contact. Shaped like invoices so the PDF renderer and money maths are shared; differs in carrying an expiry and a discount.';
comment on column proposals.valid_until is
  'Quote expiry. "Expired" is derived from this in proposals_with_status, never stored.';

create table proposal_line_items (
  id           uuid          primary key default gen_random_uuid(),
  proposal_id  uuid          not null references proposals(id) on delete cascade,
  service_id   uuid          references services(id) on delete set null,

  -- Snapshotted from the catalogue at creation, exactly as invoice line items
  -- are: a quote sent last month must still render at the price quoted, even
  -- after the catalogue is repriced.
  name         text          not null,
  description  text,
  quantity     numeric(12,2) not null default 1,
  rate         numeric(12,2) not null default 0,
  sort_order   integer       not null default 0,

  created_at   timestamptz   not null default now(),

  constraint proposal_item_quantity_positive check (quantity > 0),
  constraint proposal_item_rate_non_negative check (rate >= 0)
);

create index proposal_line_items_proposal_id_idx on proposal_line_items(proposal_id, sort_order);

comment on table proposal_line_items is
  'Name and rate are snapshotted from the service catalogue, so repricing a service never changes a quote already sent.';

create trigger proposals_set_updated_at before update on proposals
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Numbering — mirrors next_invoice_number.
-- ---------------------------------------------------------------------------

alter table organizations
  add column if not exists proposal_prefix text not null default 'PRO',
  add column if not exists proposal_next_number integer not null default 1;

create or replace function next_proposal_number(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_number integer;
begin
  -- UPDATE ... RETURNING takes a row lock, so concurrent creation serialises
  -- here rather than producing duplicate numbers.
  update organizations
     set proposal_next_number = proposal_next_number + 1
   where id = p_organization_id
  returning proposal_prefix, proposal_next_number - 1
    into v_prefix, v_number;

  if v_number is null then
    raise exception 'Organization % not found', p_organization_id;
  end if;

  return v_prefix || '-' || lpad(v_number::text, 4, '0');
end;
$$;

comment on function next_proposal_number is
  'Allocates the next proposal number (e.g. PRO-0001) under a row lock.';

-- ---------------------------------------------------------------------------
-- Derived status and totals.
-- ---------------------------------------------------------------------------

create or replace view proposals_with_status
with (security_invoker = true)
as
select
  p.*,
  case
    when p.status = 'sent' and p.valid_until < current_date then 'expired'
    else p.status::text
  end as display_status,
  coalesce(li.subtotal, 0)                                              as subtotal,
  round(coalesce(li.subtotal, 0) * p.discount_rate / 100, 2)            as discount_amount,
  round(
    (coalesce(li.subtotal, 0) - coalesce(li.subtotal, 0) * p.discount_rate / 100)
    * p.tax_rate / 100, 2)                                              as tax_amount,
  round(
    (coalesce(li.subtotal, 0) - coalesce(li.subtotal, 0) * p.discount_rate / 100)
    * (1 + p.tax_rate / 100), 2)                                        as total
from proposals p
left join lateral (
  select sum(quantity * rate) as subtotal
  from proposal_line_items
  where proposal_id = p.id
) li on true;

comment on view proposals_with_status is
  'Proposals with derived display_status (adds "expired") and computed money. Tax applies after discount, which is the conventional order.';

-- ---------------------------------------------------------------------------
-- Response bookkeeping
-- ---------------------------------------------------------------------------

create or replace function sync_proposal_response()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('accepted', 'declined') then
    if old.status is distinct from new.status or new.responded_at is null then
      new.responded_at := coalesce(new.responded_at, now());
    end if;
  else
    -- Returning a proposal to draft or sent clears the response date.
    new.responded_at := null;
  end if;
  return new;
end;
$$;

create trigger proposals_sync_response before insert or update on proposals
  for each row execute function sync_proposal_response();

-- ---------------------------------------------------------------------------
-- RLS — visibility follows the contact, like documents.
-- ---------------------------------------------------------------------------
-- Unlike invoices, proposals are NOT admin-only: a sales user writes the quote
-- for their own account, which is the normal flow.

alter table proposals enable row level security;
alter table proposal_line_items enable row level security;

create policy proposals_select on proposals
  for select using (
    organization_id = current_org_id()
    and (
      is_admin()
      or exists (
        select 1 from contacts c
        where c.id = proposals.contact_id and c.assigned_to = auth.uid()
      )
    )
  );

create policy proposals_insert on proposals
  for insert with check (
    organization_id = current_org_id()
    and (
      is_admin()
      or exists (
        select 1 from contacts c
        where c.id = proposals.contact_id and c.assigned_to = auth.uid()
      )
    )
  );

create policy proposals_update on proposals
  for update using (
    organization_id = current_org_id()
    and (
      is_admin()
      or exists (
        select 1 from contacts c
        where c.id = proposals.contact_id and c.assigned_to = auth.uid()
      )
    )
  )
  with check (organization_id = current_org_id());

create policy proposals_delete on proposals
  for delete using (
    organization_id = current_org_id()
    and (is_admin() or created_by = auth.uid())
  );

-- Line items inherit their parent's visibility.
create policy proposal_line_items_all on proposal_line_items
  for all using (
    exists (
      select 1 from proposals p
      where p.id = proposal_line_items.proposal_id
        and p.organization_id = current_org_id()
        and (
          is_admin()
          or exists (
            select 1 from contacts c
            where c.id = p.contact_id and c.assigned_to = auth.uid()
          )
        )
    )
  )
  with check (
    exists (
      select 1 from proposals p
      where p.id = proposal_line_items.proposal_id
        and p.organization_id = current_org_id()
    )
  );
