import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import { PageHeader } from '@/components/ui/Card';
import { CompanyProfileSection } from './CompanyProfileSection';
import { InvoiceSettingsSection } from './InvoiceSettingsSection';
import { ServicesSection } from './ServicesSection';
import { LeadSourcesSection } from './LeadSourcesSection';
import { UsersSection } from './UsersSection';
import { IntegrationsSection } from './IntegrationsSection';
import { PortalAccessSection } from './PortalAccessSection';
import type { PortalAccessSummary } from './portal/actions';
import type { PortalUser } from '@/lib/supabase/database.types';
import { isEncryptionConfigured } from '@/lib/crypto';
import type { CredentialSummary } from './integrations/actions';
import type { AdCredential } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Settings (brief §09). Admin-only, enforced by `requireAdmin` here and by RLS
 * on every underlying table.
 */
export default async function SettingsPage() {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const [
    { data: organization },
    { data: services },
    { data: sources },
    { data: users },
    { data: credentials },
    { data: portalUsers },
    { data: portalContacts },
  ] = await Promise.all([
    supabase.from('organizations').select('*').eq('id', profile.organization_id).single(),
    supabase.from('services').select('*').order('sort_order'),
    supabase.from('lead_sources').select('*').order('sort_order'),
    supabase.from('profiles').select('*').order('full_name'),
    supabase.from('ad_credentials').select('*').order('platform').returns<AdCredential[]>(),
    supabase.from('portal_users').select('*').order('created_at').returns<PortalUser[]>(),
    supabase
      .from('contacts')
      .select('id, full_name, company_name, email')
      .order('full_name')
      .limit(1000),
  ]);

  // Resolve contact names for the portal list. The portal_users row carries the
  // client's own name, which may differ from the contact record.
  const contactsById = new Map((portalContacts ?? []).map((c) => [c.id, c]));
  const portalSummaries: PortalAccessSummary[] = (portalUsers ?? []).map((u) => ({
    id: u.id,
    contactId: u.contact_id,
    contactName: contactsById.get(u.contact_id)?.full_name ?? null,
    companyName: contactsById.get(u.contact_id)?.company_name ?? null,
    email: u.email,
    fullName: u.full_name,
    isActive: u.is_active,
    lastSeenAt: u.last_seen_at,
    createdAt: u.created_at,
  }));

  // Only the non-secret fields cross to the client. The encrypted token is
  // deliberately dropped here rather than in the component — nothing sensitive
  // should reach a React payload at all.
  const credentialSummaries: CredentialSummary[] = (credentials ?? []).map((c) => ({
    platform: c.platform,
    accountId: c.account_id,
    tokenHint: c.token_hint,
    isActive: c.is_active,
    lastSyncedAt: c.last_synced_at,
    lastError: c.last_error,
    connectedAt: c.created_at,
  }));

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
        <PortalAccessSection
          portalUsers={portalSummaries}
          contacts={portalContacts ?? []}
        />
        <IntegrationsSection
          credentials={credentialSummaries}
          encryptionReady={isEncryptionConfigured()}
        />
      </div>
    </>
  );
}
