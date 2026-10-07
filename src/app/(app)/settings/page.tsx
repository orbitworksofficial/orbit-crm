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
import { MetaIntegrationCard } from './MetaIntegrationCard';
import {
  getWebhookUrl,
  type MetaCredentialSummary,
} from './integrations/meta-actions';
import { PortalAccessSection } from './PortalAccessSection';
import type { PortalAccessSummary } from './portal/actions';
import type { PortalUser } from '@/lib/supabase/database.types';
import { decryptSecret, isEncryptionConfigured } from '@/lib/crypto';
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
  //
  // Meta is excluded: it has its own card, because it needs three secrets and
  // four identifiers that the generic two-field form cannot express.
  const credentialSummaries: CredentialSummary[] = (credentials ?? [])
    .filter((c) => c.platform !== 'meta')
    .map((c) => ({
      platform: c.platform,
      accountId: c.account_id,
      tokenHint: c.token_hint,
      isActive: c.is_active,
      lastSyncedAt: c.last_synced_at,
      lastError: c.last_error,
      connectedAt: c.created_at,
    }));

  const metaRow = (credentials ?? []).find((c) => c.platform === 'meta') ?? null;

  // The verify token is the one stored value the user has to be able to read,
  // since they paste it into Meta. Decrypted in a try/catch because a rotated
  // encryption key must not take the whole Settings page down with it.
  let metaVerifyToken: string | null = null;
  if (metaRow?.webhook_verify_token_encrypted) {
    try {
      metaVerifyToken = decryptSecret(metaRow.webhook_verify_token_encrypted);
    } catch {
      metaVerifyToken = null;
    }
  }

  const metaSummary: MetaCredentialSummary | null = metaRow
    ? {
        accountId: metaRow.account_id,
        // access_token is NOT NULL, so "not set yet" is stored as an empty
        // string rather than null.
        hasAdsToken: metaRow.access_token !== '',
        adsTokenHint: metaRow.token_hint || null,
        hasAppSecret: metaRow.app_secret_encrypted !== null,
        hasCapiToken: metaRow.capi_token_encrypted !== null,
        capiTokenHint: metaRow.capi_token_hint,
        pixelId: metaRow.config?.pixel_id ?? null,
        pageId: metaRow.config?.page_id ?? null,
        appId: metaRow.config?.app_id ?? null,
        webhookVerifyToken: metaVerifyToken,
        isActive: metaRow.is_active,
        lastSyncedAt: metaRow.last_synced_at,
        lastError: metaRow.last_error,
        connectedAt: metaRow.created_at,
      }
    : null;

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
        <MetaIntegrationCard
          credential={metaSummary}
          webhookUrl={await getWebhookUrl()}
          encryptionReady={isEncryptionConfigured()}
        />
        <IntegrationsSection
          credentials={credentialSummaries}
          encryptionReady={isEncryptionConfigured()}
        />
      </div>
    </>
  );
}
