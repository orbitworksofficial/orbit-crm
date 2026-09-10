import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import { PageHeader, EmptyState, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { InvoiceStatusBadge } from '@/components/ui/Badge';
import { TableWrapper, Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { Pagination } from '@/components/ui/Pagination';
import { InvoiceFilters } from './InvoiceFilters';
import { formatDate, formatCurrency } from '@/lib/utils';
import type { InvoiceDisplayStatus, InvoiceStatus } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Invoices' };

const PAGE_SIZE = 25;

const INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'void'];

/** Narrows a raw query-string value to a stored invoice status. */
function isInvoiceStatus(value: string): value is InvoiceStatus {
  return (INVOICE_STATUSES as string[]).includes(value);
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  status: string;
  display_status: InvoiceDisplayStatus;
  issue_date: string;
  due_date: string;
  currency: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  contact_id: string;
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; contact?: string; page?: string }>;
}) {
  const params = await searchParams;
  // Invoices are admin-only per brief §01.
  await requireAdmin();
  const supabase = await createClient();

  const page = Math.max(1, Number(params.page) || 1);

  const today = new Date().toISOString().slice(0, 10);

  // Read from the view so `display_status` and money totals are computed in
  // Postgres rather than recalculated in three different places in the UI.
  let query = supabase
    .from('invoices_with_status')
    .select('*', { count: 'exact' })
    .order('issue_date', { ascending: false });

  // "Overdue" is derived rather than stored, so it filters on the underlying
  // conditions (sent, and past due) instead of on the status column.
  if (params.status === 'overdue') {
    query = query.eq('status', 'sent').lt('due_date', today);
  } else if (params.status && isInvoiceStatus(params.status)) {
    query = query.eq('status', params.status);
  }
  if (params.contact) query = query.eq('contact_id', params.contact);

  // Totals reflect the current filter, across all pages.
  let totalsQuery = supabase.from('invoices_with_status').select('total, status');
  if (params.status === 'overdue') {
    totalsQuery = totalsQuery.eq('status', 'sent').lt('due_date', today);
  } else if (params.status && isInvoiceStatus(params.status)) {
    totalsQuery = totalsQuery.eq('status', params.status);
  }
  if (params.contact) totalsQuery = totalsQuery.eq('contact_id', params.contact);

  // The page rows and the summary totals do not depend on each other, so they
  // travel together rather than as two sequential round trips.
  const [listResult, totalsResult] = await Promise.all([
    query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1).returns<InvoiceRow[]>(),
    totalsQuery.returns<{ total: number; status: string }[]>(),
  ]);

  const { data, count, error } = listResult;
  const { data: totalsRows } = totalsResult;

  const invoices = data ?? [];

  // Contact names must wait: which ids to fetch is only known once the page of
  // invoices comes back.
  const contactIds = [...new Set(invoices.map((invoice) => invoice.contact_id))];
  const { data: contactRows } = contactIds.length
    ? await supabase.from('contacts').select('id, full_name, company_name').in('id', contactIds)
    : { data: [] };

  const contactsById = new Map(
    (contactRows ?? []).map((contact) => [contact.id, contact]),
  );

  const totalInvoiced =
    totalsRows?.filter((row) => row.status !== 'void').reduce((sum, row) => sum + Number(row.total), 0) ?? 0;
  const totalPaid =
    totalsRows?.filter((row) => row.status === 'paid').reduce((sum, row) => sum + Number(row.total), 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Billing across all contacts."
        action={
          <Link href="/invoices/new">
            <Button>New invoice</Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Invoices</p>
          <p className="text-xl font-semibold mt-1">{count ?? 0}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Total invoiced</p>
          <p className="text-xl font-semibold mt-1">{formatCurrency(totalInvoiced)}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Total paid</p>
          <p className="text-xl font-semibold mt-1 text-[var(--success)]">
            {formatCurrency(totalPaid)}
          </p>
        </Card>
      </div>

      <InvoiceFilters current={params} />

      {error ? (
        <EmptyState title="Could not load invoices" description={error.message} />
      ) : invoices.length === 0 ? (
        <EmptyState
          title={params.status ? 'No invoices match this filter' : 'No invoices yet'}
          description="Create an invoice against a contact to start billing."
          action={
            <Link href="/invoices/new">
              <Button>New invoice</Button>
            </Link>
          }
        />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Contact</TH>
                  <TH>Status</TH>
                  <TH>Issued</TH>
                  <TH>Due</TH>
                  <TH align="right">Total</TH>
                </TR>
              </THead>
              <TBody>
                {invoices.map((invoice) => {
                  const contact = contactsById.get(invoice.contact_id);
                  return (
                    <TR key={invoice.id}>
                      <TD>
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="font-medium hover:text-[var(--primary)] transition-colors tabular"
                        >
                          {invoice.invoice_number}
                        </Link>
                      </TD>
                      <TD className="text-[var(--text-secondary)]">
                        {contact?.full_name ?? '—'}
                        {contact?.company_name && (
                          <span className="text-[var(--text-muted)] text-xs block">
                            {contact.company_name}
                          </span>
                        )}
                      </TD>
                      <TD>
                        <InvoiceStatusBadge status={invoice.display_status} />
                      </TD>
                      <TD className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
                        {formatDate(invoice.issue_date)}
                      </TD>
                      <TD className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
                        {formatDate(invoice.due_date)}
                      </TD>
                      <TD align="right" className="font-medium whitespace-nowrap">
                        {formatCurrency(invoice.total, invoice.currency)}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrapper>

          <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={params} />
        </>
      )}
    </>
  );
}
