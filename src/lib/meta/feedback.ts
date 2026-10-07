import 'server-only';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { sendConversionEvent } from './client';
import { loadMetaCredential } from './credentials';

/**
 * Lead-quality feedback to Meta (the Conversions API for CRM).
 *
 * The point of the integration: Meta optimises for whatever you tell it to
 * value. Left alone it finds people who fill in forms, which produces cheap
 * leads of any quality. Told which leads turned into business, it starts
 * finding people like those instead.
 *
 * Two deliberate constraints:
 *
 *   * Quality signals only, never a monetary value. A deal usually closes
 *     after the lead's status changes, and Meta discards a duplicate event_id,
 *     so there is no path to correct a figure sent early. Sending a wrong
 *     number would be worse than sending none.
 *
 *   * Non-blocking by construction. Every failure path records a row and
 *     returns. A Meta outage, an expired token, or a mistyped pixel id must
 *     never turn a salesperson's status change into an error.
 */

/** Meta only attributes a conversion within 28 days of the lead. */
const FEEDBACK_WINDOW_DAYS = 28;

/** Meta's recommended names for the two ends of lead quality. */
const EVENT_QUALIFIED = 'Qualified';
const EVENT_DISQUALIFIED = 'Disqualified';

export interface FeedbackSubject {
  id: string;
  organization_id: string;
  meta_lead_id: string | null;
  meta_created_at: string | null;
  leadStatus: { is_won: boolean; is_lost: boolean } | null;
}

export async function queueMetaFeedback(
  supabase: SupabaseClient<Database>,
  subject: FeedbackSubject,
): Promise<void> {
  // Not a Meta lead. The common case by far, and nothing to record.
  if (!subject.meta_lead_id) return;

  const status = subject.leadStatus;
  if (!status) return;

  // Only the ends of the funnel carry a signal. "Contacted" says nothing about
  // whether the lead was any good.
  if (!status.is_won && !status.is_lost) return;

  const eventName = status.is_won ? EVENT_QUALIFIED : EVENT_DISQUALIFIED;

  // Idempotency first. The unique constraint on (organization_id, event_id,
  // event_name) is what makes a salesperson toggling Won -> Lost -> Won send
  // one event per outcome rather than one per click.
  const { data: pending, error: insertError } = await supabase
    .from('meta_conversion_events')
    .insert({
      organization_id: subject.organization_id,
      contact_id: subject.id,
      meta_lead_id: subject.meta_lead_id,
      event_name: eventName,
      event_id: `${subject.id}:${eventName}`,
      status: 'pending',
    })
    .select('id')
    .single();

  // 23505 means this exact event was already recorded, so there is nothing to
  // do — not an error.
  if (insertError) {
    if (insertError.code !== '23505') {
      console.error('[meta/feedback] Could not record the event:', insertError);
    }
    return;
  }

  const eventRowId = pending.id;

  // Measured from Meta's own timestamp: a lead backfilled late must not look
  // like it has 28 fresh days.
  const createdAt = subject.meta_created_at ? new Date(subject.meta_created_at) : null;
  if (createdAt) {
    const ageDays = (Date.now() - createdAt.getTime()) / 86_400_000;
    if (ageDays > FEEDBACK_WINDOW_DAYS) {
      await supabase
        .from('meta_conversion_events')
        .update({
          status: 'skipped',
          error: `The lead is ${Math.floor(ageDays)} days old; Meta only accepts feedback within ${FEEDBACK_WINDOW_DAYS} days.`,
        })
        .eq('id', eventRowId);
      return;
    }
  }

  const credential = await loadMetaCredential(supabase, subject.organization_id);
  const pixelId = credential?.config.pixel_id;

  if (!credential?.capiToken || !pixelId) {
    await supabase
      .from('meta_conversion_events')
      .update({
        status: 'skipped',
        error: !pixelId
          ? 'No Meta pixel ID is configured, so feedback cannot be attributed.'
          : 'No Conversions API token is configured.',
      })
      .eq('id', eventRowId);
    return;
  }

  const capiToken = credential.capiToken;
  const leadId = subject.meta_lead_id;
  const eventTime = createdAt
    ? Math.floor(createdAt.getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  // after() is what makes this non-blocking: the server action returns and the
  // page revalidates while the request to Meta is still in flight.
  after(async () => {
    // A fresh client: the caller's session may be gone by the time this runs.
    const admin = createAdminClient();

    try {
      const result = await sendConversionEvent({
        pixelId,
        capiToken,
        eventName,
        eventTime,
        eventId: `${subject.id}:${eventName}`,
        leadId,
      });

      const ok = result.httpStatus >= 200 && result.httpStatus < 300;
      await admin
        .from('meta_conversion_events')
        .update({
          status: ok ? 'sent' : 'failed',
          http_status: result.httpStatus,
          response: (result.body ?? null) as Record<string, unknown> | null,
          error: ok ? null : 'Meta rejected the event; see the response.',
          attempts: 1,
          sent_at: ok ? new Date().toISOString() : null,
        })
        .eq('id', eventRowId);
    } catch (cause) {
      await admin
        .from('meta_conversion_events')
        .update({
          status: 'failed',
          error: cause instanceof Error ? cause.message.slice(0, 500) : 'Unknown error',
          attempts: 1,
        })
        .eq('id', eventRowId);
    }
  });
}
