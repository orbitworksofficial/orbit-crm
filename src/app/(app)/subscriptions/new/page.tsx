import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { PageHeader } from '@/components/ui/Card';
import { SubscriptionForm } from '../SubscriptionForm';
import { createSubscription } from '../actions';

export const metadata: Metadata = { title: 'New retainer' };

export default async function NewSubscriptionPage() {
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
      .select('default_currency')
      .eq('id', profile.organization_id)
      .single(),
  ]);

  return (
    <>
      <PageHeader
        title="New retainer"
        description="Track a recurring client and never miss a billing date."
      />
      <SubscriptionForm
        action={createSubscription}
        contacts={contacts ?? []}
        services={services ?? []}
        defaults={{ currency: organization?.default_currency ?? 'USD' }}
        submitLabel="Create retainer"
        cancelHref="/subscriptions"
      />
    </>
  );
}
