import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import { PageHeader } from '@/components/ui/Card';
import { CompanyProfileSection } from './CompanyProfileSection';
import { InvoiceSettingsSection } from './InvoiceSettingsSection';
import { ServicesSection } from './ServicesSection';
import { LeadSourcesSection } from './LeadSourcesSection';
import { UsersSection } from './UsersSection';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Settings (brief §09). Admin-only, enforced by `requireAdmin` here and by RLS
 * on every underlying table.
 */
export default async function SettingsPage() {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const [{ data: organization }, { data: services }, { data: sources }, { data: users }] =
    await Promise.all([
      supabase.from('organizations').select('*').eq('id', profile.organization_id).single(),
      supabase.from('services').select('*').order('sort_order'),
      supabase.from('lead_sources').select('*').order('sort_order'),
      supabase.from('profiles').select('*').order('full_name'),
    ]);

  const logoUrl = organization?.logo_path
    ? supabase.storage.from('branding').getPublicUrl(organization.logo_path).data.publicUrl
    : null;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Company profile, catalogue, and team management."
      />

      <div className="flex flex-col gap-4 max-w-4xl">
        <CompanyProfileSection organization={organization!} logoUrl={logoUrl} />
        <InvoiceSettingsSection organization={organization!} />
        <ServicesSection services={services ?? []} />
        <LeadSourcesSection sources={sources ?? []} />
        <UsersSection users={users ?? []} currentUserId={profile.id} />
      </div>
    </>
  );
}
