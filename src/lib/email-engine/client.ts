import 'server-only';
import { createHmac } from 'node:crypto';

/**
 * Handing a lead to the Email Engine.
 *
 * The CRM is the single source of truth for leads; the Engine turns them into
 * booked calls. Every source — Meta, the website form, the chatbot — goes
 * through here, so outreach is configured once rather than per channel.
 */

/** The endpoint the Engine exposes for CRM-originated leads. */
const CRM_PATH = '/api/v1/webhooks/crm';

/**
 * Fallback for an Engine deployed before the /crm endpoint existed.
 *
 * Both take the same fields, so a CRM lead posted to the website endpoint is
 * handled correctly — it is only attributed as a website enquiry rather than a
 * CRM one. Better than refusing to send at all while the Engine is being
 * redeployed.
 */
const WEBSITE_PATH = '/api/v1/webhooks/website';

/** The Engine queues and returns immediately, so this only covers the handover. */
const REQUEST_TIMEOUT_MS = 10_000;

export interface OutreachLead {
  /** The CRM's contact id. The Engine echoes it back on every callback, which
   *  is how a status update finds its way to the right contact. */
  leadId: string;
  fullName: string;
  email: string;
  companyName?: string | null;
  jobTitle?: string | null;
  /** What the lead asked for, in their words. The AI writes from this. */
  notes?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}

export type OutreachResult =
  | { ok: true; httpStatus: number; duplicate: boolean }
  | { ok: false; httpStatus: number | null; error: string };

/**
 * Signs the body with HMAC-SHA256.
 *
 * The Engine accepts either the bare secret or a signature. The signature is
 * sent because it also proves the body was not altered in transit, which the
 * bare secret does not — and it costs nothing.
 */
function sign(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

async function post(
  url: string,
  rawBody: string,
  secret: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-CRM-Signature': sign(rawBody, secret),
    },
    body: rawBody,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
    /**
     * A wrong path on a proxied service answers with a redirect to a login or
     * marketing page, which returns 200 — so following redirects would report
     * success for a lead that was never queued. Treat the redirect as the
     * answer instead.
     */
    redirect: 'manual',
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }

  return { status: res.status, body };
}

export async function sendLeadToEngine(
  baseUrl: string,
  secret: string,
  lead: OutreachLead,
): Promise<OutreachResult> {
  const payload = {
    lead_id: lead.leadId,
    email: lead.email,
    full_name: lead.fullName,
    company_name: lead.companyName ?? null,
    job_title: lead.jobTitle ?? null,
    notes: lead.notes ?? null,
    utm_source: lead.utmSource ?? 'crm',
    utm_medium: lead.utmMedium ?? null,
    utm_campaign: lead.utmCampaign ?? null,
  };

  const rawBody = JSON.stringify(payload);
  const root = baseUrl.replace(/\/+$/, '');

  try {
    let result = await post(`${root}${CRM_PATH}`, rawBody, secret);

    // An Engine deployed before the /crm endpoint existed. Fall back rather
    // than dropping the lead while it waits to be redeployed.
    if (result.status === 404) {
      result = await post(`${root}${WEBSITE_PATH}`, rawBody, secret);
    }

    if (result.status >= 300 && result.status < 400) {
      return {
        ok: false,
        httpStatus: result.status,
        error: `Redirected (${result.status}) — check the Email Engine URL.`,
      };
    }

    // The Engine answers 202 for a queued lead and 200 for one it has already
    // seen. Both mean the lead is handled; only the second is a duplicate.
    if (result.status === 202 || result.status === 200) {
      const message = (result.body as { message?: string } | null)?.message ?? '';
      return {
        ok: true,
        httpStatus: result.status,
        duplicate: /duplicate/i.test(message),
      };
    }

    const detail =
      (result.body as { detail?: string; message?: string } | null)?.detail ??
      (result.body as { message?: string } | null)?.message ??
      `Email Engine returned ${result.status}`;

    return { ok: false, httpStatus: result.status, error: String(detail).slice(0, 400) };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'unknown error';
    return { ok: false, httpStatus: null, error: `Could not reach the Email Engine: ${reason}` };
  }
}

/** GET /health — proves the URL is right and the Engine is up. */
export async function checkEngineHealth(
  baseUrl: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
      redirect: 'manual',
    });

    if (!res.ok) {
      return { ok: false, detail: `Health check returned ${res.status}.` };
    }

    const body = (await res.json().catch(() => null)) as {
      status?: string;
      database?: string;
      sequence_scheduler?: string;
    } | null;

    const parts = [
      body?.status ? `status ${body.status}` : null,
      body?.database ? `database ${body.database}` : null,
      // Without the scheduler the first email sends but no follow-up ever
      // does, which looks like success until nobody replies.
      body?.sequence_scheduler ? `scheduler ${body.sequence_scheduler}` : null,
    ].filter(Boolean);

    return { ok: true, detail: parts.join(', ') || 'Reachable.' };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'unknown error';
    return { ok: false, detail: `Could not reach it: ${reason}` };
  }
}
