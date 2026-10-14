import 'server-only';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptSecret } from '@/lib/crypto';
import type { Database } from '@/lib/supabase/database.types';
import { sendLeadToEngine } from './client';

/**
 * Deciding whether a new lead gets automated outreach, and recording what
 * happened.
 *
 * Non-blocking by construction: the handover runs after the response, and
 * every failure path writes a row and returns. Capturing a lead must never
 * fail because an email service is down — the lead is the valuable part.
 */

export interface OutreachCandidate {
  contactId: string;
  organizationId: string;
  fullName: string;
  email: string | null;
  companyName?: string | null;
  message?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  /** Slug of the lead source, which decides whether outreach applies at all. */
  sourceSlug: string;
}

interface EngineSettings {
  baseUrl: string;
  secret: string;
}

/**
 * Reads and decrypts the Email Engine connection.
 *
 * Stored like the ad credentials — in the database, encrypted, editable in
 * Settings — rather than in the environment, so the URL or a rotated secret
 * does not need a deploy.
 */
async function loadEngineSettings(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<EngineSettings | null> {
  const { data } = await supabase
    .from('ad_credentials')
    .select('account_id, access_token, is_active')
    .eq('organization_id', organizationId)
    .eq('platform', 'email_engine')
    .maybeSingle();

  if (!data || !data.is_active || !data.account_id || !data.access_token) return null;

  try {
    return { baseUrl: data.account_id, secret: decryptSecret(data.access_token) };
  } catch {
    // A rotated encryption key makes the secret unreadable. Reporting it as
    // unconfigured is better than throwing inside lead capture.
    console.error('[outreach] Could not decrypt the Email Engine secret.');
    return null;
  }
}

/** Records a decision not to send, with the reason. */
async function logSkip(
  supabase: SupabaseClient<Database>,
  candidate: OutreachCandidate,
  reason: string,
): Promise<void> {
  await supabase.from('email_outreach').upsert(
    {
      organization_id: candidate.organizationId,
      contact_id: candidate.contactId,
      status: 'skipped',
      error: reason,
    },
    { onConflict: 'contact_id' },
  );
}

/**
 * Queues automated outreach for a newly captured lead.
 *
 * Safe to call for every inbound lead: the source toggle, the suppression flag
 * and the one-row-per-contact constraint between them decide whether anything
 * is actually sent.
 */
export async function queueOutreach(
  supabase: SupabaseClient<Database>,
  candidate: OutreachCandidate,
): Promise<void> {
  // No address, nothing to send to. Not worth a row — this is a property of
  // the lead, not a failure of the integration.
  if (!candidate.email) return;

  const [{ data: source }, { data: contact }] = await Promise.all([
    supabase
      .from('lead_sources')
      .select('triggers_outreach')
      .eq('organization_id', candidate.organizationId)
      .eq('slug', candidate.sourceSlug)
      .maybeSingle(),
    supabase
      .from('contacts')
      .select('do_not_contact')
      .eq('id', candidate.contactId)
      .maybeSingle(),
  ]);

  // Referrals and cold outreach are already a personal relationship; an
  // automated "thanks for your interest" to one reads badly. The choice is
  // per-source and editable in Settings.
  if (!source?.triggers_outreach) return;

  // Honoured here rather than only in the Engine's suppression list, so a
  // re-import or a second form submission cannot resume emailing someone who
  // opted out.
  if (contact?.do_not_contact) {
    await logSkip(supabase, candidate, 'The contact is marked do not contact.');
    return;
  }

  const settings = await loadEngineSettings(supabase, candidate.organizationId);
  if (!settings) {
    await logSkip(supabase, candidate, 'The Email Engine is not connected in Settings.');
    return;
  }

  // Claim the contact before sending. The unique constraint on contact_id is
  // what stops a retried webhook or a re-saved contact starting a second
  // sequence for the same person.
  const { error: claimError } = await supabase.from('email_outreach').insert({
    organization_id: candidate.organizationId,
    contact_id: candidate.contactId,
    status: 'pending',
  });

  if (claimError) {
    // 23505 means this contact already has a sequence. Nothing to do.
    if (claimError.code !== '23505') {
      console.error('[outreach] Could not record the attempt:', claimError);
    }
    return;
  }

  // after() is what keeps lead capture fast: the response is already on its
  // way while the Engine is still being called.
  after(async () => {
    const admin = createAdminClient();

    const result = await sendLeadToEngine(settings.baseUrl, settings.secret, {
      leadId: candidate.contactId,
      fullName: candidate.fullName,
      email: candidate.email!,
      companyName: candidate.companyName,
      notes: candidate.message,
      utmSource: candidate.utmSource,
      utmMedium: candidate.utmMedium,
      utmCampaign: candidate.utmCampaign,
    });

    await admin
      .from('email_outreach')
      .update(
        result.ok
          ? {
              status: 'accepted',
              http_status: result.httpStatus,
              error: result.duplicate ? 'The Engine had already seen this lead.' : null,
              sent_at: new Date().toISOString(),
            }
          : {
              status: 'failed',
              http_status: result.httpStatus,
              error: result.error,
            },
      )
      .eq('contact_id', candidate.contactId);

    if (!result.ok) {
      console.error(`[outreach] Lead ${candidate.contactId} not queued: ${result.error}`);
    }
  });
}
