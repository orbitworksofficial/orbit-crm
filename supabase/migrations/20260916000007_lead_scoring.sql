-- ============================================================================
-- Orbit Works CRM — Phase 2: Lead Scoring
-- ============================================================================
-- Brief: "AI-based scoring that ranks leads by their likelihood to convert
-- based on source, service, and engagement."
--
-- Built as transparent, weighted rules rather than a learned model, and that
-- is a deliberate call about what the data can currently support: 16 contacts
-- and 4 wins is far below what any model needs. Fitted to that, it would
-- produce confident output with no predictive value — worse than no score,
-- because people would act on it.
--
-- What is here instead scores signals that plainly relate to conversion, shows
-- its working, and is tunable per organization. When there are a few hundred
-- leads and fifty-odd wins, `scoring_weights` can be fitted from actual
-- outcomes without changing a single query or component: the shape stays, the
-- numbers get better.
--
-- Computed in a view rather than a stored column so a score can never be stale
-- — editing a contact or adding a note changes it immediately.
-- ============================================================================

create table scoring_weights (
  organization_id uuid primary key references organizations(id) on delete cascade,

  -- Each weight is the maximum points that factor can contribute. They need
  -- not sum to 100; the view normalises to a 0-100 scale.
  weight_source        integer not null default 25,
  weight_engagement    integer not null default 30,
  weight_service       integer not null default 15,
  weight_recency       integer not null default 15,
  weight_completeness  integer not null default 15,

  -- Sources judged to convert better. Editable, because which channel works is
  -- a fact about a business, not a universal truth.
  high_intent_sources  text[] not null default array['referral', 'website_form'],

  updated_at timestamptz not null default now(),

  constraint scoring_weights_non_negative check (
    weight_source >= 0 and weight_engagement >= 0 and weight_service >= 0
    and weight_recency >= 0 and weight_completeness >= 0
  )
);

comment on table scoring_weights is
  'Tunable per-organization scoring weights. Currently hand-set; the same columns can be fitted from outcome history once there is enough of it, with no change to the scoring view or the UI.';

alter table scoring_weights enable row level security;

create policy scoring_weights_select on scoring_weights
  for select using (organization_id = current_org_id());
create policy scoring_weights_write on scoring_weights
  for all using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id() and is_admin());

insert into scoring_weights (organization_id)
select id from organizations
on conflict (organization_id) do nothing;

-- ---------------------------------------------------------------------------
-- The score.
-- ---------------------------------------------------------------------------
-- Each factor is expressed as a 0..1 ratio, then multiplied by its weight, so
-- changing a weight cannot accidentally let one factor exceed its share.
--
-- Won and lost leads score 0: the question is "who should I call", and a closed
-- lead is not an answer to it.

create or replace view lead_scores
with (security_invoker = true)
as
with signals as (
  select
    c.id,
    c.organization_id,
    c.created_at,
    st.is_won,
    st.is_lost,
    st.slug as status_slug,
    src.slug as source_slug,

    -- Engagement: notes written and deals opened. Capped, because the tenth
    -- note says little more than the third about intent.
    least((select count(*) from notes n where n.contact_id = c.id), 5)::numeric / 5 as note_ratio,
    least((select count(*) from deals d where d.contact_id = c.id), 2)::numeric / 2 as deal_ratio,

    -- Service interest: a lead who named what they want is further along than
    -- one who did not.
    least((select count(*) from contact_services cs where cs.contact_id = c.id), 3)::numeric / 3
      as service_ratio,

    -- Recency: full marks inside a week, decaying to nothing at 60 days.
    greatest(
      0,
      1 - (extract(epoch from (now() - c.created_at)) / 86400 - 7) / 53
    )::numeric as recency_raw,

    -- Completeness: a lead who gave real contact details is a warmer lead.
    (
      (case when c.email is not null then 1 else 0 end)
      + (case when c.whatsapp_number is not null then 1 else 0 end)
      + (case when c.company_name is not null then 1 else 0 end)
      + (case when c.industry is not null then 1 else 0 end)
    )::numeric / 4 as completeness_ratio
  from contacts c
  left join lead_statuses st on st.id = c.lead_status_id
  left join lead_sources src on src.id = c.lead_source_id
),
scored as (
  select
    s.*,
    w.weight_source, w.weight_engagement, w.weight_service,
    w.weight_recency, w.weight_completeness,
    w.high_intent_sources,

    least(1, greatest(0, s.recency_raw)) as recency_ratio,

    case
      when s.source_slug is null then 0.3
      when s.source_slug = any(w.high_intent_sources) then 1.0
      -- Paid channels convert, but colder than a referral.
      when s.source_slug in ('google_ads', 'meta_ads', 'linkedin') then 0.6
      when s.source_slug = 'cold_outreach' then 0.25
      else 0.5
    end as source_ratio,

    -- Progress through the pipeline is itself strong evidence.
    case s.status_slug
      when 'proposal_sent' then 1.0
      when 'in_discussion' then 0.8
      when 'contacted'     then 0.5
      when 'new'           then 0.35
      when 'on_hold'       then 0.2
      else 0.3
    end as status_ratio
  from signals s
  join scoring_weights w on w.organization_id = s.organization_id
)
select
  id,
  organization_id,
  case
    -- A closed lead is not a call to action, whatever its signals say.
    when is_won or is_lost then 0
    else least(100, round(
        source_ratio       * weight_source
      -- Engagement blends notes, deals, and pipeline position.
      + ((note_ratio * 0.3) + (deal_ratio * 0.3) + (status_ratio * 0.4)) * weight_engagement
      + service_ratio      * weight_service
      + recency_ratio      * weight_recency
      + completeness_ratio * weight_completeness
    ))::int
  end as score,

  -- The individual contributions, so the UI can show its working rather than
  -- presenting a number to be taken on trust.
  round(source_ratio * weight_source)::int        as score_source,
  round(((note_ratio * 0.3) + (deal_ratio * 0.3) + (status_ratio * 0.4)) * weight_engagement)::int
                                                  as score_engagement,
  round(service_ratio * weight_service)::int      as score_service,
  round(recency_ratio * weight_recency)::int      as score_recency,
  round(completeness_ratio * weight_completeness)::int as score_completeness,
  is_won,
  is_lost
from scored;

comment on view lead_scores is
  'Weighted 0-100 conversion likelihood per contact, with each factor''s contribution exposed so the score can be explained and challenged. security_invoker=true, so RLS on contacts still applies.';
