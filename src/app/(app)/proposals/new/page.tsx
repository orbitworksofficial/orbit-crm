import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { PageHeader } from '@/components/ui/Card';
import { ProposalForm } from '../ProposalForm';
import { createProposal } from '../actions';

export const metadata: Metadata = { title: 'New proposal' };

export default async function NewProposalPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: contacts }, { data: services }, { data: organization }] = await Promise.all([
    supabase.from('contacts').select('id, full_name, company_name').order('full_name').limit(1000),
    supabase
      .from('services')
      .select('id, name, default_rate')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('organizations')
      .select('default_tax_rate, default_currency')
      .eq('id', profile.organization_id)
      .single(),
  ]);

  return (
    <>
      <PageHeader title="New proposal" description="Quote a prospect from your service catalogue." />
      <ProposalForm
        action={createProposal}
        contacts={contacts ?? []}
        services={services ?? []}
        defaults={{
          taxRate: organization?.default_tax_rate ?? 0,
          currency: organization?.default_currency ?? 'USD',
          validDays: 30,
        }}
        submitLabel="Create proposal"
        cancelHref="/proposals"
      />
    </>
  );
}
