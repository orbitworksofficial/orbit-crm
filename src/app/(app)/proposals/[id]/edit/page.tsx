import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { PageHeader } from '@/components/ui/Card';
import { ProposalForm } from '../../ProposalForm';
import { updateProposal } from '../../actions';
import type { ProposalLineItem } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Edit proposal' };

export default async function EditProposalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: proposal }, { data: items }, { data: contacts }, { data: services }, { data: organization }] =
    await Promise.all([
      supabase.from('proposals').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('proposal_line_items')
        .select('*')
        .eq('proposal_id', id)
        .order('sort_order')
        .returns<ProposalLineItem[]>(),
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

  if (!proposal) notFound();

  const action = updateProposal.bind(null, id);

  return (
    <>
      <PageHeader title="Edit proposal" description={proposal.proposal_number} />
      <ProposalForm
        action={action}
        proposal={proposal}
        lineItems={items ?? []}
        contacts={contacts ?? []}
        services={services ?? []}
        defaults={{
          taxRate: organization?.default_tax_rate ?? 0,
          currency: organization?.default_currency ?? 'USD',
          validDays: 30,
        }}
        submitLabel="Save changes"
        cancelHref={`/proposals/${id}`}
      />
    </>
  );
}
