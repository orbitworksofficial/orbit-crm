import { after, NextResponse, type NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  findCredentialByPageId,
  findOrganizationByVerifyToken,
  recordSyncResult,
} from '@/lib/meta/credentials';
import { fetchAndIngestMetaLead } from '@/lib/meta/ingest';
import type { LeadgenWebhookBody } from '@/lib/meta/types';

/**
 * Meta Lead Ads delivery endpoint.
 *
 * Two unauthenticated entry points, each with its own proof of origin:
 *
 *   GET  — Meta's one-time subscription handshake. Proven by the verify token,
 *          which the CRM generates and the user pastes into Meta.
 *   POST — a lead was submitted. Proven by an HMAC signature over the raw body,
 *          keyed with the app secret.
 *
 * Excluded from the middleware matcher, since a redirect to /login would make
 * the endpoint impossible for Meta to verify.
 *
 * Worth knowing about the payload: a delivery contains no lead data, only a
 * leadgen_id. The answers need a second Graph call, which is why ingestion
 * happens after the response rather than inside it.
 */

// Node runtime: node:crypto for the HMAC, and the Supabase service-role client.
export const runtime = 'nodejs';

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */
/**
 * The GET path is an unauthenticated lookup keyed on attacker-supplied input.
 * The token is 32 random bytes so guessing it is infeasible, but there is no
 * reason to serve unlimited attempts. Same fixed-window approach as
 * /api/leads: per-instance and reset on cold start, so a dampener rather than
 * a guarantee.
 */
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    if (rateLimitBuckets.size > 5000) {
      for (const [bucketKey, value] of rateLimitBuckets) {
        if (now > value.resetAt) rateLimitBuckets.delete(bucketKey);
      }
    }
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

/* -------------------------------------------------------------------------- */
/* GET — subscription verification                                            */
/* -------------------------------------------------------------------------- */

export async function GET(request: NextRequest) {
  if (isRateLimited(clientIp(request))) {
    return new NextResponse('Too Many Requests', { status: 429 });
  }

  const params = request.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token') ?? '';
  const challenge = params.get('hub.challenge') ?? '';

  if (mode !== 'subscribe' || challenge === '') {
    return new NextResponse('Bad Request', { status: 400 });
  }

  const organizationId = await findOrganizationByVerifyToken(token);

  // One response for both "wrong token" and "no Meta credential exists", so
  // the endpoint cannot be used to discover whether this CRM has Meta
  // connected.
  if (!organizationId) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Meta requires the challenge echoed as the raw body. JSON-encoding it —
  // quotes included — fails verification with no useful error.
  return new NextResponse(challenge, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/* -------------------------------------------------------------------------- */
/* POST — lead delivery                                                       */
/* -------------------------------------------------------------------------- */

/** Constant-time compare of the signature header against our own digest. */
function signatureMatches(header: string, rawBody: string, appSecret: string): boolean {
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  // Read the body as text FIRST. The HMAC covers the exact bytes Meta sent, so
  // parsing and re-serialising would produce a different digest and fail every
  // signature check.
  const rawBody = await request.text();

  let body: LeadgenWebhookBody;
  try {
    body = JSON.parse(rawBody) as LeadgenWebhookBody;
  } catch {
    return new NextResponse('Bad Request', { status: 400 });
  }

  // page_id is the only identifier a delivery carries that maps to a stored
  // credential.
  const pageId = body.entry?.[0]?.changes?.[0]?.value?.page_id ?? body.entry?.[0]?.id ?? null;
  if (!pageId) {
    console.warn('[meta/webhook] Delivery carried no page id; ignoring.');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const credential = await findCredentialByPageId(pageId);

  // 200 even when we cannot place the delivery. Meta disables a subscription
  // that keeps erroring, which would silently stop lead delivery for the
  // pages that DO work.
  if (!credential) {
    console.warn(`[meta/webhook] No Meta credential for page ${pageId}; ignoring.`);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Without the app secret there is no way to tell Meta's POSTs from anyone
  // else's, and this endpoint writes contacts. Refusing is the only safe
  // behaviour — accepting unsigned input would make it an open lead-injection
  // vector. 503 rather than 200 because this is a configuration fault worth
  // retrying once fixed.
  if (!credential.appSecret) {
    console.error('[meta/webhook] No app secret configured; refusing unsigned delivery.');
    await recordSyncResult(createAdminClient(), credential.organizationId, {
      ok: false,
      error:
        'A Meta lead arrived but no App Secret is configured, so its signature could not be verified. The lead was not imported.',
    });
    return new NextResponse('Service Unavailable', { status: 503 });
  }

  const signature = request.headers.get('x-hub-signature-256') ?? '';
  if (!signature || !signatureMatches(signature, rawBody, credential.appSecret)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const leadgenIds = (body.entry ?? [])
    .flatMap((entry) => entry.changes ?? [])
    .filter((change) => change.field === 'leadgen')
    .map((change) => change.value?.leadgen_id)
    .filter((id): id is string => Boolean(id));

  // Respond before doing the work. Meta's delivery timeout is short and each
  // lead needs its own Graph round trip, so importing inline would risk a
  // timeout — which Meta treats as a failed delivery and retries.
  if (leadgenIds.length > 0) {
    after(async () => {
      const supabase = createAdminClient();
      const failures: string[] = [];

      for (const leadgenId of leadgenIds) {
        const outcome = await fetchAndIngestMetaLead(supabase, credential, leadgenId);
        if (outcome.status === 'failed') {
          console.error(`[meta/webhook] Lead ${leadgenId} failed: ${outcome.error}`);
          failures.push(leadgenId);
        }
      }

      // Delivery is webhook-only with no reconciliation job, so a failure that
      // is never surfaced is one nobody discovers until a client asks where
      // their lead went. Writing it to the credential puts it on the Settings
      // card, where the Backfill button next to it is the remedy.
      await recordSyncResult(
        supabase,
        credential.organizationId,
        failures.length === 0
          ? { ok: true }
          : {
              ok: false,
              error: `${failures.length} Meta lead(s) could not be imported (${failures.join(', ')}). Use "Backfill leads" to retry.`,
            },
      );
    });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
