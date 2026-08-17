import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import { Card, CardHeader, PageHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { InvoiceStatusBadge } from '@/components/ui/Badge';
import { TableWrapper, Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { InvoiceActions } from './InvoiceActions';
import { formatDate, formatCurrency } from '@/lib/utils';
import type { InvoiceWithStatus, InvoiceLineItem } from '@/lib/supabase/database.types';
import type { InvoicePdfData } from '@/components/pdf/InvoiceDocument';

export const metadata: Metadata = { title: 'Invoice' };

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireAdmin();
  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from('invoices_with_status')
    .select('*')
    .eq('id', id)
    .maybeSingle<InvoiceWithStatus>();

  if (!invoice) notFound();

  const [{ data: lineItems }, { data: contact }, { data: organization }] = await Promise.all([
    supabase
      .from('invoice_line_items')
      .select('*')
      .eq('invoice_id', id)
      .order('sort_order')
      .returns<InvoiceLineItem[]>(),
    supabase
      .from('contacts')
      .select('id, full_name, company_name, email, city, country')
      .eq('id', invoice.contact_id)
      .maybeSingle(),
    supabase
      .from('organizations')
      .select('name, website_url, contact_email, logo_path')
      .eq('id', profile.organization_id)
      .single(),
  ]);

  // Resolve a public URL for the logo so @react-pdf can fetch it in the browser.
  const logoUrl = organization?.logo_path
    ? supabase.storage.from('branding').getPublicUrl(organization.logo_path).data.publicUrl
    : null;

  // Assembled server-side so the client component receives plain, serialisable
  // data and never needs its own queries.
  const pdfData: InvoicePdfData = {
    invoiceNumber: invoice.invoice_number,
    status: invoice.display_status,
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date,
    currency: invoice.currency,
    taxRate: invoice.tax_rate,
    subtotal: invoice.subtotal,
    taxAmount: invoice.tax_amount,
    total: invoice.total,
    notes: invoice.notes,
    paymentTerms: invoice.payment_terms,
    company: {
      name: organization?.name ?? 'Orbit Works',
      websiteUrl: organization?.website_url ?? null,
      contactEmail: organization?.contact_email ?? null,
      logoUrl,
    },
    billTo: {
      fullName: contact?.full_name ?? 'Unknown contact',
      companyName: contact?.company_name ?? null,
      email: contact?.email ?? null,
      location: [contact?.city, contact?.country].filter(Boolean).join(', ') || null,
    },
    lineItems: (lineItems ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      rate: item.rate,
    })),
  };

  return (
    <>
      <PageHeader
        title={invoice.invoice_number}
        description={contact?.full_name ?? undefined}
        action={
          <div className="flex items-center gap-2">
            <Link href={`/invoices/${id}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1 flex flex-col gap-4">
          <Card>
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <span className="text-2xl font-semibold">
                {formatCurrency(invoice.total, invoice.currency)}
              </span>
              <InvoiceStatusBadge status={invoice.display_status} />
            </div>
            <InvoiceActions
              invoiceId={id}
              currentStatus={invoice.status}
              invoiceNumber={invoice.invoice_number}
              pdfData={pdfData}
            />
          </Card>

          <Card>
            <CardHeader title="Details" />
            <dl className="text-sm">
              <div className="flex justify-between gap-3 py-1.5 border-b border-[var(--border-subtle)]">
                <dt className="text-[var(--text-muted)] text-xs">Issued</dt>
                <dd>{formatDate(invoice.issue_date)}</dd>
              </div>
              <div className="flex justify-between gap-3 py-1.5 border-b border-[var(--border-subtle)]">
                <dt className="text-[var(--text-muted)] text-xs">Due</dt>
                <dd>{formatDate(invoice.due_date)}</dd>
              </div>
              {invoice.paid_at && (
                <div className="flex justify-between gap-3 py-1.5 border-b border-[var(--border-subtle)]">
                  <dt className="text-[var(--text-muted)] text-xs">Paid</dt>
                  <dd className="text-[var(--success)]">{formatDate(invoice.paid_at)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-[var(--text-muted)] text-xs">Terms</dt>
                <dd>{invoice.payment_terms ?? '—'}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Bill to" />
            {contact ? (
              <address className="not-italic text-sm flex flex-col gap-0.5">
                <Link
                  href={`/contacts/${contact.id}`}
                  className="font-medium text-[var(--primary)] hover:underline"
                >
                  {contact.full_name}
                </Link>
                {contact.company_name && (
                  <span className="text-[var(--text-secondary)]">{contact.company_name}</span>
                )}
                {contact.email && (
                  <span className="text-[var(--text-secondary)]">{contact.email}</span>
                )}
                {(contact.city || contact.country) && (
                  <span className="text-[var(--text-muted)]">
                    {[contact.city, contact.country].filter(Boolean).join(', ')}
                  </span>
                )}
              </address>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">Contact unavailable.</p>
            )}
          </Card>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-4">
          <TableWrapper>
            <Table>
              <THead>
                <TR>
                  <TH>Item</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Rate</TH>
                  <TH align="right">Amount</TH>
                </TR>
              </THead>
              <TBody>
                {(lineItems ?? []).map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <span className="font-medium">{item.name}</span>
                      {item.description && (
                        <span className="block text-xs text-[var(--text-muted)]">
                          {item.description}
                        </span>
                      )}
                    </TD>
                    <TD align="right">{item.quantity}</TD>
                    <TD align="right">{formatCurrency(item.rate, invoice.currency)}</TD>
                    <TD align="right" className="font-medium">
                      {formatCurrency(item.quantity * item.rate, invoice.currency)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>

          <Card>
            <dl className="ml-auto max-w-xs flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--text-secondary)]">Subtotal</dt>
                <dd className="tabular">{formatCurrency(invoice.subtotal, invoice.currency)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--text-secondary)]">Tax ({invoice.tax_rate}%)</dt>
                <dd className="tabular">{formatCurrency(invoice.tax_amount, invoice.currency)}</dd>
              </div>
              <div className="flex justify-between gap-4 pt-1.5 border-t border-[var(--border-subtle)] font-semibold text-base">
                <dt>Total</dt>
                <dd className="tabular">{formatCurrency(invoice.total, invoice.currency)}</dd>
              </div>
            </dl>
          </Card>

          {invoice.notes && (
            <Card>
              <CardHeader title="Notes" />
              <p className="text-sm whitespace-pre-wrap text-[var(--text-secondary)]">
                {invoice.notes}
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
