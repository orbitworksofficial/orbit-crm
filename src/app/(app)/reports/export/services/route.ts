import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth';
import { toCsv, csvResponse, datedFilename } from '@/lib/csv';
import { resolveDateRange, parsePreset } from '@/lib/date-range';

/**
 * Service report CSV export (brief §07): which services generate the most leads
 * and the most revenue.
 *
 * Lead counts come from contact tags; revenue comes from won deals tagged with
 * each service. A deal spanning several services contributes its full value to
 * each, so the revenue column sums to more than total revenue when deals are
 * multi-service — this is stated in the CSV header for clarity.
 */

interface ServiceAggregate {
  name: string;
  leads: number;
  wonDeals: number;
  revenue: number;
}

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const range = resolveDateRange(
    parsePreset(searchParams.get('range') ?? undefined),
    searchParams.get('from') ?? undefined,
    searchParams.get('to') ?? undefined,
  );

  const supabase = await createClient();

  // Leads tagged per service, within the period.
  let contactsQuery = supabase
    .from('contacts')
    .select('id, created_at, contact_services(service:services(id, name))');
  if (range.from) contactsQuery = contactsQuery.gte('created_at', range.from);
  if (range.to) contactsQuery = contactsQuery.lt('created_at', range.to);

  // Won deals tagged per service, by close date.
  let dealsQuery = supabase
    .from('deals')
    .select('id, value, closed_at, deal_services(service:services(id, name))')
    .eq('status', 'won');
  if (range.from) dealsQuery = dealsQuery.gte('closed_at', range.from);
  if (range.to) dealsQuery = dealsQuery.lt('closed_at', range.to);

  const [contactsResult, dealsResult] = await Promise.all([contactsQuery, dealsQuery]);

  if (contactsResult.error || dealsResult.error) {
    const message = contactsResult.error?.message ?? dealsResult.error?.message;
    return new Response(`Could not build the export: ${message}`, { status: 500 });
  }

  type TaggedRow = { service: { id: string; name: string } | null };
  const contactRows = (contactsResult.data ?? []) as unknown as {
    contact_services: TaggedRow[] | null;
  }[];
  const dealRows = (dealsResult.data ?? []) as unknown as {
    value: number;
    deal_services: TaggedRow[] | null;
  }[];

  const aggregates = new Map<string, ServiceAggregate>();

  function ensure(name: string): ServiceAggregate {
    let entry = aggregates.get(name);
    if (!entry) {
      entry = { name, leads: 0, wonDeals: 0, revenue: 0 };
      aggregates.set(name, entry);
    }
    return entry;
  }

  for (const contact of contactRows) {
    for (const tag of contact.contact_services ?? []) {
      if (tag.service) ensure(tag.service.name).leads += 1;
    }
  }

  for (const deal of dealRows) {
    for (const tag of deal.deal_services ?? []) {
      if (tag.service) {
        const entry = ensure(tag.service.name);
        entry.wonDeals += 1;
        entry.revenue += Number(deal.value);
      }
    }
  }

  const rows = [...aggregates.values()].sort((a, b) => b.leads - a.leads);

  const csv = toCsv<ServiceAggregate>(
    [
      { header: 'Service', accessor: (row) => row.name },
      { header: 'Leads', accessor: (row) => row.leads },
      { header: 'Won deals', accessor: (row) => row.wonDeals },
      {
        header: 'Revenue (multi-service deals counted in full per service)',
        accessor: (row) => row.revenue.toFixed(2),
      },
    ],
    rows,
  );

  return csvResponse(csv, datedFilename('service-report'));
}
