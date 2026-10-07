import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import type { ResolvedRange } from '@/lib/date-range';
import { campaignKey } from '@/lib/meta/types';

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
  /**
   * Ad spend matched to this row, or null when none is known.
   *
   * null and 0 mean different things and must render differently: null is "we
   * have no spend data for this campaign", 0 is "it ran and cost nothing".
   * Collapsing them would turn an unsynced campaign into a free one.
   */
  spend: number | null;
  /** Cost per lead. Null when spend is unknown or no leads arrived. */
  cpl: number | null;
  /** Revenue divided by spend. Null when spend is unknown or zero. */
  roas: number | null;
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
  /** True once any ad spend overlaps the range. Gates the spend columns. */
  hasSpend: boolean;
  totalSpend: number;
  /**
   * When spend was last pulled from the ad platforms, or null if never.
   *
   * Surfaced because syncing is manual: an unlabelled ROAS figure computed
   * from three-week-old spend is more misleading than showing none at all.
   */
  spendSyncedAt: string | null;
}

/**
 * Marketing attribution: which campaigns produce leads, revenue, and return.
 *
 * Revenue is attributed to the campaign that produced the contact, summed over
 * that contact's won deals. A deal is only counted once, against the campaign
 * of its own contact.
 *
 * Spend comes from `ad_spend`, matched on the campaign key. That join is the
 * weak point and worth understanding before trusting a ROAS figure:
 *
 *   * Meta Lead Ads produce no click-through, so those contacts have no real
 *     UTM parameters. The webhook synthesises `utm_campaign` from the campaign
 *     name, and the insights sync derives `ad_spend.utm_campaign` from the same
 *     name, both through `campaignKey`. The match works only because both sides
 *     pass through that one function.
 *   * Renaming a campaign in the ad platform therefore splits its history into
 *     two rows, since old spend keeps the old key.
 *
 * The stable alternative is `contacts.meta_ad_id -> ad_spend.ad_id`; both
 * columns exist and adding it as a second matching pass is the next
 * improvement, not a rewrite.
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

  // Spend over the same period. Dates rather than timestamps, since ad_spend is
  // daily.
  let spendQuery = supabase
    .from('ad_spend')
    .select('platform, campaign_name, utm_campaign, spend');

  if (range.from) spendQuery = spendQuery.gte('spend_date', range.from.slice(0, 10));
  if (range.to) spendQuery = spendQuery.lt('spend_date', range.to.slice(0, 10));

  const { data: spendRows } = await spendQuery;

  // Which platform each row's money belongs to, in the vocabulary utm_source
  // uses — so channel spend can be matched against it.
  const PLATFORM_CHANNEL: Record<string, string> = {
    meta: 'facebook',
    google: 'google',
    linkedin: 'linkedin',
  };

  const spendByCampaign = new Map<string, number>();
  const spendByChannel = new Map<string, number>();
  let totalSpend = 0;

  for (const row of spendRows ?? []) {
    const amount = Number(row.spend);
    totalSpend += amount;

    const campaign = row.utm_campaign ?? campaignKey(row.campaign_name);
    if (campaign) {
      spendByCampaign.set(campaign, (spendByCampaign.get(campaign) ?? 0) + amount);
    }

    const channel = PLATFORM_CHANNEL[row.platform] ?? row.platform;
    spendByChannel.set(channel, (spendByChannel.get(channel) ?? 0) + amount);
  }

  /** Accumulates leads, wins, revenue, and spend under a grouping key. */
  function group(
    keyOf: (row: Row) => string | null,
    spendFor: Map<string, number>,
  ): CampaignRow[] {
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
          spend: null,
          cpl: null,
          roas: null,
        };
        map.set(key, entry);
      }

      entry.leads += 1;
      if (contact.lead_status?.is_won) entry.won += 1;
      entry.revenue += revenueByContact.get(contact.id) ?? 0;
    }

    for (const entry of map.values()) {
      // Matched case-insensitively: utm tags arrive however they were typed
      // into the ad, while campaignKey always lowercases.
      const spend = spendFor.get(entry.label.toLowerCase());
      if (spend === undefined) continue;

      entry.spend = spend;
      entry.cpl = entry.leads > 0 ? spend / entry.leads : null;
      entry.roas = spend > 0 ? entry.revenue / spend : null;
    }

    // Revenue first, then leads: a campaign that produced money outranks one
    // that produced only volume.
    return [...map.values()].sort(
      (a, b) => b.revenue - a.revenue || b.leads - a.leads,
    );
  }

  const byChannel = group((row) => row.utm_source, spendByChannel);
  const byCampaign = group((row) => row.utm_campaign ?? row.utm_source, spendByCampaign);
  const untracked = contacts.filter((row) => !row.utm_source).length;

  // When spend was last pulled. Not period-bound: it describes the freshness of
  // the numbers, not the period they cover.
  const { data: synced } = await supabase
    .from('ad_credentials')
    .select('last_synced_at')
    .not('last_synced_at', 'is', null)
    .order('last_synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    byChannel,
    byCampaign,
    untracked,
    hasData: byChannel.length > 0,
    hasSpend: totalSpend > 0,
    totalSpend,
    spendSyncedAt: synced?.last_synced_at ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Time series                                                                 */
/* -------------------------------------------------------------------------- */

export interface TimePoint {
  /** ISO date at the start of the bucket. */
  date: string;
  /** Short display label, e.g. "12 Aug". */
  label: string;
  leads: number;
  revenue: number;
}

/**
 * Leads and closed revenue bucketed over the selected range.
 *
 * Buckets are chosen from the span so the chart never renders 90 unreadable
 * daily ticks: up to 31 days is daily, beyond that weekly. Empty buckets are
 * emitted with zeroes rather than skipped — a gap in a time series must read
 * as "nothing happened", not as missing data.
 *
 * Leads count by `created_at`; revenue sums won deals by `closed_at`, matching
 * how the headline figures are computed.
 */
export async function getTimeSeries(
  supabase: SupabaseClient<Database>,
  range: ResolvedRange,
): Promise<{ points: TimePoint[]; bucket: 'day' | 'week' }> {
  const to = range.to ? new Date(range.to) : new Date();
  // All-time has no lower bound; 90 days keeps the chart readable.
  const from = range.from
    ? new Date(range.from)
    : new Date(to.getTime() - 90 * 864e5);

  const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 864e5));
  const bucket: 'day' | 'week' = spanDays <= 31 ? 'day' : 'week';
  const stepMs = bucket === 'day' ? 864e5 : 7 * 864e5;

  const [contactsResult, dealsResult] = await Promise.all([
    supabase
      .from('contacts')
      .select('created_at')
      .gte('created_at', from.toISOString())
      .lt('created_at', to.toISOString()),
    supabase
      .from('deals')
      .select('value, closed_at')
      .eq('status', 'won')
      .gte('closed_at', from.toISOString())
      .lt('closed_at', to.toISOString()),
  ]);

  // Pre-seed every bucket so gaps render as zero rather than vanishing.
  const points: TimePoint[] = [];
  const index = new Map<number, TimePoint>();

  const formatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

  for (let t = from.getTime(); t < to.getTime(); t += stepMs) {
    const date = new Date(t);
    const point: TimePoint = {
      date: date.toISOString(),
      label: formatter.format(date),
      leads: 0,
      revenue: 0,
    };
    points.push(point);
    index.set(Math.floor((t - from.getTime()) / stepMs), point);
  }

  const bucketFor = (iso: string) => {
    const offset = new Date(iso).getTime() - from.getTime();
    return index.get(Math.floor(offset / stepMs));
  };

  for (const contact of contactsResult.data ?? []) {
    const point = bucketFor(contact.created_at);
    if (point) point.leads += 1;
  }

  for (const deal of dealsResult.data ?? []) {
    if (!deal.closed_at) continue;
    const point = bucketFor(deal.closed_at);
    if (point) point.revenue += Number(deal.value);
  }

  return { points, bucket };
}

/* -------------------------------------------------------------------------- */
/* Meta funnel                                                                 */
/* -------------------------------------------------------------------------- */

export interface MetaFunnelMetrics {
  impressions: number;
  clicks: number;
  /** Leads Meta itself counted — form submissions on its side. */
  platformLeads: number;
  /** Contacts in the CRM sourced from Meta Lead Ads. */
  crmLeads: number;
  won: number;
  spend: number;
  /** False when there is nothing to show, so the panel can stay hidden. */
  hasData: boolean;
}

/**
 * The Meta funnel, from impressions through to won business.
 *
 * Deliberately reports Meta's own lead count alongside the CRM's rather than
 * picking one. They measure different things — Meta counts form submissions,
 * the CRM counts contacts that survived deduplication — and a gap between them
 * is a signal worth seeing: it usually means a webhook delivery was missed,
 * which is exactly what the Backfill button exists to repair.
 */
export async function getMetaFunnel(
  supabase: SupabaseClient<Database>,
  range: ResolvedRange,
): Promise<MetaFunnelMetrics> {
  let spendQuery = supabase
    .from('ad_spend')
    .select('impressions, clicks, platform_leads, spend')
    .eq('platform', 'meta');

  if (range.from) spendQuery = spendQuery.gte('spend_date', range.from.slice(0, 10));
  if (range.to) spendQuery = spendQuery.lt('spend_date', range.to.slice(0, 10));

  // Scoped by lead source slug rather than by utm_source: the slug is the
  // contract, and a Lead Ads contact is identified by where it came from, not
  // by a tag that could have been set by anything.
  let leadQuery = supabase
    .from('contacts')
    .select('id, lead_source:lead_sources!inner(slug), lead_status:lead_statuses(is_won)')
    .eq('lead_sources.slug', 'meta_lead_ads');

  if (range.from) leadQuery = leadQuery.gte('created_at', range.from);
  if (range.to) leadQuery = leadQuery.lt('created_at', range.to);

  const [{ data: spendRows }, { data: leadRows }] = await Promise.all([
    spendQuery,
    leadQuery,
  ]);

  let impressions = 0;
  let clicks = 0;
  let platformLeads = 0;
  let spend = 0;

  for (const row of spendRows ?? []) {
    impressions += Number(row.impressions);
    clicks += Number(row.clicks);
    platformLeads += Number(row.platform_leads);
    spend += Number(row.spend);
  }

  type LeadRow = { lead_status: { is_won: boolean } | null };
  const leads = (leadRows ?? []) as unknown as LeadRow[];
  const won = leads.filter((lead) => lead.lead_status?.is_won).length;

  return {
    impressions,
    clicks,
    platformLeads,
    crmLeads: leads.length,
    won,
    spend,
    hasData: impressions > 0 || leads.length > 0,
  };
}
