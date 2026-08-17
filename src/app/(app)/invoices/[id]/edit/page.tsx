import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import { PageHeader } from '@/components/ui/Card';
import { InvoiceForm } from '../../InvoiceForm';
import { updateInvoice } from '../../actions';
import type { InvoiceLineItem } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Edit invoice' };

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireAdmin();
  const supabase = await createClient();

  const [
    { data: invoice },
    { data: lineItems },
    { data: contacts },
    { data: deals },
    { data: services },
    { data: organization },
  ] = await Promise.all([
    supabase.from('invoices').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('invoice_line_items')
      .select('*')
      .eq('invoice_id', id)
      .order('sort_order')
      .returns<InvoiceLineItem[]>(),
    supabase.from('contacts').select('id, full_name, company_name').order('full_name').limit(1000),
    supabase.from('deals').select('id, title, contact_id').order('created_at', { ascending: false }),
    supabase
      .from('services')
      .select('id, name, default_rate')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('organizations')
      .select('default_tax_rate, default_payment_terms_days, default_currency')
      .eq('id', profile.organization_id)
      .single(),
  ]);

  if (!invoice) notFound();

  const action = updateInvoice.bind(null, id);

  return (
    <>
      <PageHeader title="Edit invoice" description={invoice.invoice_number} />
      <InvoiceForm
        action={action}
        invoice={invoice}
        lineItems={lineItems ?? []}
        contacts={contacts ?? []}
        deals={deals ?? []}
        services={services ?? []}
        defaults={{
          taxRate: organization?.default_tax_rate ?? 0,
          paymentTermsDays: organization?.default_payment_terms_days ?? 30,
          currency: organization?.default_currency ?? 'USD',
        }}
        submitLabel="Save changes"
        cancelHref={`/invoices/${id}`}
      />
    </>
  );
}
