-- ============================================================================
-- Orbit Works CRM — Seed Data
-- ============================================================================
-- Idempotent: safe to re-run. Uses ON CONFLICT against the (organization_id,
-- slug) unique keys so re-seeding never duplicates rows.
--
-- >>> ACTION REQUIRED <<<
-- The 13 service names below are PLACEHOLDERS. Replace the `name` and
-- `default_rate` values in the services block with the real Orbit Works
-- catalogue. Keep the `slug` values stable if any data already references them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Organization (Phase 1: exactly one)
-- ---------------------------------------------------------------------------

insert into organizations (id, name, slug, website_url, contact_email, invoice_prefix)
values (
  '00000000-0000-0000-0000-000000000001',
  'Orbit Works',
  'orbit-works',
  'https://orbitworks.com',
  'hello@orbitworks.com',
  'INV'
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Lead sources (brief §02) — slugs are contracts with the website form.
-- ---------------------------------------------------------------------------

insert into lead_sources (organization_id, name, slug, sort_order) values
  ('00000000-0000-0000-0000-000000000001', 'Website Form',  'website_form',  1),
  ('00000000-0000-0000-0000-000000000001', 'Google Ads',    'google_ads',    2),
  ('00000000-0000-0000-0000-000000000001', 'Meta Ads',      'meta_ads',      3),
  ('00000000-0000-0000-0000-000000000001', 'LinkedIn',      'linkedin',      4),
  ('00000000-0000-0000-0000-000000000001', 'Referral',      'referral',      5),
  ('00000000-0000-0000-0000-000000000001', 'Cold Outreach', 'cold_outreach', 6),
  ('00000000-0000-0000-0000-000000000001', 'Other',         'other',         7)
on conflict (organization_id, slug) do nothing;

-- ---------------------------------------------------------------------------
-- Lead statuses (brief §02).
-- is_won drives the dashboard conversion rate; is_lost excludes from the
-- active pipeline. Both are false for in-progress statuses.
-- ---------------------------------------------------------------------------

insert into lead_statuses (organization_id, name, slug, is_won, is_lost, sort_order) values
  ('00000000-0000-0000-0000-000000000001', 'New',           'new',           false, false, 1),
  ('00000000-0000-0000-0000-000000000001', 'Contacted',     'contacted',     false, false, 2),
  ('00000000-0000-0000-0000-000000000001', 'In Discussion', 'in_discussion', false, false, 3),
  ('00000000-0000-0000-0000-000000000001', 'Proposal Sent', 'proposal_sent', false, false, 4),
  ('00000000-0000-0000-0000-000000000001', 'Won',           'won',           true,  false, 5),
  ('00000000-0000-0000-0000-000000000001', 'Lost',          'lost',          false, true,  6),
  ('00000000-0000-0000-0000-000000000001', 'On Hold',       'on_hold',       false, false, 7)
on conflict (organization_id, slug) do nothing;

-- ---------------------------------------------------------------------------
-- Service catalogue — 13 entries (brief §04).
--
-- >>> PLACEHOLDER DATA — REPLACE WITH THE REAL ORBIT WORKS SERVICE LIST <<<
-- Only `name`, `description`, and `default_rate` need to change. Rates are in
-- the organization's default currency (USD).
-- ---------------------------------------------------------------------------

insert into services (organization_id, name, slug, description, default_rate, sort_order) values
  ('00000000-0000-0000-0000-000000000001', 'Web Design',              'web-design',              'Placeholder — replace with real service', 2500.00,  1),
  ('00000000-0000-0000-0000-000000000001', 'Web Development',         'web-development',         'Placeholder — replace with real service', 4000.00,  2),
  ('00000000-0000-0000-0000-000000000001', 'E-Commerce Development',  'ecommerce-development',   'Placeholder — replace with real service', 6000.00,  3),
  ('00000000-0000-0000-0000-000000000001', 'SEO',                     'seo',                     'Placeholder — replace with real service', 1200.00,  4),
  ('00000000-0000-0000-0000-000000000001', 'Google Ads Management',   'google-ads-management',   'Placeholder — replace with real service', 1000.00,  5),
  ('00000000-0000-0000-0000-000000000001', 'Meta Ads Management',     'meta-ads-management',     'Placeholder — replace with real service', 1000.00,  6),
  ('00000000-0000-0000-0000-000000000001', 'Social Media Management', 'social-media-management', 'Placeholder — replace with real service', 900.00,   7),
  ('00000000-0000-0000-0000-000000000001', 'Content Marketing',       'content-marketing',       'Placeholder — replace with real service', 1500.00,  8),
  ('00000000-0000-0000-0000-000000000001', 'Branding and Identity',   'branding-identity',       'Placeholder — replace with real service', 3000.00,  9),
  ('00000000-0000-0000-0000-000000000001', 'Email Marketing',         'email-marketing',         'Placeholder — replace with real service', 800.00,  10),
  ('00000000-0000-0000-0000-000000000001', 'Marketing Automation',    'marketing-automation',    'Placeholder — replace with real service', 2000.00, 11),
  ('00000000-0000-0000-0000-000000000001', 'AI Chatbot Development',  'ai-chatbot-development',  'Placeholder — replace with real service', 2500.00, 12),
  ('00000000-0000-0000-0000-000000000001', 'Custom Software',         'custom-software',         'Placeholder — replace with real service', 8000.00, 13)
on conflict (organization_id, slug) do nothing;
