'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import { encryptSecret, secretHint, isEncryptionConfigured } from '@/lib/crypto';
import {
  generateVerifyToken,
  loadMetaCredential,
  recordSyncResult,
  verifyTokenHash,
} from '@/lib/meta/credentials';
import {
  MetaApiError,
  fetchAdAccountName,
  fetchFormLeads,
  fetchInsights,
  fetchPageAccessToken,
  fetchPageLeadForms,
  fetchPixelName,
} from '@/lib/meta/client';
import { ingestMetaLead } from '@/lib/meta/ingest';
import { campaignKey, type MetaConfig } from '@/lib/meta/types';
import type { AdCredential } from '@/lib/supabase/database.types';
import type { ActionState } from './actions';

/**
 * Meta integration settings.
 *
 * Meta needs considerably more configuration than the other ad platforms —
 * three separate secrets and four identifiers — and the pieces become usable at
 * different times, since the Conversions API needs no App Review while lead
 * retrieval does. That is why this is its own module and its own card rather
 * than another entry in the generic platform list.
 *
 * Nothing here ever returns a stored secret. The only plaintext that crosses
 * back is the webhook verify token, which is not a bearer credential: it lets
 * Meta's verification request succeed and nothing else, and the user has to be
 * able to read it in order to paste it into Meta.
 */

/** What the Settings UI is allowed to know. */
export interface MetaCredentialSummary {
  accountId: string;
  hasAdsToken: boolean;
  adsTokenHint: string | null;
  hasAppSecret: boolean;
  hasCapiToken: boolean;
  capiTokenHint: string | null;
  pixelId: string | null;
  pageId: string | null;
  appId: string | null;
  webhookVerifyToken: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  connectedAt: string;
}

export interface MetaTestResult {
  ok: boolean;
  message: string;
  /** Per-credential outcomes, so the user can see WHICH one is wrong rather
   *  than being told the connection failed. */
  checks: { label: string; ok: boolean; detail: string }[];
}

const metaSchema = z.object({
  account_id: z
    .string()
    .trim()
    .min(1, 'Enter the ad account ID')
    .max(120)
    .regex(/^act_\d+$/, 'Ad account IDs look like act_1234567890'),
  page_id: z.string().trim().max(40).regex(/^\d*$/, 'Page IDs are digits only'),
  app_id: z.string().trim().max(40).regex(/^\d*$/, 'App IDs are digits only'),
  pixel_id: z.string().trim().max(40).regex(/^\d*$/, 'Pixel IDs are digits only'),
  // Secrets: blank means "keep whatever is stored". Without that, editing a
  // pixel id would force the user to re-paste three tokens they may not have
  // to hand.
  access_token: z.string().trim(),
  app_secret: z.string().trim(),
  capi_token: z.string().trim(),
});

/** The URL to paste into Meta's webhook configuration. Derived from the request
 *  rather than an env var, so it is correct on localhost and in production
 *  without anything to configure. */
export async function getWebhookUrl(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost:3000';
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  return `${protocol}://${host}/api/meta/webhook`;
}

export async function saveMetaIntegration(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  if (!isEncryptionConfigured()) {
    return {
      error:
        'CREDENTIALS_ENCRYPTION_KEY is not set on the server. Credentials cannot be stored safely until it is.',
    };
  }

  const parsed = metaSchema.safeParse({
    account_id: formData.get('account_id') ?? '',
    page_id: formData.get('page_id') ?? '',
    app_id: formData.get('app_id') ?? '',
    pixel_id: formData.get('pixel_id') ?? '',
    access_token: formData.get('access_token') ?? '',
    app_secret: formData.get('app_secret') ?? '',
    capi_token: formData.get('capi_token') ?? '',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();

  // Read before write. An upsert would replace the whole row, discarding the
  // secrets the user deliberately left blank to keep.
  const { data: existing } = await supabase
    .from('ad_credentials')
    .select('id, config, access_token, token_hint')
    .eq('organization_id', profile.organization_id)
    .eq('platform', 'meta')
    .maybeSingle();

  const config: MetaConfig = {
    ...((existing?.config ?? {}) as MetaConfig),
    page_id: parsed.data.page_id || undefined,
    app_id: parsed.data.app_id || undefined,
    pixel_id: parsed.data.pixel_id || undefined,
  };

  // Typed as a partial row so a column typo is caught here rather than
  // silently ignored by Postgres.
  const patch: Partial<AdCredential> = {
    account_id: parsed.data.account_id,
    config,
    is_active: true,
    // A credential change is the usual fix for a stored error, so clearing it
    // here stops a stale warning outliving the problem.
    last_error: null,
  };

  if (parsed.data.access_token !== '') {
    patch.access_token = encryptSecret(parsed.data.access_token);
    patch.token_hint = secretHint(parsed.data.access_token);
  }
  if (parsed.data.app_secret !== '') {
    patch.app_secret_encrypted = encryptSecret(parsed.data.app_secret);
  }
  if (parsed.data.capi_token !== '') {
    patch.capi_token_encrypted = encryptSecret(parsed.data.capi_token);
    patch.capi_token_hint = secretHint(parsed.data.capi_token);
  }

  if (existing) {
    const { error } = await supabase
      .from('ad_credentials')
      .update(patch)
      .eq('id', existing.id);
    if (error) return { error: `Could not save the settings: ${error.message}` };
  } else {
    // access_token and token_hint are NOT NULL, so a first save with no ads
    // token yet — the normal state before App Review — stores empty strings.
    // loadMetaCredential reads those back as "no token".
    const { error } = await supabase.from('ad_credentials').insert({
      organization_id: profile.organization_id,
      platform: 'meta',
      access_token: '',
      token_hint: '',
      created_by: profile.id,
      ...patch,
    });
    if (error) return { error: `Could not save the settings: ${error.message}` };
  }

  revalidatePath('/settings');
  return { success: 'Meta settings saved.' };
}

/**
 * Mints a new webhook verify token.
 *
 * Returns the plaintext because the user has to paste it into Meta. Doing this
 * again invalidates the previous token, which stops lead delivery until the
 * webhook is re-verified — the UI warns before calling.
 */
export async function regenerateMetaWebhookToken(): Promise<{
  ok: boolean;
  token?: string;
  error?: string;
}> {
  const profile = await requireAdmin();

  if (!isEncryptionConfigured()) {
    return { ok: false, error: 'CREDENTIALS_ENCRYPTION_KEY is not set on the server.' };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('ad_credentials')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('platform', 'meta')
    .maybeSingle();

  if (!existing) {
    return { ok: false, error: 'Save the Meta ad account details first.' };
  }

  const token = generateVerifyToken();
  const { error } = await supabase
    .from('ad_credentials')
    .update({
      webhook_verify_token_encrypted: encryptSecret(token),
      webhook_verify_token_hash: verifyTokenHash(token),
    })
    .eq('id', existing.id);

  if (error) return { ok: false, error: `Could not store the token: ${error.message}` };

  revalidatePath('/settings');
  return { ok: true, token };
}

/** Describes a Meta failure in terms of what to do about it. */
function describeMetaError(cause: unknown): string {
  if (cause instanceof MetaApiError) {
    if (cause.isAuthError) return `${cause.message} — generate a new token and save it here.`;
    if (cause.isPermissionError) {
      return `${cause.message} — this permission is granted once Meta App Review completes.`;
    }
    return cause.message;
  }
  return cause instanceof Error ? cause.message : 'Unknown error';
}

/**
 * Live check of each stored credential.
 *
 * Replaces the placeholder that only verified decryption. Each credential is
 * checked separately because they fail independently: the Conversions API
 * token can be valid while the ads token is still waiting on App Review.
 */
export async function testMetaConnection(): Promise<MetaTestResult> {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const credential = await loadMetaCredential(supabase, profile.organization_id);

  if (!credential) {
    return { ok: false, message: 'Meta is not connected yet.', checks: [] };
  }

  const checks: MetaTestResult['checks'] = [];

  if (!credential.adsToken) {
    checks.push({
      label: 'Ads token',
      ok: false,
      detail: 'Not set. Needed for lead retrieval and spend reporting.',
    });
  } else {
    try {
      const name = await fetchAdAccountName(credential.accountId, credential.adsToken);
      checks.push({ label: 'Ads token', ok: true, detail: `Reached ad account "${name}".` });
    } catch (cause) {
      checks.push({ label: 'Ads token', ok: false, detail: describeMetaError(cause) });
    }
  }

  const pixelId = credential.config.pixel_id;
  if (!credential.capiToken || !pixelId) {
    checks.push({
      label: 'Conversions API',
      ok: false,
      detail: !pixelId
        ? 'No pixel ID set, so lead-quality feedback cannot be sent.'
        : 'No Conversions API token set.',
    });
  } else {
    try {
      const name = await fetchPixelName(pixelId, credential.capiToken);
      checks.push({ label: 'Conversions API', ok: true, detail: `Reached dataset "${name}".` });
    } catch (cause) {
      checks.push({ label: 'Conversions API', ok: false, detail: describeMetaError(cause) });
    }
  }

  // Lead forms are checked separately from the ads token because they fail for
  // their own reason: the endpoint needs a Page token, which only works if the
  // system user was granted access to the Page itself.
  const pageId = credential.config.page_id;
  if (!pageId) {
    checks.push({
      label: 'Lead forms',
      ok: false,
      detail: 'No Page ID set, so lead forms cannot be found.',
    });
  } else if (!credential.adsToken) {
    checks.push({ label: 'Lead forms', ok: false, detail: 'No ads token set.' });
  } else {
    try {
      const pageToken = await fetchPageAccessToken(pageId, credential.adsToken);
      if (!pageToken) {
        checks.push({
          label: 'Lead forms',
          ok: false,
          detail:
            'The token does not administer that Page. Grant the system user access to it in Business Settings.',
        });
      } else {
        const forms = await fetchPageLeadForms(pageId, pageToken);
        checks.push({
          label: 'Lead forms',
          ok: true,
          detail:
            forms.length === 0
              ? 'Page reached, but it has no lead forms yet.'
              : `Found ${forms.length} lead form${forms.length === 1 ? '' : 's'}: ${forms
                  .map((f) => f.name ?? f.id)
                  .slice(0, 3)
                  .join(', ')}.`,
        });
      }
    } catch (cause) {
      checks.push({ label: 'Lead forms', ok: false, detail: describeMetaError(cause) });
    }
  }

  checks.push(
    credential.appSecret
      ? { label: 'App secret', ok: true, detail: 'Stored. Inbound webhooks can be verified.' }
      : {
          label: 'App secret',
          ok: false,
          detail: 'Not set. Leads are rejected, because their signature cannot be checked.',
        },
  );

  const passed = checks.filter((c) => c.ok).length;
  return {
    ok: checks.every((c) => c.ok),
    message: `${passed} of ${checks.length} checks passed.`,
    checks,
  };
}

/** Days of history a sync or backfill may request. Bounded because an
 *  ad-grain pull over a long window pages for a long time. */
export type MetaSyncWindow = 7 | 30 | 90;

/**
 * Pulls Meta insights into ad_spend.
 *
 * Manual rather than scheduled: no cron exists in this deployment. The
 * dashboard labels spend with the credential's last_synced_at so an unrefreshed
 * figure cannot be mistaken for a current one.
 */
export async function syncMetaInsights(days: MetaSyncWindow): Promise<{
  ok: boolean;
  message: string;
}> {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const credential = await loadMetaCredential(supabase, profile.organization_id);

  if (!credential) return { ok: false, message: 'Meta is not connected yet.' };
  if (!credential.adsToken) {
    return { ok: false, message: 'No ads token is set, so there is nothing to sync.' };
  }

  const until = new Date();
  const since = new Date(until.getTime() - days * 86_400_000);
  const asDate = (d: Date) => d.toISOString().slice(0, 10);

  let rows;
  try {
    rows = await fetchInsights(credential.accountId, credential.adsToken, {
      since: asDate(since),
      until: asDate(until),
    });
  } catch (cause) {
    const message = describeMetaError(cause);
    await recordSyncResult(supabase, profile.organization_id, { ok: false, error: message });
    return { ok: false, message };
  }

  if (rows.length === 0) {
    await recordSyncResult(supabase, profile.organization_id, { ok: true });
    return { ok: true, message: `No Meta spend reported in the last ${days} days.` };
  }

  const { error } = await supabase.from('ad_spend').upsert(
    rows.map((row) => ({
      organization_id: profile.organization_id,
      platform: 'meta' as const,
      spend_date: row.date,
      campaign_id: row.campaignId,
      campaign_name: row.campaignName,
      adset_id: row.adsetId,
      adset_name: row.adsetName,
      ad_id: row.adId,
      ad_name: row.adName,
      // Derived through the same function the webhook uses for
      // contacts.utm_campaign. The ROAS join depends on both sides matching.
      utm_campaign: campaignKey(row.campaignName),
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      platform_leads: row.leads,
      synced_at: new Date().toISOString(),
    })),
    { onConflict: 'organization_id,platform,spend_date,grain_key' },
  );

  if (error) {
    await recordSyncResult(supabase, profile.organization_id, {
      ok: false,
      error: error.message,
    });
    return { ok: false, message: `Could not store the spend data: ${error.message}` };
  }

  await recordSyncResult(supabase, profile.organization_id, { ok: true });
  revalidatePath('/settings');
  revalidatePath('/dashboard');
  revalidatePath('/reports');

  return {
    ok: true,
    message: `Imported ${rows.length} rows of Meta spend from the last ${days} days.`,
  };
}

/**
 * Re-imports recent leads from Meta's own records.
 *
 * The safety net for webhook-only delivery. A webhook can fail silently — a
 * deploy mid-delivery, a Graph error, an expired token — and Meta deletes lead
 * data 90 days after submission, so a gap that is never noticed becomes
 * permanent. This re-walks the forms and relies on the meta_lead_id unique
 * index to skip what is already stored, which makes running it harmless.
 */
export async function backfillMetaLeads(days: MetaSyncWindow): Promise<{
  ok: boolean;
  message: string;
}> {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const credential = await loadMetaCredential(supabase, profile.organization_id);

  if (!credential) return { ok: false, message: 'Meta is not connected yet.' };
  if (!credential.adsToken) {
    return { ok: false, message: 'No ads token is set, so leads cannot be fetched.' };
  }

  const pageId = credential.config.page_id;
  if (!pageId) {
    return { ok: false, message: 'Set the Page ID first — lead forms belong to a Page.' };
  }

  const sinceUnix = Math.floor((Date.now() - days * 86_400_000) / 1000);

  // Lead endpoints reject a system user token outright, so everything below
  // runs on a Page token obtained from it.
  let pageToken: string | null;
  try {
    pageToken = await fetchPageAccessToken(pageId, credential.adsToken);
  } catch (cause) {
    return { ok: false, message: describeMetaError(cause) };
  }

  if (!pageToken) {
    return {
      ok: false,
      message:
        'Could not get a Page access token. Check that the system user has been granted access to that Page in Business Settings.',
    };
  }

  // The forms are discovered rather than configured: a marketer creating a new
  // form should not have to add it here for its leads to arrive.
  let forms: { id: string; name?: string }[];
  try {
    forms = await fetchPageLeadForms(pageId, pageToken);
  } catch (cause) {
    return { ok: false, message: describeMetaError(cause) };
  }

  if (forms.length === 0) {
    return { ok: true, message: 'That Page has no lead forms.' };
  }

  let created = 0;
  let duplicates = 0;
  const failures: string[] = [];

  for (const form of forms) {
    let leads;
    try {
      leads = await fetchFormLeads(form.id, pageToken, sinceUnix);
    } catch (cause) {
      failures.push(`${form.name ?? form.id}: ${describeMetaError(cause)}`);
      continue;
    }

    for (const lead of leads) {
      const outcome = await ingestMetaLead(supabase, credential, lead, form.name ?? null);
      if (outcome.status === 'created') created += 1;
      else if (outcome.status === 'duplicate') duplicates += 1;
      else failures.push(`Lead ${lead.id}: ${outcome.error ?? 'failed'}`);
    }
  }

  if (created > 0) {
    revalidatePath('/contacts');
    revalidatePath('/dashboard');
  }
  revalidatePath('/settings');

  const parts = [`${created} new`, `${duplicates} already imported`];
  if (failures.length > 0) parts.push(`${failures.length} failed`);

  return {
    ok: failures.length === 0,
    message: `Backfill complete — ${parts.join(', ')}.${
      failures.length > 0 ? ` First problem: ${failures[0]}` : ''
    }`,
  };
}
