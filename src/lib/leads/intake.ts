import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

/**
 * The one place a contact is created from an external source.
 *
 * Three paths now land here — the website form, the AI chatbot, and Meta Lead
 * Ads — and they must stay consistent in ways that are easy to get wrong when
 * the logic is copied: resolving the source and status by slug rather than by
 * label, attaching the opening note with a null author, linking services, and
 * writing the activity-log entry that makes the capture visible in the
 * timeline. A second implementation would drift from this one silently.
 *
 * Deliberately NOT responsible for authentication or rate limiting. Each caller
 * has a different trust model — a shared secret for the website, an HMAC
 * signature for Meta — and folding those in here would mean one function
 * pretending to serve two security models.
 */

export interface InboundContactFields {
  full_name: string;
  email?: string | null;
  whatsapp_number?: string | null;
  company_name?: string | null;
  industry?: string | null;
  city?: string | null;
  country?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  external_ref?: string | null;
  /** Answers with no column of their own. See contacts.custom_fields. */
  custom_fields?: Record<string, string>;
  meta_lead_id?: string | null;
  meta_form_id?: string | null;
  meta_form_name?: string | null;
  meta_ad_id?: string | null;
  meta_created_at?: string | null;
}

export interface IntakeInput {
  organizationId: string;
  contact: InboundContactFields;
  /** Lead source slug. An unrecognised slug stores a null source rather than
   *  rejecting the lead — losing the attribution is better than losing it. */
  sourceSlug: string;
  /** Free text from the form or conversation, stored as the opening note. */
  message?: string | null;
  /** Heading for that note, naming where the lead actually came from. */
  noteHeading?: string;
  /** Service slugs; any the catalogue does not recognise are ignored. */
  serviceSlugs?: string[];
  activityDescription: string;
  activityMetadata?: Record<string, unknown>;
}

export type IntakeResult =
  | { ok: true; contactId: string; duplicate: boolean }
  | { ok: false; error: string };

/** Resolves the single Phase 1 organization. Multi-tenancy will key this off
 *  the credential the caller presented instead. */
export async function resolveDefaultOrganization(
  supabase: SupabaseClient<Database>,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id')
    .order('created_at')
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.id;
}

export async function createInboundContact(
  supabase: SupabaseClient<Database>,
  input: IntakeInput,
): Promise<IntakeResult> {
  const { organizationId, contact, sourceSlug, message, serviceSlugs } = input;

  // Resolved by slug so renaming a display label in Settings never breaks
  // intake. Both are looked up together since neither depends on the other.
  const [{ data: leadSource }, { data: defaultStatus }] = await Promise.all([
    supabase
      .from('lead_sources')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('slug', sourceSlug)
      .maybeSingle(),
    supabase
      .from('lead_statuses')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('slug', 'new')
      .maybeSingle(),
  ]);

  const { data: inserted, error: insertError } = await supabase
    .from('contacts')
    .insert({
      ...contact,
      organization_id: organizationId,
      lead_source_id: leadSource?.id ?? null,
      lead_status_id: defaultStatus?.id ?? null,
      // Deliberately unassigned: an admin triages inbound leads. Unassigned
      // contacts are visible to admins only, per the contacts RLS policy.
      assigned_to: null,
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    // A unique violation on meta_lead_id means this lead has already been
    // imported — by the webhook, or by a previous backfill. That is the
    // expected outcome of re-running a backfill, not a failure, so the
    // existing contact is returned instead.
    if (insertError?.code === '23505' && contact.meta_lead_id) {
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('meta_lead_id', contact.meta_lead_id)
        .maybeSingle();

      if (existing) return { ok: true, contactId: existing.id, duplicate: true };
    }

    console.error('[intake] Contact insert failed:', insertError);
    return { ok: false, error: 'Could not record the lead.' };
  }

  const contactId = inserted.id;

  // author_id is null because no CRM user wrote it; the UI renders that as
  // "Unknown user". The heading names the real origin — a chatbot transcript
  // or Meta form labelled "Website enquiry" misleads whoever picks the lead
  // up, since they would expect a form submission and find something else.
  if (message) {
    const heading = input.noteHeading ?? 'Enquiry';
    await supabase.from('notes').insert({
      contact_id: contactId,
      organization_id: organizationId,
      body: `${heading}:\n\n${message}`,
      author_id: null,
    });
  }

  if (serviceSlugs && serviceSlugs.length > 0) {
    const { data: matched } = await supabase
      .from('services')
      .select('id')
      .eq('organization_id', organizationId)
      .in('slug', serviceSlugs);

    if (matched && matched.length > 0) {
      await supabase
        .from('contact_services')
        .insert(matched.map((service) => ({ contact_id: contactId, service_id: service.id })));
    }
  }

  await supabase.from('activity_log').insert({
    organization_id: organizationId,
    contact_id: contactId,
    event_type: 'contact.created',
    description: input.activityDescription,
    metadata: input.activityMetadata ?? { source: sourceSlug },
    actor_id: null,
  });

  return { ok: true, contactId, duplicate: false };
}
