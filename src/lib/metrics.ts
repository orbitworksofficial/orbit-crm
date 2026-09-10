import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import type { ResolvedRange } from '@/lib/date-range';

/**
 * Dashboard and report metrics (brief §05, §07).
 *
 * Every figure is computed from Supabase in real time — no external analytics
 * service, per the brief. All queries run through the caller's session client,
 * so a sales user's dashboard automatically reflects only their own records.
 */

export interface DashboardMetrics {
  totalLeads: number;
  leadsBySource: { label: string; count: number }[];
  leadsByService: { label: string; count: number }[];
  leadsByStatus: { label: string; count: number; isWon: boolean; isLost: boolean }[];
  revenue: number;
  wonDeals: number;
  openDeals: number;
  openPipelineValue: number;
  /** Leads in a won status. Numerator of the conversion rate. */
  wonLeads: number;
  conversionRate: number;
  topSource: { label: string; count: number } | null;
}

/** Groups rows by a key, returning counts sorted high to low. */
function tally(labels: (string | null | undefined)[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const label of labels) {
    const key = label ?? 'Unspecified';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Loads every dashboard metric for a date range.
 *
 * Leads are counted by `contacts.created_at`; revenue is summed over deals by
 * `closed_at`, so a deal created in one period and won in another is counted as
 * revenue in the period it actually closed.
 */
export async function getDashboardMetrics(
  supabase: SupabaseClient<Database>,
  range: ResolvedRange,
): Promise<DashboardMetrics> {
  // --- Contacts in range ----------------------------------------------------
  let contactsQuery = supabase.from('contacts').select(
    `id,
     lead_source:lead_sources(name),
     lead_status:lead_statuses(name, is_won, is_lost),
     contact_services(service:services(name))`,
  );

  if (range.from) contactsQuery = contactsQuery.gte('created_at', range.from);
  if (range.to) contactsQuery = contactsQuery.lt('created_at', range.to);

  // --- Deals: won in range (by close date) ---------------------------------
  let wonDealsQuery = supabase.from('deals').select('id, value').eq('status', 'won');
  if (range.from) wonDealsQuery = wonDealsQuery.gte('closed_at', range.from);
  if (range.to) wonDealsQuery = wonDealsQuery.lt('closed_at', range.to);

  // --- Deals: currently open (a pipeline snapshot, not period-bound) --------
  const openDealsQuery = supabase.from('deals').select('id, value').eq('status', 'open');

  const [contactsResult, wonResult, openResult] = await Promise.all([
    contactsQuery,
    wonDealsQuery,
    openDealsQuery,
  ]);

  type ContactMetricRow = {
    id: string;
    lead_source: { name: string } | null;
    lead_status: { name: string; is_won: boolean; is_lost: boolean } | null;
    contact_services: { service: { name: string } | null }[] | null;
  };

  const contacts = (contactsResult.data ?? []) as unknown as ContactMetricRow[];
  const wonDeals = wonResult.data ?? [];
  const openDeals = openResult.data ?? [];

  const totalLeads = contacts.length;

  const leadsBySource = tally(contacts.map((contact) => contact.lead_source?.name));

  // A contact tagged with several services counts once per service, so the
  // chart answers "how often is each service requested".
  const serviceLabels = contacts.flatMap(
    (contact) => contact.contact_services?.map((row) => row.service?.name) ?? [],
  );
  const leadsByService = tally(serviceLabels);

  const statusCounts = new Map<string, { count: number; isWon: boolean; isLost: boolean }>();
  for (const contact of contacts) {
    const name = contact.lead_status?.name ?? 'Unspecified';
    const existing = statusCounts.get(name);
    if (existing) {
      existing.count += 1;
    } else {
      statusCounts.set(name, {
        count: 1,
        isWon: contact.lead_status?.is_won ?? false,
        isLost: contact.lead_status?.is_lost ?? false,
      });
    }
  }
  const leadsByStatus = [...statusCounts.entries()]
    .map(([label, value]) => ({ label, ...value }))
    .sort((a, b) => b.count - a.count);

  const revenue = wonDeals.reduce((sum, deal) => sum + Number(deal.value), 0);
  const openPipelineValue = openDeals.reduce((sum, deal) => sum + Number(deal.value), 0);

  // Conversion rate per the brief: leads that reached a Won status, over total
  // leads in the period. Reads the is_won flag rather than a hardcoded name, so
  // renaming statuses in Settings cannot break it.
  const wonLeads = contacts.filter((contact) => contact.lead_status?.is_won).length;
  const conversionRate = totalLeads > 0 ? (wonLeads / totalLeads) * 100 : 0;

  return {
    totalLeads,
    leadsBySource,
    leadsByService,
    leadsByStatus,
    revenue,
    wonDeals: wonDeals.length,
    openDeals: openDeals.length,
    openPipelineValue,
    wonLeads,
    conversionRate,
    topSource: leadsBySource[0] ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Campaign attribution                                                        */
/* -------------------------------------------------------------------------- */

export interface CampaignRow {
  /** utm_campaign, or the channel name when a lead carried no campaign tag. */
  label: string;
  channel: string;
  leads: number;
  won: number;
  revenue: number;
}

export interface AttributionMetrics {
  /** Leads grouped by utm_source — the acquisition channel. */
  byChannel: CampaignRow[];
  /** Leads grouped by utm_campaign, best performers first. */
  byCampaign: CampaignRow[];
  /** Leads in the period carrying no utm_source at all. */
  untracked: number;
  /** True once any lead has ever carried a utm_source. Gates the whole panel. */
  hasData: boolean;
}

/**
 * Marketing attribution from the UTM tags captured on each contact.
 *
 * This is the Phase 1 half of the brief's Phase 2 "Ad Platform Integration":
 * it answers *which campaigns produce leads and revenue* using data the website
 * form already sends. What it cannot show is **spend**, and therefore ROAS —
 * those require pulling from the Meta and Google Ads APIs, which is Phase 2.
 *
 * Revenue is attributed to the campaign that produced the contact, summed over
 * that contact's won deals. A deal is only counted once, against the campaign
 * of its own contact.
 */
export async function getAttributionMetrics(
  supabase: SupabaseClient<Database>,
  range: ResolvedRange,
): Promise<AttributionMetrics> {
  let query = supabase
    .from('contacts')
    .select('id, utm_source, utm_medium, utm_campaign, lead_status:lead_statuses(is_won)');

  if (range.from) query = query.gte('created_at', range.from);
  if (range.to) query = query.lt('created_at', range.to);

  const { data } = await query;

  type Row = {
    id: string;
    utm_source: string | null;
    utm_campaign: string | null;
    lead_status: { is_won: boolean } | null;
  };
  const contacts = (data ?? []) as unknown as Row[];

  // Revenue for these contacts, from deals that actually closed won. Fetched in
  // one query keyed by contact rather than per row.
  const contactIds = contacts.map((c) => c.id);
  const revenueByContact = new Map<string, number>();

  if (contactIds.length > 0) {
    const { data: deals } = await supabase
      .from('deals')
      .select('contact_id, value')
      .eq('status', 'won')
      .in('contact_id', contactIds);

    for (const deal of deals ?? []) {
      revenueByContact.set(
        deal.contact_id,
        (revenueByContact.get(deal.contact_id) ?? 0) + Number(deal.value),
      );
    }
  }

  /** Accumulates leads, wins, and revenue under a grouping key. */
  function group(keyOf: (row: Row) => string | null): CampaignRow[] {
    const map = new Map<string, CampaignRow>();

    for (const contact of contacts) {
      const key = keyOf(contact);
      if (!key) continue;

      let entry = map.get(key);
      if (!entry) {
        entry = {
          label: key,
          channel: contact.utm_source ?? 'Unknown',
          leads: 0,
          won: 0,
          revenue: 0,
        };
        map.set(key, entry);
      }

      entry.leads += 1;
      if (contact.lead_status?.is_won) entry.won += 1;
      entry.revenue += revenueByContact.get(contact.id) ?? 0;
    }

    // Revenue first, then leads: a campaign that produced money outranks one
    // that produced only volume.
    return [...map.values()].sort(
      (a, b) => b.revenue - a.revenue || b.leads - a.leads,
    );
  }

  const byChannel = group((row) => row.utm_source);
  const byCampaign = group((row) => row.utm_campaign ?? row.utm_source);
  const untracked = contacts.filter((row) => !row.utm_source).length;

  return {
    byChannel,
    byCampaign,
    untracked,
    hasData: byChannel.length > 0,
  };
}
