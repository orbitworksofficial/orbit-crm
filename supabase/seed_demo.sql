-- ============================================================================
-- Orbit Works CRM — Demo Data
-- ============================================================================
-- Realistic sample data for testing and for demonstrating the CRM to clients.
--
--   Run:    npm run db:demo
--   Remove: npm run db:demo:clear
--
-- NOT run by `npm run db:seed` — reference data and demo data are separate, so
-- going live is a matter of clearing this file's rows and nothing else.
--
-- Notes on the design of this data:
--   * Dates are relative to now(), so the dashboard's Today / This Week /
--     Last 30 Days filters all have something to show whenever it is run.
--   * Every row is tagged `is_demo` in its metadata or via the marker table
--     below, so removal is exact and never touches real records.
--   * created_at is set at INSERT: the contacts_freeze_created_at trigger
--     makes it immutable afterwards, so backdating cannot be done by UPDATE.
--   * Contacts are spread across the funnel with a realistic taper — many new
--     leads, fewer won — so conversion rate reads as something plausible
--     rather than 50%.
-- ============================================================================

-- Marker table recording which rows this file created, so the teardown script
-- can remove exactly those and nothing else.
create table if not exists demo_data_marker (
  table_name text not null,
  record_id  uuid not null,
  created_at timestamptz not null default now(),
  primary key (table_name, record_id)
);

comment on table demo_data_marker is
  'Bookkeeping for demo data only. Drop this table when going live.';

do $$
declare
  v_org        uuid;
  v_admin      uuid;
  v_sales      uuid;

  -- Lead statuses
  s_new uuid; s_contacted uuid; s_discussion uuid;
  s_proposal uuid; s_won uuid; s_lost uuid; s_hold uuid;

  -- Lead sources
  src_web uuid; src_google uuid; src_meta uuid;
  src_linkedin uuid; src_referral uuid; src_cold uuid;

  -- Services (by slug, so this survives a renamed catalogue)
  svc_ids uuid[];
  svc_web_design uuid; svc_web_dev uuid; svc_ecom uuid; svc_seo uuid;
  svc_gads uuid; svc_social uuid; svc_brand uuid; svc_custom uuid;

  v_contact  uuid;
  v_deal     uuid;
  v_invoice  uuid;
  v_number   text;
begin

  select id into v_org from organizations order by created_at limit 1;
  if v_org is null then
    raise exception 'No organization found. Run `npm run db:seed` first.';
  end if;

  -- Users: prefer a real admin, fall back to whoever exists.
  select id into v_admin from profiles where role = 'admin' order by created_at limit 1;
  select id into v_sales from profiles where role = 'sales' order by created_at limit 1;

  if v_admin is null then
    raise exception 'No admin profile found. Create your admin user first.';
  end if;

  -- A single-user install still demos correctly: both roles collapse to the
  -- admin, and every record stays visible.
  v_sales := coalesce(v_sales, v_admin);

  select id into s_new        from lead_statuses where organization_id = v_org and slug = 'new';
  select id into s_contacted  from lead_statuses where organization_id = v_org and slug = 'contacted';
  select id into s_discussion from lead_statuses where organization_id = v_org and slug = 'in_discussion';
  select id into s_proposal   from lead_statuses where organization_id = v_org and slug = 'proposal_sent';
  select id into s_won        from lead_statuses where organization_id = v_org and slug = 'won';
  select id into s_lost       from lead_statuses where organization_id = v_org and slug = 'lost';
  select id into s_hold       from lead_statuses where organization_id = v_org and slug = 'on_hold';

  select id into src_web      from lead_sources where organization_id = v_org and slug = 'website_form';
  select id into src_google   from lead_sources where organization_id = v_org and slug = 'google_ads';
  select id into src_meta     from lead_sources where organization_id = v_org and slug = 'meta_ads';
  select id into src_linkedin from lead_sources where organization_id = v_org and slug = 'linkedin';
  select id into src_referral from lead_sources where organization_id = v_org and slug = 'referral';
  select id into src_cold     from lead_sources where organization_id = v_org and slug = 'cold_outreach';

  -- Services are matched positionally as a fallback, so this file still works
  -- after the placeholder catalogue is replaced with real service names.
  select array_agg(id order by sort_order) into svc_ids
    from services where organization_id = v_org and is_active;

  if array_length(svc_ids, 1) is null then
    raise exception 'No services found. Run `npm run db:seed` first.';
  end if;

  svc_web_design := svc_ids[1];
  svc_web_dev    := coalesce(svc_ids[2], svc_ids[1]);
  svc_ecom       := coalesce(svc_ids[3], svc_ids[1]);
  svc_seo        := coalesce(svc_ids[4], svc_ids[1]);
  svc_gads       := coalesce(svc_ids[5], svc_ids[1]);
  svc_social     := coalesce(svc_ids[7], svc_ids[1]);
  svc_brand      := coalesce(svc_ids[9], svc_ids[1]);
  svc_custom     := coalesce(svc_ids[13], svc_ids[1]);

  -- =========================================================================
  -- 01 · WON CUSTOMERS — closed deals, invoices, payment history
  -- =========================================================================

  -- ---- Meridian Property Group: the flagship account ----------------------
  insert into contacts (organization_id, full_name, email, whatsapp_number,
    company_name, industry, city, country, lead_source_id, lead_status_id,
    assigned_to, created_by, utm_source, utm_campaign, created_at)
  values (v_org, 'Sarah Whitfield', 'sarah.w@meridianproperty.ae', '+971 50 442 1187',
    'Meridian Property Group', 'Real Estate', 'Dubai', 'United Arab Emirates',
    src_referral, s_won, v_admin, v_admin, null, null, now() - interval '94 days')
  returning id into v_contact;
  insert into demo_data_marker values ('contacts', v_contact);

  insert into contact_services (contact_id, service_id)
  values (v_contact, svc_web_design), (v_contact, svc_web_dev), (v_contact, svc_seo);

  insert into notes (organization_id, contact_id, body, author_id, created_at) values
    (v_org, v_contact, 'Referred by Tom at Alcove Interiors. They are re-platforming from an ageing WordPress site and want something faster. Budget signalled around $18–22k.', v_admin, now() - interval '94 days'),
    (v_org, v_contact, 'Discovery call done. Three stakeholders: Sarah (marketing), Idris (ops), and a silent CFO. Idris is the one to convince — he has been burned by an agency before.', v_admin, now() - interval '88 days'),
    (v_org, v_contact, 'Proposal sent. Two options: full rebuild at $19,500, or phased at $12k then $9k. They are leaning phased.', v_admin, now() - interval '81 days'),
    (v_org, v_contact, 'Signed the full rebuild. Idris came round after the performance audit — the current site scores 31 on mobile. Kickoff Monday.', v_admin, now() - interval '74 days');

  insert into deals (organization_id, contact_id, title, value, status,
    expected_close_date, closed_at, assigned_to, created_by, created_at)
  values (v_org, v_contact, 'Website rebuild and SEO retainer', 19500, 'won',
    (now() - interval '76 days')::date, now() - interval '74 days',
    v_admin, v_admin, now() - interval '88 days')
  returning id into v_deal;
  insert into demo_data_marker values ('deals', v_deal);

  insert into deal_services (deal_id, service_id)
  values (v_deal, svc_web_design), (v_deal, svc_web_dev), (v_deal, svc_seo);

  insert into notes (organization_id, deal_id, body, author_id, created_at) values
    (v_org, v_deal, 'Scope locked: 14 templates, CMS migration, 300 redirects. Anything beyond is change-request.', v_admin, now() - interval '73 days'),
    (v_org, v_deal, 'Phase 1 delivered and signed off. Invoicing the first half.', v_admin, now() - interval '46 days');

  -- Paid invoice
  select next_invoice_number(v_org) into v_number;
  insert into invoices (organization_id, contact_id, deal_id, invoice_number, status,
    issue_date, due_date, paid_at, tax_rate, payment_terms, notes, created_by, created_at)
  values (v_org, v_contact, v_deal, v_number, 'paid',
    (now() - interval '46 days')::date, (now() - interval '16 days')::date,
    now() - interval '21 days', 5, 'Net 30',
    'Phase 1 of 2. Bank transfer received with thanks.', v_admin, now() - interval '46 days')
  returning id into v_invoice;
  insert into demo_data_marker values ('invoices', v_invoice);

  insert into invoice_line_items (invoice_id, service_id, name, description, quantity, rate, sort_order) values
    (v_invoice, svc_web_design, 'Web Design', 'UI design across 14 page templates, two revision rounds', 1, 6500, 0),
    (v_invoice, svc_web_dev,    'Web Development', 'Front-end build and CMS integration, phase 1', 1, 4000, 1);

  -- Sent invoice, still within terms
  select next_invoice_number(v_org) into v_number;
  insert into invoices (organization_id, contact_id, deal_id, invoice_number, status,
    issue_date, due_date, tax_rate, payment_terms, notes, created_by, created_at)
  values (v_org, v_contact, v_deal, v_number, 'sent',
    (now() - interval '9 days')::date, (now() + interval '21 days')::date,
    5, 'Net 30', 'Phase 2 of 2, plus first quarter of the SEO retainer.',
    v_admin, now() - interval '9 days')
  returning id into v_invoice;
  insert into demo_data_marker values ('invoices', v_invoice);

  insert into invoice_line_items (invoice_id, service_id, name, description, quantity, rate, sort_order) values
    (v_invoice, svc_web_dev, 'Web Development', 'Front-end build, phase 2 and launch', 1, 5400, 0),
    (v_invoice, svc_seo,     'SEO', 'Technical SEO and content optimisation, monthly', 3, 1200, 1);

  -- ---- Northgate Logistics: overdue invoice, for the collections view -----
  insert into contacts (organization_id, full_name, email, whatsapp_number,
    company_name, industry, city, country, lead_source_id, lead_status_id,
    assigned_to, created_by, utm_source, utm_medium, utm_campaign, created_at)
  values (v_org, 'Daniel Osei', 'd.osei@northgatelogistics.com', '+44 7700 900413',
    'Northgate Logistics', 'Transport & Logistics', 'Manchester', 'United Kingdom',
    src_google, s_won, v_sales, v_admin, 'google', 'cpc', 'uk-logistics-q2', now() - interval '71 days')
  returning id into v_contact;
  insert into demo_data_marker values ('contacts', v_contact);

  insert into contact_services (contact_id, service_id)
  values (v_contact, svc_custom), (v_contact, svc_web_dev);

  insert into notes (organization_id, contact_id, body, author_id, created_at) values
    (v_org, v_contact, 'Inbound from Google Ads. Needs a driver-facing portal — currently running the whole fleet on spreadsheets.', v_sales, now() - interval '71 days'),
    (v_org, v_contact, 'Scoped the portal. Two roles, shift scheduling, document upload. Quoted $14,800.', v_sales, now() - interval '62 days'),
    (v_org, v_contact, 'Won. Their finance team is slow to pay — worth watching the invoice.', v_sales, now() - interval '55 days');

  insert into deals (organization_id, contact_id, title, value, status,
    expected_close_date, closed_at, assigned_to, created_by, created_at)
  values (v_org, v_contact, 'Driver portal build', 14800, 'won',
    (now() - interval '58 days')::date, now() - interval '55 days',
    v_sales, v_admin, now() - interval '68 days')
  returning id into v_deal;
  insert into demo_data_marker values ('deals', v_deal);

  insert into deal_services (deal_id, service_id) values (v_deal, svc_custom);

  -- Overdue: sent, due date passed. Derived by the view, not stored.
  select next_invoice_number(v_org) into v_number;
  insert into invoices (organization_id, contact_id, deal_id, invoice_number, status,
    issue_date, due_date, tax_rate, payment_terms, notes, created_by, created_at)
  values (v_org, v_contact, v_deal, v_number, 'sent',
    (now() - interval '52 days')::date, (now() - interval '22 days')::date,
    0, 'Net 30', 'Chased twice. Third reminder due.', v_admin, now() - interval '52 days')
  returning id into v_invoice;
  insert into demo_data_marker values ('invoices', v_invoice);

  insert into invoice_line_items (invoice_id, service_id, name, description, quantity, rate, sort_order) values
    (v_invoice, svc_custom, 'Custom Software', 'Driver portal — scheduling, documents, two user roles', 1, 14800, 0);

  -- ---- Calder & Finch: recent win, fully paid -----------------------------
  -- Deliberately closed inside the last 30 days, so the dashboard's default
  -- range shows revenue and a non-zero conversion rate rather than an empty
  -- state. A demo where every headline figure reads zero demos nothing.
  insert into contacts (organization_id, full_name, email, company_name,
    industry, city, country, lead_source_id, lead_status_id, assigned_to,
    created_by, created_at)
  values (v_org, 'Priya Raman', 'priya@calderfinch.co', 'Calder & Finch',
    'Legal Services', 'Singapore', 'Singapore',
    src_linkedin, s_won, v_admin, v_admin, now() - interval '21 days')
  returning id into v_contact;
  insert into demo_data_marker values ('contacts', v_contact);

  insert into contact_services (contact_id, service_id)
  values (v_contact, svc_brand), (v_contact, svc_web_design);

  insert into notes (organization_id, contact_id, body, author_id, created_at) values
    (v_org, v_contact, 'Found us through the LinkedIn case study post. Boutique firm, six partners, wants to look less like a 2011 law firm.', v_admin, now() - interval '21 days'),
    (v_org, v_contact, 'Brand refresh agreed at $7,200. Fast decision — partners voted the same week.', v_admin, now() - interval '12 days');

  insert into deals (organization_id, contact_id, title, value, status,
    expected_close_date, closed_at, assigned_to, created_by, created_at)
  values (v_org, v_contact, 'Brand identity refresh', 7200, 'won',
    (now() - interval '13 days')::date, now() - interval '12 days',
    v_admin, v_admin, now() - interval '19 days')
  returning id into v_deal;
  insert into demo_data_marker values ('deals', v_deal);

  insert into deal_services (deal_id, service_id) values (v_deal, svc_brand);

  select next_invoice_number(v_org) into v_number;
  insert into invoices (organization_id, contact_id, deal_id, invoice_number, status,
    issue_date, due_date, paid_at, tax_rate, payment_terms, created_by, created_at)
  values (v_org, v_contact, v_deal, v_number, 'paid',
    (now() - interval '11 days')::date, (now() + interval '4 days')::date,
    now() - interval '3 days', 0, 'Net 15', v_admin, now() - interval '11 days')
  returning id into v_invoice;
  insert into demo_data_marker values ('invoices', v_invoice);

  insert into invoice_line_items (invoice_id, service_id, name, description, quantity, rate, sort_order) values
    (v_invoice, svc_brand, 'Branding and Identity', 'Logo, type system, colour, and a 24-page brand guide', 1, 7200, 0);

  -- ---- Ridgeway Consulting: a second recent win, closed this week ---------
  insert into contacts (organization_id, full_name, email, whatsapp_number,
    company_name, industry, city, country, lead_source_id, lead_status_id,
    assigned_to, created_by, created_at)
  values (v_org, 'Fiona Alexander', 'fiona@ridgewayconsulting.com', '+1 312 555 0198',
    'Ridgeway Consulting', 'Professional Services', 'Chicago', 'United States',
    src_referral, s_won, v_sales, v_admin, now() - interval '17 days')
  returning id into v_contact;
  insert into demo_data_marker values ('contacts', v_contact);

  insert into contact_services (contact_id, service_id)
  values (v_contact, svc_web_design), (v_contact, svc_seo);

  insert into notes (organization_id, contact_id, body, author_id, created_at) values
    (v_org, v_contact, 'Referred by Sarah at Meridian. Wants a credibility site — they pitch to enterprise buyers and the current site undercuts them.', v_sales, now() - interval '17 days'),
    (v_org, v_contact, 'Closed at $9,800. Quickest turnaround we have had — referral trust did the selling.', v_sales, now() - interval '5 days');

  insert into deals (organization_id, contact_id, title, value, status,
    expected_close_date, closed_at, assigned_to, created_by, created_at)
  values (v_org, v_contact, 'Corporate site and SEO foundation', 9800, 'won',
    (now() - interval '6 days')::date, now() - interval '5 days',
    v_sales, v_admin, now() - interval '15 days')
  returning id into v_deal;
  insert into demo_data_marker values ('deals', v_deal);

  insert into deal_services (deal_id, service_id)
  values (v_deal, svc_web_design), (v_deal, svc_seo);

  select next_invoice_number(v_org) into v_number;
  insert into invoices (organization_id, contact_id, deal_id, invoice_number, status,
    issue_date, due_date, tax_rate, payment_terms, created_by, created_at)
  values (v_org, v_contact, v_deal, v_number, 'sent',
    (now() - interval '4 days')::date, (now() + interval '26 days')::date,
    0, 'Net 30', v_admin, now() - interval '4 days')
  returning id into v_invoice;
  insert into demo_data_marker values ('invoices', v_invoice);

  insert into invoice_line_items (invoice_id, service_id, name, description, quantity, rate, sort_order) values
    (v_invoice, svc_web_design, 'Web Design', 'Eight-page corporate site, design and build', 1, 8000, 0),
    (v_invoice, svc_seo,        'SEO', 'Technical foundation and keyword mapping', 1, 1800, 1);

  -- =========================================================================
  -- 02 · ACTIVE PIPELINE — open deals at various stages
  -- =========================================================================

  -- ---- Proposal sent, large value -----------------------------------------
  insert into contacts (organization_id, full_name, email, whatsapp_number,
    company_name, industry, city, country, lead_source_id, lead_status_id,
    assigned_to, created_by, created_at)
  values (v_org, 'Marcus Bell', 'marcus.bell@harborview.com', '+1 415 555 0176',
    'Harborview Retail', 'Retail & E-Commerce', 'San Francisco', 'United States',
    src_referral, s_proposal, v_admin, v_admin, now() - interval '23 days')
  returning id into v_contact;
  insert into demo_data_marker values ('contacts', v_contact);

  insert into contact_services (contact_id, service_id)
  values (v_contact, svc_ecom), (v_contact, svc_gads), (v_contact, svc_seo);

  insert into notes (organization_id, contact_id, body, next_action_at,
    next_action_description, author_id, created_at)
  values (v_org, v_contact, 'Proposal sent Tuesday: Shopify Plus migration at $31,000 plus a $2,500/mo ads retainer. Marcus is positive but it goes to their board on the 14th.',
    (now() + interval '4 days')::date, 'Follow up after the board meeting', v_admin, now() - interval '6 days');

  insert into deals (organization_id, contact_id, title, value, status,
    expected_close_date, assigned_to, created_by, created_at)
  values (v_org, v_contact, 'Shopify Plus migration and ads retainer', 31000, 'open',
    (now() + interval '18 days')::date, v_admin, v_admin, now() - interval '19 days')
  returning id into v_deal;
  insert into demo_data_marker values ('deals', v_deal);

  insert into deal_services (deal_id, service_id)
  values (v_deal, svc_ecom), (v_deal, svc_gads);

  insert into notes (organization_id, deal_id, body, author_id, created_at)
  values (v_org, v_deal, 'Biggest open deal this quarter. Competing against an in-house build proposal — our angle is time-to-launch.', v_admin, now() - interval '5 days');

  -- ---- In discussion -------------------------------------------------------
  insert into contacts (organization_id, full_name, email, whatsapp_number,
    company_name, industry, city, country, lead_source_id, lead_status_id,
    assigned_to, created_by, utm_source, utm_medium, created_at)
  values (v_org, 'Aisha Karim', 'aisha@lumenclinics.ae', '+971 55 318 2204',
    'Lumen Clinics', 'Healthcare', 'Abu Dhabi', 'United Arab Emirates',
    src_meta, s_discussion, v_sales, v_admin, 'facebook', 'paid_social', now() - interval '15 days')
  returning id into v_contact;
  insert into demo_data_marker values ('contacts', v_contact);

  insert into contact_services (contact_id, service_id)
  values (v_contact, svc_social), (v_contact, svc_web_design);

  insert into notes (organization_id, contact_id, body, next_action_at,
    next_action_description, author_id, created_at)
  values (v_org, v_contact, 'Three clinics, opening a fourth. Wants social plus a booking-focused site. Sensitive to healthcare advertising rules — flagged that we would need compliance review.',
    (now() + interval '2 days')::date, 'Send the healthcare compliance one-pager', v_sales, now() - interval '4 days');

  insert into deals (organization_id, contact_id, title, value, status,
    expected_close_date, assigned_to, created_by, created_at)
  values (v_org, v_contact, 'Clinic website and social management', 12400, 'open',
    (now() + interval '30 days')::date, v_sales, v_admin, now() - interval '11 days')
  returning id into v_deal;
  insert into demo_data_marker values ('deals', v_deal);

  insert into deal_services (deal_id, service_id)
  values (v_deal, svc_social), (v_deal, svc_web_design);

  -- ---- Early-stage, this week ---------------------------------------------
  insert into contacts (organization_id, full_name, email, company_name,
    industry, city, country, lead_source_id, lead_status_id, assigned_to,
    created_by, utm_source, utm_medium, utm_campaign, created_at)
  values (v_org, 'Tom Bradbury', 'tom@stonebridgefit.co.uk', 'Stonebridge Fitness',
    'Health & Fitness', 'Leeds', 'United Kingdom',
    src_google, s_contacted, v_sales, v_admin, 'google', 'cpc', 'uk-fitness-q3', now() - interval '3 days')
  returning id into v_contact;
  insert into demo_data_marker values ('contacts', v_contact);

  insert into contact_services (contact_id, service_id) values (v_contact, svc_web_design);

  insert into notes (organization_id, contact_id, body, next_action_at,
    next_action_description, author_id, created_at)
  values (v_org, v_contact, 'Left a voicemail and emailed. Two gyms, wants a members area. Modest budget, mentioned "a few thousand".',
    (now() + interval '1 day')::date, 'Second call attempt', v_sales, now() - interval '2 days');

  insert into deals (organization_id, contact_id, title, value, status,
    expected_close_date, assigned_to, created_by, created_at)
  values (v_org, v_contact, 'Gym site with members area', 5600, 'open',
    (now() + interval '45 days')::date, v_sales, v_admin, now() - interval '2 days')
  returning id into v_deal;
  insert into demo_data_marker values ('deals', v_deal);
  insert into deal_services (deal_id, service_id) values (v_deal, svc_web_design);

  -- =========================================================================
  -- 03 · LOST AND ON HOLD — so the funnel report has real drop-off
  -- =========================================================================

  insert into contacts (organization_id, full_name, email, company_name,
    industry, city, country, lead_source_id, lead_status_id, assigned_to,
    created_by, created_at)
  values (v_org, 'Elena Vasquez', 'elena@terracottastudio.es', 'Terracotta Studio',
    'Hospitality', 'Barcelona', 'Spain',
    src_cold, s_lost, v_sales, v_admin, now() - interval '58 days')
  returning id into v_contact;
  insert into demo_data_marker values ('contacts', v_contact);

  insert into contact_services (contact_id, service_id) values (v_contact, svc_web_design);

  insert into notes (organization_id, contact_id, body, author_id, created_at)
  values (v_org, v_contact, 'Went with a local freelancer at roughly a third of our quote. Worth revisiting in six months — that price usually buys a rebuild later.', v_sales, now() - interval '44 days');

  insert into deals (organization_id, contact_id, title, value, status,
    expected_close_date, closed_at, assigned_to, created_by, created_at)
  values (v_org, v_contact, 'Restaurant group website', 8400, 'lost',
    (now() - interval '46 days')::date, now() - interval '44 days',
    v_sales, v_admin, now() - interval '55 days')
  returning id into v_deal;
  insert into demo_data_marker values ('deals', v_deal);
  insert into deal_services (deal_id, service_id) values (v_deal, svc_web_design);

  insert into contacts (organization_id, full_name, email, company_name,
    industry, city, country, lead_source_id, lead_status_id, assigned_to,
    created_by, created_at)
  values (v_org, 'James Okonkwo', 'j.okonkwo@vertexfin.com', 'Vertex Financial',
    'Financial Services', 'Lagos', 'Nigeria',
    src_linkedin, s_hold, v_admin, v_admin, now() - interval '37 days')
  returning id into v_contact;
  insert into demo_data_marker values ('contacts', v_contact);

  insert into contact_services (contact_id, service_id)
  values (v_contact, svc_custom), (v_contact, svc_brand);

  insert into notes (organization_id, contact_id, body, next_action_at,
    next_action_description, author_id, created_at)
  values (v_org, v_contact, 'Budget frozen until their next funding round closes. Genuinely interested — asked us to check back rather than saying no.',
    (now() + interval '25 days')::date, 'Check in on funding round', v_admin, now() - interval '20 days');

  -- =========================================================================
  -- 04 · FRESH LEADS — recent, mostly unworked, so Today/This Week populate
  -- =========================================================================

  insert into contacts (organization_id, full_name, email, whatsapp_number,
    company_name, industry, city, country, lead_source_id, lead_status_id,
    assigned_to, created_by, utm_source, utm_medium, utm_campaign, created_at)
  values
    (v_org, 'Rebecca Lyle', 'rebecca@northshoredental.ca', '+1 604 555 0142',
     'Northshore Dental', 'Healthcare', 'Vancouver', 'Canada',
     src_web, s_new, null, null, 'google', 'organic', null, now() - interval '5 hours'),
    (v_org, 'Hassan Al-Rashid', 'hassan@dunesrealty.ae', '+971 52 774 9903',
     'Dunes Realty', 'Real Estate', 'Sharjah', 'United Arab Emirates',
     src_web, s_new, null, null, 'linkedin', 'social', 'q3-content', now() - interval '19 hours'),
    (v_org, 'Grace Mitchell', 'grace@atlaseducation.org', null,
     'Atlas Education', 'Education', 'Melbourne', 'Australia',
     src_meta, s_new, v_sales, v_admin, 'facebook', 'paid_social', 'edu-au-aug', now() - interval '2 days'),
    (v_org, 'Luca Ferrari', 'luca@borgocoffee.it', '+39 340 555 1188',
     'Borgo Coffee Roasters', 'Food & Beverage', 'Milan', 'Italy',
     src_web, s_contacted, v_sales, v_admin, null, null, null, now() - interval '4 days'),
    (v_org, 'Nadia Haddad', 'nadia@pulsemedia.co', '+961 3 555 224',
     'Pulse Media', 'Marketing & Advertising', 'Beirut', 'Lebanon',
     src_referral, s_contacted, v_admin, v_admin, null, null, null, now() - interval '6 days'),
    (v_org, 'Oliver Grant', 'oliver@kestrelarch.co.uk', null,
     'Kestrel Architects', 'Architecture', 'Bristol', 'United Kingdom',
     src_cold, s_new, v_sales, v_admin, null, null, null, now() - interval '9 days'),
    (v_org, 'Mei Chen', 'mei.chen@lanterntravel.sg', '+65 8123 4477',
     'Lantern Travel', 'Travel & Tourism', 'Singapore', 'Singapore',
     src_google, s_discussion, v_admin, v_admin, 'google', 'cpc', 'apac-travel', now() - interval '12 days');

  -- Register the batch above for teardown.
  insert into demo_data_marker (table_name, record_id)
  select 'contacts', id from contacts
   where organization_id = v_org
     and email in ('rebecca@northshoredental.ca','hassan@dunesrealty.ae',
                   'grace@atlaseducation.org','luca@borgocoffee.it',
                   'nadia@pulsemedia.co','oliver@kestrelarch.co.uk',
                   'mei.chen@lanterntravel.sg')
  on conflict do nothing;

  -- Service interest for the fresh leads.
  insert into contact_services (contact_id, service_id)
  select c.id, s.id
    from contacts c
    cross join lateral (
      select unnest(case
        when c.email = 'rebecca@northshoredental.ca' then array[svc_web_design, svc_seo]
        when c.email = 'hassan@dunesrealty.ae'       then array[svc_web_dev, svc_gads]
        when c.email = 'grace@atlaseducation.org'    then array[svc_social]
        when c.email = 'luca@borgocoffee.it'         then array[svc_ecom, svc_brand]
        when c.email = 'nadia@pulsemedia.co'         then array[svc_custom]
        when c.email = 'oliver@kestrelarch.co.uk'    then array[svc_web_design]
        else array[svc_seo, svc_gads]
      end) as id
    ) s
   where c.organization_id = v_org
     and c.email in ('rebecca@northshoredental.ca','hassan@dunesrealty.ae',
                     'grace@atlaseducation.org','luca@borgocoffee.it',
                     'nadia@pulsemedia.co','oliver@kestrelarch.co.uk',
                     'mei.chen@lanterntravel.sg')
  on conflict do nothing;

  -- A couple of enquiry notes, as the website form would have written them.
  insert into notes (organization_id, contact_id, body, author_id, created_at)
  select v_org, c.id,
         'Website enquiry:' || chr(10) || chr(10) ||
         case c.email
           when 'rebecca@northshoredental.ca' then 'We need a new site for our two clinics. Online booking is the priority — patients keep calling to book and it ties up reception.'
           when 'hassan@dunesrealty.ae' then 'Looking for a property listings portal with Arabic and English. Can you send examples of similar work?'
           else 'Interested in discussing a project. Please get in touch.'
         end,
         null, c.created_at
    from contacts c
   where c.organization_id = v_org
     and c.email in ('rebecca@northshoredental.ca','hassan@dunesrealty.ae');

  -- One draft invoice, so every invoice status is represented.
  select id into v_contact from contacts
   where organization_id = v_org and email = 'mei.chen@lanterntravel.sg';

  select next_invoice_number(v_org) into v_number;
  insert into invoices (organization_id, contact_id, invoice_number, status,
    issue_date, due_date, tax_rate, payment_terms, notes, created_by, created_at)
  values (v_org, v_contact, v_number, 'draft',
    current_date, (current_date + interval '30 days')::date, 5, 'Net 30',
    'Draft pending scope confirmation — do not send yet.', v_admin, now())
  returning id into v_invoice;
  insert into demo_data_marker values ('invoices', v_invoice);

  insert into invoice_line_items (invoice_id, service_id, name, description, quantity, rate, sort_order) values
    (v_invoice, svc_seo,  'SEO', 'Technical audit and three months of optimisation', 3, 1200, 0),
    (v_invoice, svc_gads, 'Google Ads Management', 'Campaign setup and monthly management', 3, 1000, 1);

  raise notice 'Demo data loaded.';

end $$;

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
select 'contacts' as table_name, count(*) from contacts
union all select 'deals', count(*) from deals
union all select 'invoices', count(*) from invoices
union all select 'invoice_line_items', count(*) from invoice_line_items
union all select 'notes', count(*) from notes
union all select 'activity_log', count(*) from activity_log
union all select 'contact_services', count(*) from contact_services
union all select 'deal_services', count(*) from deal_services
order by table_name;
