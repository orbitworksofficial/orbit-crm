import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { PageHeader } from '@/components/ui/Card';
import { DealForm } from '../DealForm';
import { createDeal } from '../actions';

export const metadata: Metadata = { title: 'New deal' };

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>;
}) {
  const { contact } = await searchParams;
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: contacts }, { data: services }, { data: members }] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, full_name, company_name')
      .order('full_name')
      .limit(1000),
    supabase.from('services').select('id, name').eq('is_active', true).order('sort_order'),
    supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
  ]);

  return (
    <>
      <PageHeader title="New deal" description="Track an opportunity against a contact." />
      <DealForm
        action={createDeal}
        contacts={contacts ?? []}
        services={services ?? []}
        members={members ?? []}
        defaultContactId={contact}
        currentUserRole={profile.role}
        submitLabel="Create deal"
        cancelHref="/deals"
      />
    </>
  );
}
