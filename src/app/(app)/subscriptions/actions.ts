'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import type { SubscriptionStatus } from '@/lib/supabase/database.types';

/**
 * Retainer server actions (Phase 2: "Subscription Tracking").
 *
 * Deliberately does not generate invoices. A due retainer surfaces as a
 * reminder and a person raises the invoice, so a wrong amount or a quietly
 * cancelled client cannot be billed before anyone notices.
 *
 * What it does do is remove the retyping: `prepareInvoiceFromSubscription`
 * hands the invoice form a pre-filled draft.
 */

export interface ActionState {
  error?: string;
  success?: string;
}

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable();

const subscriptionSchema = z.object({
  contact_id: z.string().uuid('Select a contact'),
  name: z.string().trim().min(1, 'Give the retainer a name').max(200),
  description: optionalText,
  amount: z.coerce.number().positive('Enter an amount greater than zero'),
  cycle: z.enum(['monthly', 'quarterly', 'annual']),
  started_on: z.string().min(1, 'Set a start date'),
  next_billing_date: z.string().min(1, 'Set the next billing date'),
  ends_on: optionalText,
  reminder_days: z.coerce.number().int().min(0).max(90).default(7),
});

function parseForm(formData: FormData) {
  return subscriptionSchema.safeParse({
    contact_id: formData.get('contact_id') ?? '',
    name: formData.get('name') ?? '',
    description: formData.get('description') ?? '',
    amount: formData.get('amount') || 0,
    cycle: formData.get('cycle') ?? 'monthly',
    started_on: formData.get('started_on') ?? '',
    next_billing_date: formData.get('next_billing_date') ?? '',
    ends_on: formData.get('ends_on') ?? '',
    reminder_days: formData.get('reminder_days') || 7,
  });
}

/** Replaces the retainer's covered services with exactly the supplied set. */
async function syncServices(
  subscriptionId: string,
  services: { service_id: string; quantity: number; rate: number }[],
) {
  const supabase = await createClient();
  await supabase.from('subscription_services').delete().eq('subscription_id', subscriptionId);
  if (services.length > 0) {
    await supabase
      .from('subscription_services')
      .insert(services.map((s) => ({ ...s, subscription_id: subscriptionId })));
  }
}

/** Reads the parallel service arrays the form posts. */
function parseServices(formData: FormData) {
  const ids = formData.getAll('service_id').map(String);
  const quantities = formData.getAll('service_quantity').map(String);
  const rates = formData.getAll('service_rate').map(String);

  const rows: { service_id: string; quantity: number; rate: number }[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    if (!ids[i]) continue;
    const quantity = Number(quantities[i] || 1);
    const rate = Number(rates[i] || 0);
    if (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(rate) && rate >= 0) {
      rows.push({ service_id: ids[i], quantity, rate });
    }
  }
  return rows;
}

export async function createSubscription(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();
  const parsed = parseForm(formData);

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('subscriptions')
    .insert({
      ...parsed.data,
      organization_id: profile.organization_id,
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { error: error?.message ?? 'Could not create the retainer.' };
  }

  await syncServices(data.id, parseServices(formData));

  revalidatePath('/subscriptions');
  revalidatePath('/', 'layout'); // the sidebar badge counts due retainers
  redirect(`/subscriptions`);
}

export async function updateSubscription(
  subscriptionId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();
  const parsed = parseForm(formData);

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from('subscriptions')
    .update(parsed.data)
    .eq('id', subscriptionId);

  if (error) return { error: error.message };

  await syncServices(subscriptionId, parseServices(formData));

  revalidatePath('/subscriptions');
  revalidatePath('/', 'layout');
  redirect('/subscriptions');
}

/** Pauses, resumes, or cancels. `cancelled_at` is stamped by a trigger. */
export async function setSubscriptionStatus(
  subscriptionId: string,
  status: SubscriptionStatus,
) {
  await requireProfile();

  const supabase = await createClient();
  const { error } = await supabase
    .from('subscriptions')
    .update({ status })
    .eq('id', subscriptionId);

  if (error) throw new Error(`Could not update the retainer: ${error.message}`);

  revalidatePath('/subscriptions');
  revalidatePath('/', 'layout');
}

/**
 * Moves the retainer to its next cycle, after an invoice has been raised.
 *
 * Separate from invoicing on purpose: marking a cycle billed is the user
 * confirming the invoice went out, not the system assuming it did.
 */
export async function markCycleBilled(
  subscriptionId: string,
): Promise<{ nextDate?: string; error?: string }> {
  await requireProfile();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('advance_subscription_billing', {
    p_subscription_id: subscriptionId,
  });

  if (error) return { error: error.message };

  revalidatePath('/subscriptions');
  revalidatePath('/', 'layout');
  return { nextDate: data ?? undefined };
}

/**
 * Creates a draft invoice pre-filled from the retainer, and advances the cycle.
 *
 * This is the one place the two are coupled, and only because the user asked
 * for it explicitly by clicking. The invoice is a DRAFT — nothing reaches a
 * client without being reviewed and sent.
 */
export async function prepareInvoiceFromSubscription(
  subscriptionId: string,
): Promise<{ invoiceId?: string; error?: string }> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('id, contact_id, deal_id, name, amount, currency, next_billing_date')
    .eq('id', subscriptionId)
    .maybeSingle();

  if (!subscription) return { error: 'That retainer is not available.' };

  const { data: covered } = await supabase
    .from('subscription_services')
    .select('service_id, quantity, rate, service:services(name)')
    .eq('subscription_id', subscriptionId);

  const { data: org } = await supabase
    .from('organizations')
    .select('default_tax_rate, default_payment_terms_days')
    .eq('id', profile.organization_id)
    .single();

  const { data: number, error: numberError } = await supabase.rpc('next_invoice_number', {
    p_organization_id: profile.organization_id,
  });
  if (numberError || !number) {
    return { error: `Could not allocate an invoice number: ${numberError?.message ?? 'unknown'}` };
  }

  const termsDays = org?.default_payment_terms_days ?? 30;
  const issueDate = new Date();
  const dueDate = new Date(issueDate.getTime() + termsDays * 86_400_000);

  const { data: invoice, error: insertError } = await supabase
    .from('invoices')
    .insert({
      organization_id: profile.organization_id,
      contact_id: subscription.contact_id,
      deal_id: subscription.deal_id,
      invoice_number: number,
      status: 'draft',
      issue_date: issueDate.toISOString().slice(0, 10),
      due_date: dueDate.toISOString().slice(0, 10),
      tax_rate: org?.default_tax_rate ?? 0,
      payment_terms: `Net ${termsDays}`,
      notes: `Retainer: ${subscription.name}`,
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (insertError || !invoice) {
    return { error: insertError?.message ?? 'Could not create the invoice.' };
  }

  // Line items from the covered services, falling back to a single line for
  // the retainer amount when no services were itemised.
  type CoveredRow = {
    service_id: string;
    quantity: number;
    rate: number;
    service: { name: string } | null;
  };
  const rows = (covered ?? []) as unknown as CoveredRow[];

  // Annotated explicitly: the two branches otherwise infer conflicting literal
  // types for the nullable columns.
  const lineItems: {
    invoice_id: string;
    service_id: string | null;
    name: string;
    description: string | null;
    quantity: number;
    rate: number;
    sort_order: number;
  }[] =
    rows.length > 0
      ? rows.map((row, index) => ({
          invoice_id: invoice.id,
          service_id: row.service_id,
          name: row.service?.name ?? subscription.name,
          description: null,
          quantity: row.quantity,
          rate: row.rate,
          sort_order: index,
        }))
      : [
          {
            invoice_id: invoice.id,
            service_id: null,
            name: subscription.name,
            description: 'Recurring retainer',
            quantity: 1,
            rate: subscription.amount,
            sort_order: 0,
          },
        ];

  const { error: itemsError } = await supabase.from('invoice_line_items').insert(lineItems);
  if (itemsError) {
    await supabase.from('invoices').delete().eq('id', invoice.id);
    return { error: `Could not add the line items: ${itemsError.message}` };
  }

  // Advance only after the invoice exists, so a failure leaves the retainer due
  // rather than silently skipping a cycle.
  await supabase.rpc('advance_subscription_billing', { p_subscription_id: subscriptionId });

  revalidatePath('/subscriptions');
  revalidatePath('/invoices');
  revalidatePath('/', 'layout');
  return { invoiceId: invoice.id };
}

export async function deleteSubscription(subscriptionId: string) {
  await requireProfile();

  const supabase = await createClient();
  const { error } = await supabase.from('subscriptions').delete().eq('id', subscriptionId);

  if (error) throw new Error(`Could not delete the retainer: ${error.message}`);

  revalidatePath('/subscriptions');
  revalidatePath('/', 'layout');
  redirect('/subscriptions');
}
