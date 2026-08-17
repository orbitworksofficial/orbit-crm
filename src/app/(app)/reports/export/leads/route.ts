import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth';
import { toCsv, csvResponse, datedFilename } from '@/lib/csv';
import { resolveDateRange, parsePreset } from '@/lib/date-range';

/**
 * Lead report CSV export (brief §07).
 *
 * Exports one row per contact in the selected period. RLS applies, so a sales
 * user's export contains only their own leads.
 */

interface LeadExportRow {
  full_name: string;
  email: string | null;
  whatsapp_number: string | null;
  company_name: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  created_at: string;
  lead_source: { name: string } | null;
  lead_status: { name: string } | null;
  assignee: { full_name: string } | null;
  contact_services: { service: { name: string } | null }[] | null;
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

  let query = supabase
    .from('contacts')
    .select(
      `full_name, email, whatsapp_number, company_name, industry, city, country, created_at,
       lead_source:lead_sources(name),
       lead_status:lead_statuses(name),
       assignee:profiles!contacts_assigned_to_fkey(full_name),
       contact_services(service:services(name))`,
    )
    .order('created_at', { ascending: false });

  if (range.from) query = query.gte('created_at', range.from);
  if (range.to) query = query.lt('created_at', range.to);

  const { data, error } = await query.returns<LeadExportRow[]>();

  if (error) {
    return new Response(`Could not build the export: ${error.message}`, { status: 500 });
  }

  const csv = toCsv<LeadExportRow>(
    [
      { header: 'Full name', accessor: (row) => row.full_name },
      { header: 'Email', accessor: (row) => row.email },
      { header: 'WhatsApp', accessor: (row) => row.whatsapp_number },
      { header: 'Company', accessor: (row) => row.company_name },
      { header: 'Industry', accessor: (row) => row.industry },
      { header: 'City', accessor: (row) => row.city },
      { header: 'Country', accessor: (row) => row.country },
      { header: 'Lead source', accessor: (row) => row.lead_source?.name },
      { header: 'Lead status', accessor: (row) => row.lead_status?.name },
      { header: 'Assigned to', accessor: (row) => row.assignee?.full_name },
      {
        header: 'Services',
        accessor: (row) =>
          row.contact_services
            ?.map((entry) => entry.service?.name)
            .filter(Boolean)
            .join('; '),
      },
      { header: 'Created', accessor: (row) => row.created_at.slice(0, 10) },
    ],
    data ?? [],
  );

  return csvResponse(csv, datedFilename('leads-report'));
}
