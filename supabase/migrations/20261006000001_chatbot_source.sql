-- ============================================================================
-- Orbit Works CRM — Phase 2: AI Chatbot Integration
-- ============================================================================
-- Brief: "Embed the Orbit Works chatbot into the CRM. Leads captured by the
-- chatbot auto-populate contacts."
--
-- The chatbot already captures leads with name, email, company, requirement
-- and services. All that was missing was a lead source to attribute them to,
-- so "leads by source" on the dashboard can separate chatbot conversations
-- from website form submissions and paid channels.
--
-- No new table: a chatbot lead IS a contact. Giving it its own store would
-- mean two places to look for the same person, and a merge problem later.
-- ============================================================================

insert into lead_sources (organization_id, name, slug, sort_order)
select
  id,
  'AI Chatbot',
  -- The chatbot posts this slug; renaming the display label in Settings must
  -- never break intake, which is why the slug is the contract.
  'ai_chatbot',
  8
from organizations
on conflict (organization_id, slug) do nothing;

comment on column lead_sources.slug is
  'Immutable machine key used by the public lead intake API and the chatbot. Display name may change; slug must not.';
