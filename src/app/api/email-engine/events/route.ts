import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptSecret } from '@/lib/crypto';
import type { EmailOutreach } from '@/lib/supabase/database.types';

/**
 * Status callbacks from the Email Engine.
 *
 * The Engine reports what happened to each lead it was handed: the email went
 * out, the prospect booked a call, they unsubscribed. Without this the CRM
 * would hand leads over and never learn the outcome — a salesperson would have
 * no idea whether someone had already been contacted, or had asked not to be.
 *
 * Excluded from the middleware matcher, since the Engine carries no CRM
 * session. It authenticates with the same shared secret the CRM signs its
 * outbound calls with.
 */

// Node runtime: timingSafeEqual and the service-role client.
export const runtime = 'nodejs';

/** What the Engine sends. Anything else is ignored rather than rejected, so a
 *  new event type on their side cannot start failing deliveries. */
type EngineEvent =
  | 'email_sent'
  | 'meeting_booked'
  | 'opted_out'
  | 'bounced'
  | 'replied';

interface CallbackBody {
  event_type?: string;
  /** The CRM contact id, echoed back from what we sent as lead_id. */
  lead_id?: string;
  email?: string;
  tenant_id?: string;
  details?: Record<string, unknown>;
}

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const provided = request.headers.get('x-engine-secret') ?? '';
  if (provided === '') {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let body: CallbackBody;
  try {
    body = (await request.json()) as CallbackBody;
  } catch {
    return new NextResponse('Bad Request', { status: 400 });
  }

  const leadId = body.lead_id;
  if (!leadId) {
    // Nothing to attach the event to. 200 rather than an error: the Engine
    // does not retry, and a rejected delivery would only fill its logs.
    console.warn('[email-engine] Callback carried no lead_id; ignoring.');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const supabase = createAdminClient();

  // The outreach row is what links the event to an organization — the Engine
  // knows the contact, not our tenancy.
  const { data: outreach } = await supabase
    .from('email_outreach')
    .select('id, organization_id, contact_id')
    .eq('contact_id', leadId)
    .maybeSingle();

  if (!outreach) {
    console.warn(`[email-engine] No outreach record for lead ${leadId}; ignoring.`);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // The shared secret lives with the connection, so it is read per
  // organization rather than from the environment.
  const { data: credential } = await supabase
    .from('ad_credentials')
    .select('access_token')
    .eq('organization_id', outreach.organization_id)
    .eq('platform', 'email_engine')
    .maybeSingle();

  if (!credential?.access_token) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let expected: string;
  try {
    expected = decryptSecret(credential.access_token);
  } catch {
    console.error('[email-engine] Could not decrypt the shared secret.');
    return new NextResponse('Service Unavailable', { status: 503 });
  }

  if (!secretMatches(provided, expected)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const eventType = String(body.event_type ?? '') as EngineEvent;
  const now = new Date().toISOString();

  const patch: Partial<EmailOutreach> = {
    stage: eventType,
    last_event: (body.details ?? {}) as Record<string, unknown>,
  };

  let description: string | null = null;

  switch (eventType) {
    case 'email_sent':
      patch.sent_at = now;
      description = 'Outreach email sent by the Email Engine';
      break;

    case 'meeting_booked':
      patch.booked_at = now;
      description = 'Discovery call booked';
      break;

    case 'opted_out':
      patch.opted_out_at = now;
      description = 'Lead unsubscribed from outreach';
      break;

    case 'bounced':
      description = 'Outreach email bounced';
      break;

    case 'replied':
      description = 'Lead replied to the outreach email';
      break;

    default:
      // Unknown event: record it on the row so it is visible, but do not
      // invent a timeline entry for something we do not understand.
      console.warn(`[email-engine] Unknown event type "${eventType}" for ${leadId}.`);
  }

  await supabase.from('email_outreach').update(patch).eq('id', outreach.id);

  // Unsubscribing has to change the contact, not just the outreach row — the
  // flag is what stops a future import handing them over again.
  if (eventType === 'opted_out') {
    await supabase
      .from('contacts')
      .update({
        do_not_contact: true,
        do_not_contact_at: now,
        do_not_contact_reason: 'Unsubscribed from the outreach email',
      })
      .eq('id', outreach.contact_id);
  }

  if (description) {
    await supabase.from('activity_log').insert({
      organization_id: outreach.organization_id,
      contact_id: outreach.contact_id,
      event_type: `outreach.${eventType}`,
      description,
      metadata: (body.details ?? {}) as Record<string, unknown>,
      actor_id: null,
    });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

/** Explicit 405 so a mistakenly-GET'd endpoint gives a clear answer. */
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. The Email Engine POSTs status events here.' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
