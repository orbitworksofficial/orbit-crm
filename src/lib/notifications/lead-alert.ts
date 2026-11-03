import 'server-only';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptSecret } from '@/lib/crypto';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Telling the team a lead has arrived.
 *
 * The realtime refresh only helps whoever already has the CRM open; a lead
 * that lands overnight sits unseen until morning. This is the path that
 * reaches someone who is not looking.
 *
 * Non-blocking by construction: the send happens after the response, and every
 * failure writes a row and returns. Capturing the lead is the valuable part —
 * it must never fail because a mail provider is slow.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 10_000;

export interface LeadAlert {
  contactId: string;
  organizationId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  city: string | null;
  message: string | null;
  campaign: string | null;
  formName: string | null;
  /** Answers to questions with no column of their own. */
  customFields: Record<string, string>;
  sourceSlug: string;
  sourceName: string;
}

interface AlertSettings {
  apiKey: string;
  fromAddress: string;
  /** Where "view the lead" points. Derived from the request, not configured. */
  crmBaseUrl: string;
}

/** Reads the Resend credentials, stored encrypted like every other secret. */
async function loadSettings(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<AlertSettings | null> {
  const { data } = await supabase
    .from('ad_credentials')
    .select('account_id, access_token, is_active, config')
    .eq('organization_id', organizationId)
    .eq('platform', 'resend')
    .maybeSingle();

  if (!data || !data.is_active || !data.access_token) return null;

  try {
    return {
      apiKey: decryptSecret(data.access_token),
      fromAddress: data.account_id || 'outreach@orb-itworks.com',
      crmBaseUrl: data.config?.crm_url ?? 'https://crm.orb-itworks.com',
    };
  } catch {
    console.error('[lead-alert] Could not decrypt the Resend key.');
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds the alert.
 *
 * Deliberately plain: the point is to be read in three seconds on a phone and
 * acted on. Phone and email are tappable because for a Meta lead those are the
 * only two ways to reach someone, and retyping a number from an email is how a
 * lead goes cold.
 */
function renderEmail(alert: LeadAlert, crmUrl: string): { subject: string; html: string; text: string } {
  const subject = `New lead: ${alert.fullName} — ${alert.sourceName}`;
  const link = `${crmUrl.replace(/\/+$/, '')}/contacts/${alert.contactId}`;

  const rows: [string, string | null][] = [
    ['Email', alert.email],
    ['Phone', alert.phone],
    ['Company', alert.companyName],
    ['Location', alert.city],
    ['Source', alert.sourceName],
    ['Campaign', alert.campaign],
    ['Form', alert.formName],
    ...Object.entries(alert.customFields).map(
      ([k, v]) => [k.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()), v] as [string, string],
    ),
  ];

  const present = rows.filter(([, v]) => v !== null && v !== '');

  const htmlRows = present
    .map(([label, value]) => {
      const safe = escapeHtml(String(value));
      let rendered = safe;
      if (label === 'Email') rendered = `<a href="mailto:${safe}" style="color:#2563eb">${safe}</a>`;
      if (label === 'Phone') {
        const dial = String(value).replace(/[^\d+]/g, '');
        rendered = `<a href="tel:${dial}" style="color:#2563eb">${safe}</a>`;
      }
      return `<tr><td style="padding:6px 16px 6px 0;color:#6b7280;font-size:14px;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;color:#111827;font-size:14px">${rendered}</td></tr>`;
    })
    .join('');

  const messageBlock = alert.message
    ? `<p style="margin:20px 0 6px;color:#6b7280;font-size:13px">What they said</p>
       <div style="padding:12px 14px;background:#f9fafb;border-left:3px solid #e5e7eb;color:#374151;font-size:14px;white-space:pre-wrap">${escapeHtml(alert.message)}</div>`
    : '';

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
    <p style="margin:0 0 4px;color:#6b7280;font-size:13px">New lead</p>
    <h1 style="margin:0 0 20px;font-size:22px;color:#111827">${escapeHtml(alert.fullName)}</h1>
    <table style="border-collapse:collapse;width:100%">${htmlRows}</table>
    ${messageBlock}
    <a href="${link}" style="display:inline-block;margin-top:24px;padding:11px 20px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px">Open in the CRM</a>
  </div>
</body></html>`;

  const text = [
    `New lead: ${alert.fullName}`,
    '',
    ...present.map(([label, value]) => `${label}: ${value}`),
    ...(alert.message ? ['', 'What they said:', alert.message] : []),
    '',
    link,
  ].join('\n');

  return { subject, html, text };
}

/** Records a decision not to send, with the reason. */
async function logSkip(
  supabase: SupabaseClient<Database>,
  alert: LeadAlert,
  reason: string,
): Promise<void> {
  await supabase.from('lead_notifications').upsert(
    {
      organization_id: alert.organizationId,
      contact_id: alert.contactId,
      status: 'skipped',
      error: reason,
    },
    { onConflict: 'contact_id' },
  );
}

/**
 * Alerts the team about a newly captured lead.
 *
 * Safe to call for every inbound lead: the source toggle, the recipient list
 * and the one-row-per-contact constraint decide whether anything is sent.
 */
export async function sendLeadAlert(
  supabase: SupabaseClient<Database>,
  alert: LeadAlert,
): Promise<void> {
  const [{ data: source }, { data: recipients }] = await Promise.all([
    supabase
      .from('lead_sources')
      .select('notify_on_lead')
      .eq('organization_id', alert.organizationId)
      .eq('slug', alert.sourceSlug)
      .maybeSingle(),
    supabase
      .from('notification_recipients')
      .select('email')
      .eq('organization_id', alert.organizationId)
      .eq('is_active', true),
  ]);

  // Turned off for this source. No row — this is a setting, not a failure.
  if (source && !source.notify_on_lead) return;

  const addresses = (recipients ?? []).map((r) => r.email);
  if (addresses.length === 0) {
    await logSkip(supabase, alert, 'No notification recipients are configured.');
    return;
  }

  const settings = await loadSettings(supabase, alert.organizationId);
  if (!settings) {
    await logSkip(supabase, alert, 'Email notifications are not connected in Settings.');
    return;
  }

  // Claim the contact first. The unique constraint is what stops a retried
  // webhook alerting the same lead twice.
  const { error: claimError } = await supabase.from('lead_notifications').insert({
    organization_id: alert.organizationId,
    contact_id: alert.contactId,
    status: 'skipped',
    error: 'Queued.',
    recipients: addresses,
  });

  if (claimError) {
    if (claimError.code !== '23505') {
      console.error('[lead-alert] Could not record the alert:', claimError);
    }
    return;
  }

  const { subject, html, text } = renderEmail(alert, settings.crmBaseUrl);

  after(async () => {
    const admin = createAdminClient();

    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          from: settings.fromAddress,
          to: addresses,
          subject,
          html,
          text,
          // So a reply goes to the lead rather than into the sending mailbox.
          ...(alert.email ? { reply_to: alert.email } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      });

      const body = (await res.json().catch(() => null)) as
        | { id?: string; message?: string; name?: string }
        | null;

      await admin
        .from('lead_notifications')
        .update(
          res.ok
            ? { status: 'sent', error: null, provider_id: body?.id ?? null }
            : {
                status: 'failed',
                error: (body?.message ?? `Resend returned ${res.status}`).slice(0, 400),
              },
        )
        .eq('contact_id', alert.contactId);

      if (!res.ok) {
        console.error(`[lead-alert] Resend rejected the alert: ${body?.message ?? res.status}`);
      }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'unknown error';
      await admin
        .from('lead_notifications')
        .update({ status: 'failed', error: `Could not reach Resend: ${reason}`.slice(0, 400) })
        .eq('contact_id', alert.contactId);
    }
  });
}
