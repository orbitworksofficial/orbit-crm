'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireProfile, requireAdmin } from '@/lib/auth';

/**
 * Contact server actions.
 *
 * Every write goes through the session-scoped client, so Row Level Security
 * applies. These actions validate shape and provide friendly errors; RLS is
 * what actually enforces who may touch which row.
 */

export interface ActionState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** Treats empty form strings as SQL NULL rather than storing "". */
const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable();

const optionalUuid = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .refine(
    (value) => value === null || z.string().uuid().safeParse(value).success,
    'Invalid selection',
  );

const contactSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required').max(200),
  email: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .refine(
      (value) => value === null || z.string().email().safeParse(value).success,
      'Enter a valid email address',
    ),
  whatsapp_number: optionalText,
  company_name: optionalText,
  industry: optionalText,
  city: optionalText,
  country: optionalText,
  lead_source_id: optionalUuid,
  lead_status_id: optionalUuid,
  assigned_to: optionalUuid,
});

function parseContactForm(formData: FormData) {
  return contactSchema.safeParse({
    full_name: formData.get('full_name') ?? '',
    email: formData.get('email') ?? '',
    whatsapp_number: formData.get('whatsapp_number') ?? '',
    company_name: formData.get('company_name') ?? '',
    industry: formData.get('industry') ?? '',
    city: formData.get('city') ?? '',
    country: formData.get('country') ?? '',
    lead_source_id: formData.get('lead_source_id') ?? '',
    lead_status_id: formData.get('lead_status_id') ?? '',
    assigned_to: formData.get('assigned_to') ?? '',
  });
}

function collectFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0]);
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

/** Replaces a contact's service tags with exactly the supplied set. */
async function syncContactServices(contactId: string, serviceIds: string[]) {
  const supabase = await createClient();

  await supabase.from('contact_services').delete().eq('contact_id', contactId);

  if (serviceIds.length > 0) {
    await supabase
      .from('contact_services')
      .insert(serviceIds.map((serviceId) => ({ contact_id: contactId, service_id: serviceId })));
  }
}

export async function createContact(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();
  const parsed = parseContactForm(formData);

  if (!parsed.success) {
    return { error: 'Please correct the highlighted fields.', fieldErrors: collectFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const serviceIds = formData.getAll('service_ids').map(String).filter(Boolean);

  // A sales user may only own their own contacts; RLS would reject anything
  // else, so default the owner to the creator rather than failing the insert.
  const assignedTo =
    profile.role === 'admin' ? parsed.data.assigned_to : profile.id;

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      ...parsed.data,
      assigned_to: assignedTo,
      organization_id: profile.organization_id,
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { error: error?.message ?? 'Could not create the contact.' };
  }

  await syncContactServices(data.id, serviceIds);

  revalidatePath('/contacts');
  revalidatePath('/dashboard');
  redirect(`/contacts/${data.id}`);
}

export async function updateContact(
  contactId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();
  const parsed = parseContactForm(formData);

  if (!parsed.success) {
    return { error: 'Please correct the highlighted fields.', fieldErrors: collectFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const serviceIds = formData.getAll('service_ids').map(String).filter(Boolean);

  // Reassignment is an admin action. For sales users the column is dropped from
  // the payload entirely, which leaves the existing owner untouched.
  const payload = { ...parsed.data };
  if (profile.role !== 'admin') {
    delete (payload as Partial<typeof payload>).assigned_to;
  }

  const { error } = await supabase.from('contacts').update(payload).eq('id', contactId);

  if (error) {
    return { error: error.message };
  }

  await syncContactServices(contactId, serviceIds);

  revalidatePath('/contacts');
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath('/dashboard');
  redirect(`/contacts/${contactId}`);
}

export async function deleteContact(contactId: string) {
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase.from('contacts').delete().eq('id', contactId);

  if (error) {
    throw new Error(`Could not delete the contact: ${error.message}`);
  }

  revalidatePath('/contacts');
  revalidatePath('/dashboard');
  redirect('/contacts');
}

/* -------------------------------------------------------------------------- */
/* Notes                                                                       */
/* -------------------------------------------------------------------------- */

const noteSchema = z.object({
  body: z.string().trim().min(1, 'Note cannot be empty').max(5000),
  next_action_at: optionalText,
  next_action_description: optionalText,
});

export async function addContactNote(
  contactId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();

  const parsed = noteSchema.safeParse({
    body: formData.get('body') ?? '',
    next_action_at: formData.get('next_action_at') ?? '',
    next_action_description: formData.get('next_action_description') ?? '',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('notes').insert({
    contact_id: contactId,
    organization_id: profile.organization_id,
    author_id: profile.id,
    ...parsed.data,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/contacts/${contactId}`);
  return {};
}

export async function deleteNote(noteId: string, contactId: string) {
  await requireProfile();

  const supabase = await createClient();
  await supabase.from('notes').delete().eq('id', noteId);

  revalidatePath(`/contacts/${contactId}`);
}

/**
 * Quick lead-status change from the contact detail page.
 *
 * Exists so marking a lead won or lost does not mean opening the full edit
 * form — and because those two outcomes are what the CRM feeds back to Meta,
 * so the path has to be short enough that salespeople actually use it.
 */
export async function setContactStatus(contactId: string, statusId: string) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: updated, error } = await supabase
    .from('contacts')
    .update({ lead_status_id: statusId })
    .eq('id', contactId)
    .select(
      'id, organization_id, meta_lead_id, meta_created_at, lead_status:lead_statuses(name, is_won, is_lost)',
    )
    .single();

  if (error || !updated) {
    throw new Error(`Could not update the lead status: ${error?.message ?? 'not found'}`);
  }

  const leadStatus = updated.lead_status as unknown as {
    name: string;
    is_won: boolean;
    is_lost: boolean;
  } | null;

  await supabase.from('activity_log').insert({
    organization_id: profile.organization_id,
    contact_id: contactId,
    event_type: 'contact.status_changed',
    description: `Lead status changed to ${leadStatus?.name ?? 'unknown'}`,
    actor_id: profile.id,
  });

  // Tells Meta whether this lead was worth having, when it came from Meta.
  // Failures are logged rather than thrown: a Meta outage must not stop a
  // salesperson recording what happened.
  const { queueMetaFeedback } = await import('@/lib/meta/feedback');
  await queueMetaFeedback(supabase, {
    id: updated.id,
    organization_id: updated.organization_id,
    meta_lead_id: updated.meta_lead_id,
    meta_created_at: updated.meta_created_at,
    leadStatus,
  });

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath('/contacts');
  revalidatePath('/dashboard');
}
