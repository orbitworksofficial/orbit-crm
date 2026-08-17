import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { PageHeader } from '@/components/ui/Card';
import { ContactForm } from '../../ContactForm';
import { updateContact } from '../../actions';

export const metadata: Metadata = { title: 'Edit contact' };

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const [
    { data: contact },
    { data: sources },
    { data: statuses },
    { data: services },
    { data: members },
    { data: tagged },
  ] = await Promise.all([
    supabase.from('contacts').select('*').eq('id', id).maybeSingle(),
    supabase.from('lead_sources').select('id, name').eq('is_active', true).order('sort_order'),
    supabase.from('lead_statuses').select('id, name').eq('is_active', true).order('sort_order'),
    supabase.from('services').select('id, name').eq('is_active', true).order('sort_order'),
    supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
    supabase.from('contact_services').select('service_id').eq('contact_id', id),
  ]);

  if (!contact) notFound();

  // Bind the id so the form's action signature matches the shared component.
  const action = updateContact.bind(null, id);

  return (
    <>
      <PageHeader title="Edit contact" description={contact.full_name} />
      <ContactForm
        action={action}
        contact={contact}
        sources={sources ?? []}
        statuses={statuses ?? []}
        services={services ?? []}
        members={members ?? []}
        selectedServiceIds={tagged?.map((row) => row.service_id) ?? []}
        currentUserRole={profile.role}
        submitLabel="Save changes"
        cancelHref={`/contacts/${id}`}
      />
    </>
  );
}
