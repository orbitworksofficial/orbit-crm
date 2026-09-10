/**
 * Loads the demo dataset through the service-role key.
 *
 * Mirrors supabase/seed_demo.sql, but goes through PostgREST rather than raw
 * SQL so it works without a Supabase CLI session. All dates are relative to
 * now(), so every dashboard filter has something to show.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is missing from .env.local.');
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const days = n => new Date(Date.now() - n * 864e5).toISOString();
const dateOnly = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// --- Reference data -------------------------------------------------------
const { data: org } = await db.from('organizations').select('id').order('created_at').limit(1).single();
const { data: profiles } = await db.from('profiles').select('id, role').eq('is_active', true).order('created_at');
const admin = profiles.find(p => p.role === 'admin')?.id;
const sales = profiles.find(p => p.role === 'sales')?.id ?? admin;
if (!org || !admin) { console.error('Missing organization or admin profile.'); process.exit(1); }

const { data: statuses } = await db.from('lead_statuses').select('id, slug').eq('organization_id', org.id);
const { data: sources } = await db.from('lead_sources').select('id, slug').eq('organization_id', org.id);
const { data: services } = await db.from('services').select('id, name, default_rate').eq('organization_id', org.id).order('sort_order');

const S = Object.fromEntries(statuses.map(s => [s.slug, s.id]));
const SRC = Object.fromEntries(sources.map(s => [s.slug, s.id]));
const svc = i => services[Math.min(i, services.length - 1)];

// --- Contacts -------------------------------------------------------------
// Spread across the funnel with a realistic taper, and across the last ~80 days
// so Today / This Week / Last 30 / Last 90 all populate.
const CONTACTS = [
  { full_name:'Sarah Whitfield', email:'sarah.w@meridianproperty.ae', whatsapp_number:'+971 50 442 1187',
    company_name:'Meridian Property Group', industry:'Real Estate', city:'Dubai', country:'United Arab Emirates',
    lead_source_id:SRC.referral, lead_status_id:S.won, assigned_to:admin, created_at:days(74), svc:[0,1,3] },
  { full_name:'Daniel Osei', email:'d.osei@northgatelogistics.com', whatsapp_number:'+44 7700 900413',
    company_name:'Northgate Logistics', industry:'Transport & Logistics', city:'Manchester', country:'United Kingdom',
    lead_source_id:SRC.google_ads, lead_status_id:S.won, assigned_to:sales, created_at:days(58),
    utm_source:'google', utm_medium:'cpc', utm_campaign:'uk-logistics-q2', svc:[12,1] },
  { full_name:'Priya Raman', email:'priya@calderfinch.co', company_name:'Calder & Finch',
    industry:'Legal Services', city:'Singapore', country:'Singapore',
    lead_source_id:SRC.linkedin, lead_status_id:S.won, assigned_to:admin, created_at:days(21),
    utm_source:'linkedin', utm_medium:'social', utm_campaign:'apac-legal', svc:[8,0] },
  { full_name:'Fiona Alexander', email:'fiona@ridgewayconsulting.com', whatsapp_number:'+1 312 555 0198',
    company_name:'Ridgeway Consulting', industry:'Professional Services', city:'Chicago', country:'United States',
    lead_source_id:SRC.referral, lead_status_id:S.won, assigned_to:sales, created_at:days(15), svc:[0,3] },
  { full_name:'Marcus Bell', email:'marcus.bell@harborview.com', whatsapp_number:'+1 415 555 0176',
    company_name:'Harborview Retail', industry:'Retail & E-Commerce', city:'San Francisco', country:'United States',
    lead_source_id:SRC.referral, lead_status_id:S.proposal_sent, assigned_to:admin, created_at:days(18), svc:[2,4,3] },
  { full_name:'Aisha Karim', email:'aisha@lumenclinics.ae', whatsapp_number:'+971 55 318 2204',
    company_name:'Lumen Clinics', industry:'Healthcare', city:'Abu Dhabi', country:'United Arab Emirates',
    lead_source_id:SRC.meta_ads, lead_status_id:S.in_discussion, assigned_to:sales, created_at:days(11),
    utm_source:'facebook', utm_medium:'paid_social', utm_campaign:'uae-health-q3', svc:[6,0] },
  { full_name:'Mei Chen', email:'mei.chen@lanterntravel.sg', whatsapp_number:'+65 8123 4477',
    company_name:'Lantern Travel', industry:'Travel & Tourism', city:'Singapore', country:'Singapore',
    lead_source_id:SRC.google_ads, lead_status_id:S.in_discussion, assigned_to:admin, created_at:days(9),
    utm_source:'google', utm_medium:'cpc', utm_campaign:'apac-travel', svc:[3,4] },
  { full_name:'Tom Bradbury', email:'tom@stonebridgefit.co.uk', company_name:'Stonebridge Fitness',
    industry:'Health & Fitness', city:'Leeds', country:'United Kingdom',
    lead_source_id:SRC.google_ads, lead_status_id:S.contacted, assigned_to:sales, created_at:days(6),
    utm_source:'google', utm_medium:'cpc', utm_campaign:'uk-fitness-q3', svc:[0] },
  { full_name:'Nadia Haddad', email:'nadia@pulsemedia.co', whatsapp_number:'+961 3 555 224',
    company_name:'Pulse Media', industry:'Marketing & Advertising', city:'Beirut', country:'Lebanon',
    lead_source_id:SRC.referral, lead_status_id:S.contacted, assigned_to:admin, created_at:days(5), svc:[12] },
  { full_name:'Luca Ferrari', email:'luca@borgocoffee.it', whatsapp_number:'+39 340 555 1188',
    company_name:'Borgo Coffee Roasters', industry:'Food & Beverage', city:'Milan', country:'Italy',
    lead_source_id:SRC.website_form, lead_status_id:S.contacted, assigned_to:sales, created_at:days(4), svc:[2,8] },
  { full_name:'Grace Mitchell', email:'grace@atlaseducation.org', company_name:'Atlas Education',
    industry:'Education', city:'Melbourne', country:'Australia',
    lead_source_id:SRC.meta_ads, lead_status_id:S.new, assigned_to:sales, created_at:days(3),
    utm_source:'facebook', utm_medium:'paid_social', utm_campaign:'edu-au-spring', svc:[6] },
  { full_name:'Oliver Grant', email:'oliver@kestrelarch.co.uk', company_name:'Kestrel Architects',
    industry:'Architecture', city:'Bristol', country:'United Kingdom',
    lead_source_id:SRC.cold_outreach, lead_status_id:S.new, assigned_to:sales, created_at:days(2), svc:[0] },
  { full_name:'Hassan Al-Rashid', email:'hassan@dunesrealty.ae', whatsapp_number:'+971 52 774 9903',
    company_name:'Dunes Realty', industry:'Real Estate', city:'Sharjah', country:'United Arab Emirates',
    lead_source_id:SRC.website_form, lead_status_id:S.new, assigned_to:null, created_at:days(1),
    utm_source:'linkedin', utm_medium:'social', utm_campaign:'q3-content', svc:[1,4] },
  { full_name:'Rebecca Lyle', email:'rebecca@northshoredental.ca', whatsapp_number:'+1 604 555 0142',
    company_name:'Northshore Dental', industry:'Healthcare', city:'Vancouver', country:'Canada',
    lead_source_id:SRC.website_form, lead_status_id:S.new, assigned_to:null, created_at:days(0.2),
    utm_source:'google', utm_medium:'organic', svc:[0,3] },
  { full_name:'James Okonkwo', email:'j.okonkwo@vertexfin.com', company_name:'Vertex Financial',
    industry:'Financial Services', city:'Lagos', country:'Nigeria',
    lead_source_id:SRC.linkedin, lead_status_id:S.on_hold, assigned_to:admin, created_at:days(37), svc:[12,8] },
  { full_name:'Elena Vasquez', email:'elena@terracottastudio.es', company_name:'Terracotta Studio',
    industry:'Hospitality', city:'Barcelona', country:'Spain',
    lead_source_id:SRC.cold_outreach, lead_status_id:S.lost, assigned_to:sales, created_at:days(52), svc:[0] },
];

const inserted = [];
for (const c of CONTACTS) {
  const { svc: svcIdx, ...row } = c;
  const { data, error } = await db.from('contacts')
    .insert({ ...row, organization_id: org.id, created_by: admin })
    .select('id').single();
  if (error) { console.error('contact', c.full_name, error.message); continue; }
  inserted.push({ id: data.id, name: c.full_name, svc: svcIdx });
  if (svcIdx?.length) {
    await db.from('contact_services').insert(svcIdx.map(i => ({ contact_id: data.id, service_id: svc(i).id })));
  }
}
console.log('contacts:', inserted.length);

const byName = n => inserted.find(c => c.name === n)?.id;

// --- Deals ----------------------------------------------------------------
const DEALS = [
  { contact:'Sarah Whitfield', title:'Website rebuild and SEO retainer', value:19500, status:'won',
    closed_at:days(70), expected_close_date:dateOnly(72), assigned_to:admin, created_at:days(88), svc:[0,1,3] },
  { contact:'Daniel Osei', title:'Driver portal build', value:14800, status:'won',
    closed_at:days(50), expected_close_date:dateOnly(53), assigned_to:sales, created_at:days(68), svc:[12] },
  { contact:'Priya Raman', title:'Brand identity refresh', value:7200, status:'won',
    closed_at:days(12), expected_close_date:dateOnly(13), assigned_to:admin, created_at:days(19), svc:[8] },
  { contact:'Fiona Alexander', title:'Corporate site and SEO foundation', value:9800, status:'won',
    closed_at:days(4), expected_close_date:dateOnly(6), assigned_to:sales, created_at:days(14), svc:[0,3] },
  { contact:'Marcus Bell', title:'Shopify Plus migration and ads retainer', value:31000, status:'open',
    expected_close_date:dateOnly(-18), assigned_to:admin, created_at:days(16), svc:[2,4] },
  { contact:'Aisha Karim', title:'Clinic website and social management', value:12400, status:'open',
    expected_close_date:dateOnly(-30), assigned_to:sales, created_at:days(10), svc:[6,0] },
  { contact:'Mei Chen', title:'Travel SEO and paid search', value:8600, status:'open',
    expected_close_date:dateOnly(-25), assigned_to:admin, created_at:days(8), svc:[3,4] },
  { contact:'Elena Vasquez', title:'Restaurant group website', value:8400, status:'lost',
    closed_at:days(44), expected_close_date:dateOnly(46), assigned_to:sales, created_at:days(50), svc:[0] },
];

const dealIds = {};
for (const d of DEALS) {
  const contact_id = byName(d.contact);
  if (!contact_id) continue;
  const { svc: svcIdx, contact: _c, ...row } = d;
  void _c;
  const { data, error } = await db.from('deals')
    .insert({ ...row, contact_id, organization_id: org.id, created_by: admin })
    .select('id').single();
  if (error) { console.error('deal', d.title, error.message); continue; }
  dealIds[d.title] = data.id;
  if (svcIdx?.length) {
    await db.from('deal_services').insert(svcIdx.map(i => ({ deal_id: data.id, service_id: svc(i).id })));
  }
}
console.log('deals:', Object.keys(dealIds).length);

// --- Notes ----------------------------------------------------------------
const NOTES = [
  ['Sarah Whitfield','Referred by Tom at Alcove Interiors. Re-platforming from an ageing WordPress site. Budget signalled around $18-22k.',88],
  ['Sarah Whitfield','Discovery call done. Idris in ops is the one to convince - he has been burned by an agency before.',82],
  ['Sarah Whitfield','Signed the full rebuild after the performance audit. Current site scores 31 on mobile.',70],
  ['Daniel Osei','Inbound from Google Ads. Needs a driver-facing portal - running the whole fleet on spreadsheets.',68],
  ['Daniel Osei','Won. Their finance team is slow to pay - worth watching the invoice.',50],
  ['Priya Raman','Found us through the LinkedIn case study. Six partners, wants to look less like a 2011 law firm.',21],
  ['Fiona Alexander','Referred by Sarah at Meridian. Quickest turnaround we have had - referral trust did the selling.',5],
  ['Marcus Bell','Proposal sent: Shopify Plus migration at $31,000 plus a $2,500/mo ads retainer. Goes to their board.',6],
  ['Aisha Karim','Three clinics, opening a fourth. Sensitive to healthcare advertising rules - needs compliance review.',4],
  ['Mei Chen','Wants to reduce reliance on OTA bookings. Focused on direct-booking keywords.',7],
  ['Tom Bradbury','Left a voicemail and emailed. Two gyms, wants a members area. Mentioned "a few thousand".',3],
  ['Elena Vasquez','Went with a local freelancer at a third of our quote. Worth revisiting in six months.',44],
  ['James Okonkwo','Budget frozen until their funding round closes. Asked us to check back rather than saying no.',20],
];
let noteCount = 0;
for (const [name, body, ago] of NOTES) {
  const contact_id = byName(name);
  if (!contact_id) continue;
  const { error } = await db.from('notes').insert({
    contact_id, organization_id: org.id, body, author_id: admin, created_at: days(ago),
  });
  if (!error) noteCount++;
}

// Next-action reminders
const REMINDERS = [
  ['Marcus Bell','Follow up after the board meeting', 4],
  ['Aisha Karim','Send the healthcare compliance one-pager', 2],
  ['Tom Bradbury','Second call attempt', 1],
  ['James Okonkwo','Check in on funding round', 25],
];
for (const [name, action, inDays] of REMINDERS) {
  const contact_id = byName(name);
  if (!contact_id) continue;
  const { error } = await db.from('notes').insert({
    contact_id, organization_id: org.id,
    body: `Next step agreed.`,
    next_action_at: new Date(Date.now() + inDays * 864e5).toISOString().slice(0, 10),
    next_action_description: action,
    author_id: admin, created_at: days(1),
  });
  if (!error) noteCount++;
}
console.log('notes:', noteCount);

// --- Invoices -------------------------------------------------------------
async function nextNumber() {
  const { data } = await db.rpc('next_invoice_number', { p_organization_id: org.id });
  return data;
}

const INVOICES = [
  { contact:'Sarah Whitfield', deal:'Website rebuild and SEO retainer', status:'paid',
    issue:42, due:12, paid:18, tax:5, terms:'Net 30', notes:'Phase 1 of 2. Bank transfer received with thanks.',
    items:[[0,'Web Design','UI design across 14 page templates',1,6500],[1,'Web Development','Front-end build and CMS integration, phase 1',1,4000]] },
  { contact:'Sarah Whitfield', deal:'Website rebuild and SEO retainer', status:'sent',
    issue:6, due:-24, tax:5, terms:'Net 30', notes:'Phase 2 of 2, plus first quarter of the SEO retainer.',
    items:[[1,'Web Development','Front-end build, phase 2 and launch',1,5400],[3,'SEO','Technical SEO and content optimisation, monthly',3,1200]] },
  { contact:'Daniel Osei', deal:'Driver portal build', status:'sent',
    issue:48, due:18, tax:0, terms:'Net 30', notes:'Chased twice. Third reminder due.',
    items:[[12,'Custom Software','Driver portal - scheduling, documents, two user roles',1,14800]] },
  { contact:'Priya Raman', deal:'Brand identity refresh', status:'paid',
    issue:11, due:-4, paid:3, tax:0, terms:'Net 15',
    items:[[8,'Branding and Identity','Logo, type system, colour, and a 24-page brand guide',1,7200]] },
  { contact:'Fiona Alexander', deal:'Corporate site and SEO foundation', status:'sent',
    issue:3, due:-27, tax:0, terms:'Net 30',
    items:[[0,'Web Design','Eight-page corporate site, design and build',1,8000],[3,'SEO','Technical foundation and keyword mapping',1,1800]] },
  { contact:'Mei Chen', status:'draft',
    issue:0, due:-30, tax:5, terms:'Net 30', notes:'Draft pending scope confirmation - do not send yet.',
    items:[[3,'SEO','Technical audit and three months of optimisation',3,1200],[4,'Google Ads Management','Campaign setup and monthly management',3,1000]] },
];

let invCount = 0;
for (const inv of INVOICES) {
  const contact_id = byName(inv.contact);
  if (!contact_id) continue;
  const invoice_number = await nextNumber();
  const { data, error } = await db.from('invoices').insert({
    organization_id: org.id, contact_id,
    deal_id: inv.deal ? dealIds[inv.deal] ?? null : null,
    invoice_number, status: inv.status,
    issue_date: dateOnly(inv.issue), due_date: dateOnly(inv.due),
    paid_at: inv.paid != null ? days(inv.paid) : null,
    tax_rate: inv.tax, payment_terms: inv.terms, notes: inv.notes ?? null,
    created_by: admin, created_at: days(inv.issue),
  }).select('id').single();
  if (error) { console.error('invoice', invoice_number, error.message); continue; }
  await db.from('invoice_line_items').insert(
    inv.items.map(([i, name, description, quantity, rate], idx) => ({
      invoice_id: data.id, service_id: svc(i).id, name, description, quantity, rate, sort_order: idx,
    })));
  invCount++;
}
console.log('invoices:', invCount);

// --- Summary --------------------------------------------------------------
console.log('\n--- verification ---');
for (const t of ['contacts','deals','invoices','invoice_line_items','notes','contact_services','deal_services','activity_log']) {
  const { count } = await db.from(t).select('*', { count:'exact', head:true });
  console.log(`  ${t.padEnd(20)} ${count}`);
}
