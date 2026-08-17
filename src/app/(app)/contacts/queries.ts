import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { resolveDateRange, parsePreset } from '@/lib/date-range';

/**
 * Query construction for the contacts list.
 *
 * Kept separate from the page so the filter set is defined once and reused by
 * both the table and the CSV export, which must always agree.
 */

/**
 * Declared as a type alias with an index signature so it can be passed directly
 * to components that accept `Record<string, string | undefined>` (pagination
 * and sortable headers, which carry the whole filter set across links).
 */
export type ContactListFilters = {
  q?: string;
  source?: string;
  status?: string;
  service?: string;
  assignee?: string;
  range?: string;
  from?: string;
  to?: string;
  [key: string]: string | undefined;
};

const CONTACT_SELECT = `id, full_name, email, whatsapp_number, company_name, industry, city, country, created_at,
   lead_source:lead_sources(id, name),
   lead_status:lead_statuses(id, name, slug, is_won, is_lost),
   assignee:profiles!contacts_assigned_to_fkey(id, full_name)`;

/**
 * Builds the filtered contacts query.
 *
 * When a service filter is present the embed becomes an inner join so it
 * restricts the result set; otherwise no join is needed at all.
 */
export function buildContactsQuery(
  supabase: SupabaseClient<Database>,
  filters: ContactListFilters,
  options: { count?: boolean } = {},
) {
  const select = filters.service
    ? `${CONTACT_SELECT}, contact_services!inner(service_id)`
    : CONTACT_SELECT;

  let query = supabase
    .from('contacts')
    .select(select, options.count ? { count: 'exact' } : undefined);

  if (filters.service) {
    query = query.eq('contact_services.service_id', filters.service);
  }

  if (filters.q) {
    // Commas and parentheses are PostgREST `or()` delimiters — strip them so a
    // search term cannot alter the filter structure.
    const term = filters.q.replace(/[,()]/g, ' ').trim();
    if (term) {
      query = query.or(
        `full_name.ilike.%${term}%,email.ilike.%${term}%,company_name.ilike.%${term}%`,
      );
    }
  }

  if (filters.source) query = query.eq('lead_source_id', filters.source);
  if (filters.status) query = query.eq('lead_status_id', filters.status);
  if (filters.assignee) query = query.eq('assigned_to', filters.assignee);

  // Only constrain by date when a range was explicitly requested, so the
  // unfiltered view shows every contact rather than a silently clipped subset.
  if (filters.range) {
    const range = resolveDateRange(parsePreset(filters.range), filters.from, filters.to);
    if (range.from) query = query.gte('created_at', range.from);
    if (range.to) query = query.lt('created_at', range.to);
  }

  return query;
}

/** True when any filter is active. Drives empty-state wording. */
export function hasActiveFilters(filters: ContactListFilters): boolean {
  return Boolean(
    filters.q ||
      filters.source ||
      filters.status ||
      filters.service ||
      filters.assignee ||
      filters.range,
  );
}
