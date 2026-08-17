import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { PageHeader } from '@/components/ui/Card';
import { ContactForm } from '../ContactForm';
import { createContact } from '../actions';

export const metadata: Metadata = { title: 'New contact' };

export default async function NewContactPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: sources }, { data: statuses }, { data: services }, { data: members }] =
    await Promise.all([
      supabase.from('lead_sources').select('id, name').eq('is_active', true).order('sort_order'),
      supabase.from('lead_statuses').select('id, name').eq('is_active', true).order('sort_order'),
      supabase.from('services').select('id, name').eq('is_active', true).order('sort_order'),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
    ]);

  return (
    <>
      <PageHeader title="New contact" description="Add a lead or customer to the CRM." />
      <ContactForm
        action={createContact}
        sources={sources ?? []}
        statuses={statuses ?? []}
        services={services ?? []}
        members={members ?? []}
        currentUserRole={profile.role}
        submitLabel="Create contact"
        cancelHref="/contacts"
      />
    </>
  );
}
