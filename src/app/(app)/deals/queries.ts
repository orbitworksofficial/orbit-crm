import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, DealStatus } from '@/lib/supabase/database.types';
import { resolveDateRange, parsePreset } from '@/lib/date-range';

const DEAL_STATUSES: DealStatus[] = ['open', 'won', 'lost'];

/** Type guard narrowing an arbitrary query-string value to a deal status. */
function isDealStatus(value: string): value is DealStatus {
  return (DEAL_STATUSES as string[]).includes(value);
}

/**
 * Query construction for the deals list, shared by the table and CSV export so
 * the two can never disagree about what "the current view" means.
 */

export type DealListFilters = {
  q?: string;
  status?: string;
  service?: string;
  assignee?: string;
  range?: string;
  from?: string;
  to?: string;
  [key: string]: string | undefined;
};

const DEAL_SELECT = `id, title, value, currency, status, expected_close_date, closed_at, created_at,
   contact:contacts!deals_contact_id_fkey(id, full_name, company_name),
   assignee:profiles!deals_assigned_to_fkey(id, full_name)`;

export function buildDealsQuery(
  supabase: SupabaseClient<Database>,
  filters: DealListFilters,
  options: { count?: boolean } = {},
) {
  const select = filters.service
    ? `${DEAL_SELECT}, deal_services!inner(service_id)`
    : DEAL_SELECT;

  let query = supabase
    .from('deals')
    .select(select, options.count ? { count: 'exact' } : undefined);

  if (filters.service) {
    query = query.eq('deal_services.service_id', filters.service);
  }

  if (filters.q) {
    const term = filters.q.replace(/[,()]/g, ' ').trim();
    if (term) query = query.ilike('title', `%${term}%`);
  }

  // Narrow the raw query-string value to a real enum member before it reaches
  // the query; an unrecognised value is ignored rather than erroring.
  if (filters.status && isDealStatus(filters.status)) {
    query = query.eq('status', filters.status);
  }
  if (filters.assignee) query = query.eq('assigned_to', filters.assignee);

  if (filters.range) {
    const range = resolveDateRange(parsePreset(filters.range), filters.from, filters.to);
    if (range.from) query = query.gte('created_at', range.from);
    if (range.to) query = query.lt('created_at', range.to);
  }

  return query;
}

export function hasActiveDealFilters(filters: DealListFilters): boolean {
  return Boolean(
    filters.q || filters.status || filters.service || filters.assignee || filters.range,
  );
}
