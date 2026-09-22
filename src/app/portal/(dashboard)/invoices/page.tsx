import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePortalUser } from '@/lib/portal-auth';
import { PageHeader, EmptyState } from '@/components/ui/Card';
import { InvoiceStatusBadge } from '@/components/ui/Badge';
import { TableWrapper, Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { InvoiceWithStatus } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Your invoices' };

export const dynamic = 'force-dynamic';

export default async function PortalInvoicesPage() {
  await requirePortalUser();
  const supabase = await createClient();

  // RLS restricts this to the client's own invoices — no contact filter needed
  // or wanted here.
  const { data } = await supabase
    .from('invoices_with_status')
    .select('*')
    .order('issue_date', { ascending: false })
    .returns<InvoiceWithStatus[]>();

  // Drafts are internal: a client should not see an invoice before it is sent.
  const invoices = (data ?? []).filter((i) => i.status !== 'draft');

  return (
    <>
      <PageHeader title="Invoices" description="Everything we have invoiced you for." />

      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="Invoices appear here once they are issued."
        />
      ) : (
        <TableWrapper>
          <Table>
            <THead>
              <TR>
                <TH>Invoice</TH>
                <TH>Issued</TH>
                <TH>Due</TH>
                <TH>Status</TH>
                <TH align="right">Amount</TH>
              </TR>
            </THead>
            <TBody>
              {invoices.map((invoice) => (
                <TR key={invoice.id}>
                  <TD>
                    <Link
                      href={`/portal/invoices/${invoice.id}`}
                      className="font-medium tabular hover:text-[var(--primary)] transition-colors"
                    >
                      {invoice.invoice_number}
                    </Link>
                  </TD>
                  <TD className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
                    {formatDate(invoice.issue_date)}
                  </TD>
                  <TD className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
                    {formatDate(invoice.due_date)}
                  </TD>
                  <TD>
                    <InvoiceStatusBadge status={invoice.display_status} />
                  </TD>
                  <TD align="right" className="font-medium whitespace-nowrap">
                    {formatCurrency(invoice.total, invoice.currency)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      )}
    </>
  );
}
