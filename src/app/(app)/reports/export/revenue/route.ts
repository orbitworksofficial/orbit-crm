import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth';
import { toCsv, csvResponse, datedFilename } from '@/lib/csv';
import { resolveDateRange, parsePreset } from '@/lib/date-range';

/**
 * Revenue report CSV export (brief §07): one row per invoice, with the derived
 * display status and computed totals. Admin-only, matching the invoices module.
 */

interface InvoiceExportRow {
  invoice_number: string;
  display_status: string;
  issue_date: string;
  due_date: string;
  paid_at: string | null;
  currency: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  contact_id: string;
}

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (profile.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const range = resolveDateRange(
    parsePreset(searchParams.get('range') ?? undefined),
    searchParams.get('from') ?? undefined,
    searchParams.get('to') ?? undefined,
  );

  const supabase = await createClient();

  let query = supabase
    .from('invoices_with_status')
    .select(
      'invoice_number, display_status, issue_date, due_date, paid_at, currency, subtotal, tax_amount, total, contact_id',
    )
    .order('issue_date', { ascending: false });

  // issue_date is a DATE column, so compare against date-only strings.
  if (range.from) query = query.gte('issue_date', range.from.slice(0, 10));
  if (range.to) query = query.lt('issue_date', range.to.slice(0, 10));

  const { data, error } = await query.returns<InvoiceExportRow[]>();

  if (error) {
    return new Response(`Could not build the export: ${error.message}`, { status: 500 });
  }

  const rows = data ?? [];

  // Resolve contact names in a single follow-up query; the view carries no
  // relationship metadata to embed through.
  const contactIds = [...new Set(rows.map((row) => row.contact_id))];
  const { data: contacts } = contactIds.length
    ? await supabase.from('contacts').select('id, full_name, company_name').in('id', contactIds)
    : { data: [] };

  const contactsById = new Map((contacts ?? []).map((contact) => [contact.id, contact]));

  const csv = toCsv<InvoiceExportRow>(
    [
      { header: 'Invoice number', accessor: (row) => row.invoice_number },
      {
        header: 'Contact',
        accessor: (row) => contactsById.get(row.contact_id)?.full_name,
      },
      {
        header: 'Company',
        accessor: (row) => contactsById.get(row.contact_id)?.company_name,
      },
      { header: 'Status', accessor: (row) => row.display_status },
      { header: 'Issue date', accessor: (row) => row.issue_date },
      { header: 'Due date', accessor: (row) => row.due_date },
      { header: 'Paid date', accessor: (row) => row.paid_at?.slice(0, 10) },
      { header: 'Currency', accessor: (row) => row.currency },
      { header: 'Subtotal', accessor: (row) => Number(row.subtotal).toFixed(2) },
      { header: 'Tax', accessor: (row) => Number(row.tax_amount).toFixed(2) },
      { header: 'Total', accessor: (row) => Number(row.total).toFixed(2) },
    ],
    rows,
  );

  return csvResponse(csv, datedFilename('revenue-report'));
}
