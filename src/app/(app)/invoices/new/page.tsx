import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import { PageHeader } from '@/components/ui/Card';
import { InvoiceForm } from '../InvoiceForm';
import { createInvoice } from '../actions';

export const metadata: Metadata = { title: 'New invoice' };

export default async function NewInvoicePage() {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const [{ data: contacts }, { data: deals }, { data: services }, { data: organization }] =
    await Promise.all([
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

  return (
    <>
      <PageHeader title="New invoice" description="Bill a contact for delivered work." />
      <InvoiceForm
        action={createInvoice}
        contacts={contacts ?? []}
        deals={deals ?? []}
        services={services ?? []}
        defaults={{
          taxRate: organization?.default_tax_rate ?? 0,
          paymentTermsDays: organization?.default_payment_terms_days ?? 30,
          currency: organization?.default_currency ?? 'USD',
        }}
        submitLabel="Create invoice"
        cancelHref="/invoices"
      />
    </>
  );
}
