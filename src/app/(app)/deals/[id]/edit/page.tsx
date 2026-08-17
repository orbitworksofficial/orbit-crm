import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { PageHeader } from '@/components/ui/Card';
import { DealForm } from '../../DealForm';
import { updateDeal } from '../../actions';

export const metadata: Metadata = { title: 'Edit deal' };

export default async function EditDealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: deal }, { data: contacts }, { data: services }, { data: members }, { data: tagged }] =
    await Promise.all([
      supabase.from('deals').select('*').eq('id', id).maybeSingle(),
      supabase.from('contacts').select('id, full_name, company_name').order('full_name').limit(1000),
      supabase.from('services').select('id, name').eq('is_active', true).order('sort_order'),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
      supabase.from('deal_services').select('service_id').eq('deal_id', id),
    ]);

  if (!deal) notFound();

  const action = updateDeal.bind(null, id);

  return (
    <>
      <PageHeader title="Edit deal" description={deal.title} />
      <DealForm
        action={action}
        deal={deal}
        contacts={contacts ?? []}
        services={services ?? []}
        members={members ?? []}
        selectedServiceIds={tagged?.map((row) => row.service_id) ?? []}
        currentUserRole={profile.role}
        submitLabel="Save changes"
        cancelHref={`/deals/${id}`}
      />
    </>
  );
}
