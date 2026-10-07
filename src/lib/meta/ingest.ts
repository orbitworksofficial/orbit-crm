import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createInboundContact } from '@/lib/leads/intake';
import type { Database } from '@/lib/supabase/database.types';
import { fetchLead, fetchPageAccessToken } from './client';
import { normalizeLead } from './normalize';
import { campaignKey, type MetaLead } from './types';
import type { MetaCredential } from './credentials';

/**
 * Turning a Meta lead into a CRM contact.
 *
 * Shared by the webhook and the backfill so the two cannot diverge: a lead
 * imported by the recovery path must be indistinguishable from one delivered in
 * real time, or the backfill becomes a source of second-class records.
 */

export const META_LEAD_SOURCE_SLUG = 'meta_lead_ads';

export interface IngestOutcome {
  leadId: string;
  status: 'created' | 'duplicate' | 'failed';
  contactId?: string;
  error?: string;
}

/** Imports an already-fetched lead. */
export async function ingestMetaLead(
  supabase: SupabaseClient<Database>,
  credential: MetaCredential,
  lead: MetaLead,
  formName?: string | null,
): Promise<IngestOutcome> {
  const normalized = normalizeLead(lead);

  const result = await createInboundContact(supabase, {
    organizationId: credential.organizationId,
    contact: {
      full_name: normalized.fullName,
      email: normalized.email,
      whatsapp_number: normalized.phone,
      company_name: normalized.companyName,
      city: normalized.city,
      country: normalized.country,
      custom_fields: normalized.customFields,

      // A Lead Ads submission never passes through our site, so there are no
      // UTM parameters to read. These are synthesised so the lead still appears
      // in attribution reporting alongside click-through traffic.
      utm_source: 'facebook',
      utm_medium: 'paid_social',
      utm_campaign: campaignKey(lead.campaign_name),
      external_ref: lead.id,

      meta_lead_id: lead.id,
      meta_form_id: lead.form_id ?? null,
      meta_form_name: formName ?? null,
      meta_ad_id: lead.ad_id ?? null,
      meta_created_at: lead.created_time ?? null,
    },
    sourceSlug: META_LEAD_SOURCE_SLUG,
    message: normalized.message,
    noteHeading: 'Meta lead form',
    activityDescription: 'Lead captured from Meta Lead Ads',
    activityMetadata: {
      source: META_LEAD_SOURCE_SLUG,
      meta_lead_id: lead.id,
      campaign: lead.campaign_name ?? null,
      ad: lead.ad_name ?? null,
      form: formName ?? lead.form_id ?? null,
    },
  });

  if (!result.ok) {
    return { leadId: lead.id, status: 'failed', error: result.error };
  }

  return {
    leadId: lead.id,
    status: result.duplicate ? 'duplicate' : 'created',
    contactId: result.contactId,
  };
}

/**
 * Fetches a lead by id, then imports it.
 *
 * The two steps are separate because the webhook only ever receives an id,
 * while the backfill already holds the full lead and must not re-fetch it.
 */
export async function fetchAndIngestMetaLead(
  supabase: SupabaseClient<Database>,
  credential: MetaCredential,
  leadgenId: string,
): Promise<IngestOutcome> {
  if (!credential.adsToken) {
    return {
      leadId: leadgenId,
      status: 'failed',
      error: 'No Meta ads token is configured, so the lead could not be fetched.',
    };
  }

  try {
    // Reading a lead requires a Page access token: Meta rejects a system user
    // token on this endpoint with "(#190) This method must be called with a
    // Page Access Token". The Page token is derived from the stored one rather
    // than stored separately, so there is nothing extra to keep in sync.
    const pageId = credential.config.page_id;
    let token = credential.adsToken;

    if (pageId) {
      const pageToken = await fetchPageAccessToken(pageId, credential.adsToken);
      if (pageToken) token = pageToken;
    }

    const lead = await fetchLead(leadgenId, token);
    return await ingestMetaLead(supabase, credential, lead);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Unknown error';
    return { leadId: leadgenId, status: 'failed', error: message };
  }
}
