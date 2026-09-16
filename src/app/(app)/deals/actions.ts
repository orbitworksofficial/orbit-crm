'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireProfile, requireAdmin } from '@/lib/auth';

/**
 * Deal server actions.
 *
 * `closed_at` is maintained by a database trigger rather than here, so revenue
 * reporting stays correct no matter which code path changes a deal's status.
 */

export interface ActionState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

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

const dealSchema = z.object({
  title: z.string().trim().min(1, 'Deal title is required').max(200),
  contact_id: z.string().uuid('Select a contact'),
  value: z.coerce
    .number({ message: 'Enter a valid amount' })
    .min(0, 'Value cannot be negative')
    .max(1_000_000_000, 'Value is unrealistically large'),
  status: z.enum(['open', 'won', 'lost']),
  expected_close_date: optionalText,
  assigned_to: optionalUuid,
});

function parseDealForm(formData: FormData) {
  return dealSchema.safeParse({
    title: formData.get('title') ?? '',
    contact_id: formData.get('contact_id') ?? '',
    value: formData.get('value') || 0,
    status: formData.get('status') ?? 'open',
    expected_close_date: formData.get('expected_close_date') ?? '',
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

/** Replaces a deal's service tags with exactly the supplied set. */
async function syncDealServices(dealId: string, serviceIds: string[]) {
  const supabase = await createClient();

  await supabase.from('deal_services').delete().eq('deal_id', dealId);

  if (serviceIds.length > 0) {
    await supabase
      .from('deal_services')
      .insert(serviceIds.map((serviceId) => ({ deal_id: dealId, service_id: serviceId })));
  }
}

export async function createDeal(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();
  const parsed = parseDealForm(formData);

  if (!parsed.success) {
    return {
      error: 'Please correct the highlighted fields.',
      fieldErrors: collectFieldErrors(parsed.error),
    };
  }

  const supabase = await createClient();
  const serviceIds = formData.getAll('service_ids').map(String).filter(Boolean);

  // Sales users own what they create; RLS would reject any other assignment.
  const assignedTo = profile.role === 'admin' ? parsed.data.assigned_to : profile.id;

  const { data, error } = await supabase
    .from('deals')
    .insert({
      ...parsed.data,
      assigned_to: assignedTo,
      organization_id: profile.organization_id,
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { error: error?.message ?? 'Could not create the deal.' };
  }

  await syncDealServices(data.id, serviceIds);

  revalidatePath('/deals');
  revalidatePath('/dashboard');
  redirect(`/deals/${data.id}`);
}

export async function updateDeal(
  dealId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();
  const parsed = parseDealForm(formData);

  if (!parsed.success) {
    return {
      error: 'Please correct the highlighted fields.',
      fieldErrors: collectFieldErrors(parsed.error),
    };
  }

  const supabase = await createClient();
  const serviceIds = formData.getAll('service_ids').map(String).filter(Boolean);

  // Reassignment is an admin action. For sales users the column is dropped from
  // the payload entirely, which leaves the existing owner untouched.
  const payload = { ...parsed.data };
  if (profile.role !== 'admin') {
    delete (payload as Partial<typeof payload>).assigned_to;
  }

  const { error } = await supabase.from('deals').update(payload).eq('id', dealId);

  if (error) {
    return { error: error.message };
  }

  await syncDealServices(dealId, serviceIds);

  revalidatePath('/deals');
  revalidatePath(`/deals/${dealId}`);
  revalidatePath('/dashboard');
  redirect(`/deals/${dealId}`);
}

/**
 * Quick status change from the deal detail page, without a full form round-trip.
 */
export async function setDealStatus(dealId: string, status: 'open' | 'won' | 'lost') {
  await requireProfile();

  const supabase = await createClient();
  const { error } = await supabase.from('deals').update({ status }).eq('id', dealId);

  if (error) {
    throw new Error(`Could not update the deal status: ${error.message}`);
  }

  revalidatePath(`/deals/${dealId}`);
  revalidatePath('/deals');
  revalidatePath('/dashboard');
}

export async function deleteDeal(dealId: string) {
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase.from('deals').delete().eq('id', dealId);

  if (error) {
    throw new Error(`Could not delete the deal: ${error.message}`);
  }

  revalidatePath('/deals');
  revalidatePath('/dashboard');
  redirect('/deals');
}

/* -------------------------------------------------------------------------- */
/* Deal notes (brief §08: kept separate from contact notes)                    */
/* -------------------------------------------------------------------------- */

const noteSchema = z.object({
  body: z.string().trim().min(1, 'Note cannot be empty').max(5000),
  next_action_at: optionalText,
  next_action_description: optionalText,
});

export async function addDealNote(
  dealId: string,
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
    deal_id: dealId,
    organization_id: profile.organization_id,
    author_id: profile.id,
    ...parsed.data,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/deals/${dealId}`);
  return {};
}

/* -------------------------------------------------------------------------- */
/* Kanban board                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Moves a deal to a different stage and position on the board.
 *
 * `board_position` is a fraction midway between the cards either side of the
 * drop point, so a move is a single UPDATE rather than renumbering the whole
 * column. Dropping at the top or bottom offsets from the single neighbour.
 *
 * The deal's coarse `status` is *not* set here — the `sync_deal_stage_status`
 * trigger derives it from the stage's `maps_to_status`. Keeping that rule in
 * the database means dropping a card into "Closed Won" marks the deal won
 * however the row is updated, including from a future API or import.
 *
 * RLS still applies: a sales user can only move deals assigned to them.
 */
export async function moveDealToStage(
  dealId: string,
  stageId: string,
  beforePosition: number | null,
  afterPosition: number | null,
): Promise<{ error?: string }> {
  await requireProfile();

  // Midpoint between neighbours; offset from one end when dropped at an edge.
  let position: number;
  if (beforePosition != null && afterPosition != null) {
    position = (beforePosition + afterPosition) / 2;
  } else if (beforePosition != null) {
    position = beforePosition + 1000;
  } else if (afterPosition != null) {
    position = afterPosition - 1000;
  } else {
    position = Date.now() / 1000;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('deals')
    .update({ stage_id: stageId, board_position: position })
    .eq('id', dealId);

  if (error) return { error: error.message };

  revalidatePath('/pipeline');
  revalidatePath('/deals');
  revalidatePath('/dashboard');
  return {};
}
