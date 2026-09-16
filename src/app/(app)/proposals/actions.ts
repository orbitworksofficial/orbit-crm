'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import type { ProposalStatus } from '@/lib/supabase/database.types';

/**
 * Proposal server actions (Phase 2: "Proposals and Quotes").
 *
 * Mirrors the invoice actions closely — same line-item parsing, same
 * transactional numbering — because a proposal is an invoice that nobody has
 * agreed to yet. Where it differs is accepting one, which can create the deal
 * the quote was for.
 *
 * Unlike invoices, these are not admin-only: a sales user quotes their own
 * accounts, which is the normal flow. RLS enforces that boundary.
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

const proposalSchema = z.object({
  contact_id: z.string().uuid('Select a contact'),
  title: z.string().trim().min(1, 'Give the proposal a title').max(200),
  summary: optionalText,
  terms: optionalText,
  issue_date: z.string().min(1, 'Issue date is required'),
  valid_until: z.string().min(1, 'Set a date the quote is valid until'),
  tax_rate: z.coerce.number().min(0).max(100).default(0),
  discount_rate: z.coerce.number().min(0).max(100).default(0),
});

const lineItemSchema = z.object({
  service_id: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable(),
  name: z.string().trim().min(1).max(200),
  description: optionalText,
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  rate: z.coerce.number().min(0, 'Rate cannot be negative'),
});

/** Reads the parallel line-item arrays the form posts, skipping blank rows. */
function parseLineItems(formData: FormData) {
  const names = formData.getAll('item_name').map(String);
  const descriptions = formData.getAll('item_description').map(String);
  const quantities = formData.getAll('item_quantity').map(String);
  const rates = formData.getAll('item_rate').map(String);
  const serviceIds = formData.getAll('item_service_id').map(String);

  const items: z.infer<typeof lineItemSchema>[] = [];
  for (let i = 0; i < names.length; i += 1) {
    if (!names[i]?.trim()) continue;
    const parsed = lineItemSchema.safeParse({
      service_id: serviceIds[i] ?? '',
      name: names[i],
      description: descriptions[i] ?? '',
      quantity: quantities[i] || 1,
      rate: rates[i] || 0,
    });
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

function parseForm(formData: FormData) {
  return proposalSchema.safeParse({
    contact_id: formData.get('contact_id') ?? '',
    title: formData.get('title') ?? '',
    summary: formData.get('summary') ?? '',
    terms: formData.get('terms') ?? '',
    issue_date: formData.get('issue_date') ?? '',
    valid_until: formData.get('valid_until') ?? '',
    tax_rate: formData.get('tax_rate') || 0,
    discount_rate: formData.get('discount_rate') || 0,
  });
}

export async function createProposal(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();
  const parsed = parseForm(formData);

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  if (new Date(parsed.data.valid_until) < new Date(parsed.data.issue_date)) {
    return { error: 'The valid-until date cannot be before the issue date.' };
  }

  const items = parseLineItems(formData);
  if (items.length === 0) {
    return { error: 'Add at least one service to quote.' };
  }

  const supabase = await createClient();

  const { data: number, error: numberError } = await supabase.rpc('next_proposal_number', {
    p_organization_id: profile.organization_id,
  });
  if (numberError || !number) {
    return { error: `Could not allocate a proposal number: ${numberError?.message ?? 'unknown'}` };
  }

  const { data: proposal, error: insertError } = await supabase
    .from('proposals')
    .insert({
      ...parsed.data,
      proposal_number: number,
      organization_id: profile.organization_id,
      created_by: profile.id,
      status: 'draft',
    })
    .select('id')
    .single();

  if (insertError || !proposal) {
    return { error: insertError?.message ?? 'Could not create the proposal.' };
  }

  const { error: itemsError } = await supabase.from('proposal_line_items').insert(
    items.map((item, index) => ({ ...item, proposal_id: proposal.id, sort_order: index })),
  );

  if (itemsError) {
    // Roll back by hand: PostgREST gives no cross-statement transaction, and a
    // proposal with no line items is a broken record rather than an empty one.
    await supabase.from('proposals').delete().eq('id', proposal.id);
    return { error: `Could not save the services: ${itemsError.message}` };
  }

  revalidatePath('/proposals');
  redirect(`/proposals/${proposal.id}`);
}

export async function updateProposal(
  proposalId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();
  const parsed = parseForm(formData);

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  if (new Date(parsed.data.valid_until) < new Date(parsed.data.issue_date)) {
    return { error: 'The valid-until date cannot be before the issue date.' };
  }

  const items = parseLineItems(formData);
  if (items.length === 0) {
    return { error: 'Add at least one service to quote.' };
  }

  const supabase = await createClient();

  const { error } = await supabase.from('proposals').update(parsed.data).eq('id', proposalId);
  if (error) return { error: error.message };

  // Replace the items wholesale: simpler than diffing, and their ids are not
  // referenced anywhere else.
  await supabase.from('proposal_line_items').delete().eq('proposal_id', proposalId);
  const { error: itemsError } = await supabase.from('proposal_line_items').insert(
    items.map((item, index) => ({ ...item, proposal_id: proposalId, sort_order: index })),
  );
  if (itemsError) return { error: `Could not save the services: ${itemsError.message}` };

  revalidatePath('/proposals');
  revalidatePath(`/proposals/${proposalId}`);
  redirect(`/proposals/${proposalId}`);
}

/** Changes status. `responded_at` is stamped by a database trigger. */
export async function setProposalStatus(proposalId: string, status: ProposalStatus) {
  await requireProfile();

  const supabase = await createClient();
  const { error } = await supabase.from('proposals').update({ status }).eq('id', proposalId);

  if (error) throw new Error(`Could not update the proposal: ${error.message}`);

  revalidatePath('/proposals');
  revalidatePath(`/proposals/${proposalId}`);
}

/**
 * Turns an accepted proposal into a deal.
 *
 * This is the point of quoting: an accepted proposal already carries the
 * contact, the value, and the services, so re-typing them into a deal form is
 * wasted work and an opportunity to mistype the figure.
 *
 * Idempotent — a proposal already linked to a deal returns that deal rather
 * than creating a second one.
 */
export async function convertProposalToDeal(
  proposalId: string,
): Promise<{ dealId?: string; error?: string }> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: proposal } = await supabase
    .from('proposals_with_status')
    .select('id, contact_id, deal_id, title, total, currency')
    .eq('id', proposalId)
    .maybeSingle();

  if (!proposal) return { error: 'That proposal is not available.' };
  if (proposal.deal_id) return { dealId: proposal.deal_id };

  const { data: deal, error } = await supabase
    .from('deals')
    .insert({
      organization_id: profile.organization_id,
      contact_id: proposal.contact_id,
      title: proposal.title,
      value: proposal.total,
      currency: proposal.currency,
      status: 'open',
      assigned_to: profile.id,
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (error || !deal) {
    return { error: error?.message ?? 'Could not create the deal.' };
  }

  // Carry the quoted services across, so the deal's service tags match what
  // was actually proposed.
  const { data: items } = await supabase
    .from('proposal_line_items')
    .select('service_id')
    .eq('proposal_id', proposalId)
    .not('service_id', 'is', null);

  const serviceIds = [...new Set((items ?? []).map((i) => i.service_id).filter(Boolean))] as string[];
  if (serviceIds.length > 0) {
    await supabase
      .from('deal_services')
      .insert(serviceIds.map((serviceId) => ({ deal_id: deal.id, service_id: serviceId })));
  }

  await supabase.from('proposals').update({ deal_id: deal.id }).eq('id', proposalId);

  revalidatePath(`/proposals/${proposalId}`);
  revalidatePath('/deals');
  revalidatePath('/pipeline');
  return { dealId: deal.id };
}

export async function deleteProposal(proposalId: string) {
  await requireProfile();

  const supabase = await createClient();
  const { error } = await supabase.from('proposals').delete().eq('id', proposalId);

  if (error) throw new Error(`Could not delete the proposal: ${error.message}`);

  revalidatePath('/proposals');
  redirect('/proposals');
}
