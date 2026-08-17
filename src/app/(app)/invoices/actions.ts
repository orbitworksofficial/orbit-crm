'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';

/**
 * Invoice server actions (brief §06).
 *
 * Invoices are admin-only, enforced both here (`requireAdmin`) and by RLS.
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

const lineItemSchema = z.object({
  service_id: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .nullable(),
  name: z.string().trim().min(1).max(200),
  description: optionalText,
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  rate: z.coerce.number().min(0, 'Rate cannot be negative'),
});

const invoiceSchema = z.object({
  contact_id: z.string().uuid('Select a contact'),
  deal_id: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .nullable(),
  issue_date: z.string().min(1, 'Issue date is required'),
  due_date: z.string().min(1, 'Due date is required'),
  tax_rate: z.coerce.number().min(0).max(100).default(0),
  notes: optionalText,
  payment_terms: optionalText,
});

/**
 * Reads the repeated line-item fields out of the form.
 *
 * The form posts parallel arrays (`items.name[]`, `items.rate[]`, …); rows with
 * no name are treated as blank template rows and skipped.
 */
function parseLineItems(formData: FormData) {
  const names = formData.getAll('item_name').map(String);
  const descriptions = formData.getAll('item_description').map(String);
  const quantities = formData.getAll('item_quantity').map(String);
  const rates = formData.getAll('item_rate').map(String);
  const serviceIds = formData.getAll('item_service_id').map(String);

  const items: z.infer<typeof lineItemSchema>[] = [];

  for (let index = 0; index < names.length; index += 1) {
    if (!names[index]?.trim()) continue;

    const parsed = lineItemSchema.safeParse({
      service_id: serviceIds[index] ?? '',
      name: names[index],
      description: descriptions[index] ?? '',
      quantity: quantities[index] || 1,
      rate: rates[index] || 0,
    });

    if (parsed.success) items.push(parsed.data);
  }

  return items;
}

function collectFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0]);
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

export async function createInvoice(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  const parsed = invoiceSchema.safeParse({
    contact_id: formData.get('contact_id') ?? '',
    deal_id: formData.get('deal_id') ?? '',
    issue_date: formData.get('issue_date') ?? '',
    due_date: formData.get('due_date') ?? '',
    tax_rate: formData.get('tax_rate') || 0,
    notes: formData.get('notes') ?? '',
    payment_terms: formData.get('payment_terms') ?? '',
  });

  if (!parsed.success) {
    return {
      error: 'Please correct the highlighted fields.',
      fieldErrors: collectFieldErrors(parsed.error),
    };
  }

  if (new Date(parsed.data.due_date) < new Date(parsed.data.issue_date)) {
    return { error: 'The due date cannot be before the issue date.' };
  }

  const items = parseLineItems(formData);
  if (items.length === 0) {
    return { error: 'Add at least one line item.' };
  }

  const supabase = await createClient();

  // Allocates the next number under a row lock, so concurrent creation cannot
  // produce duplicates.
  const { data: invoiceNumber, error: numberError } = await supabase.rpc('next_invoice_number', {
    p_organization_id: profile.organization_id,
  });

  if (numberError || !invoiceNumber) {
    return { error: `Could not allocate an invoice number: ${numberError?.message ?? 'unknown error'}` };
  }

  const { data: invoice, error: insertError } = await supabase
    .from('invoices')
    .insert({
      ...parsed.data,
      invoice_number: invoiceNumber,
      organization_id: profile.organization_id,
      created_by: profile.id,
      status: 'draft',
    })
    .select('id')
    .single();

  if (insertError || !invoice) {
    return { error: insertError?.message ?? 'Could not create the invoice.' };
  }

  const { error: itemsError } = await supabase.from('invoice_line_items').insert(
    items.map((item, index) => ({
      ...item,
      invoice_id: invoice.id,
      sort_order: index,
    })),
  );

  if (itemsError) {
    // Roll back by hand: the invoice row would otherwise be left with no lines.
    // (Postgres has no cross-statement transaction over PostgREST calls.)
    await supabase.from('invoices').delete().eq('id', invoice.id);
    return { error: `Could not save the line items: ${itemsError.message}` };
  }

  revalidatePath('/invoices');
  redirect(`/invoices/${invoice.id}`);
}

export async function updateInvoice(
  invoiceId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const parsed = invoiceSchema.safeParse({
    contact_id: formData.get('contact_id') ?? '',
    deal_id: formData.get('deal_id') ?? '',
    issue_date: formData.get('issue_date') ?? '',
    due_date: formData.get('due_date') ?? '',
    tax_rate: formData.get('tax_rate') || 0,
    notes: formData.get('notes') ?? '',
    payment_terms: formData.get('payment_terms') ?? '',
  });

  if (!parsed.success) {
    return {
      error: 'Please correct the highlighted fields.',
      fieldErrors: collectFieldErrors(parsed.error),
    };
  }

  if (new Date(parsed.data.due_date) < new Date(parsed.data.issue_date)) {
    return { error: 'The due date cannot be before the issue date.' };
  }

  const items = parseLineItems(formData);
  if (items.length === 0) {
    return { error: 'Add at least one line item.' };
  }

  const supabase = await createClient();

  const { error: updateError } = await supabase
    .from('invoices')
    .update(parsed.data)
    .eq('id', invoiceId);

  if (updateError) {
    return { error: updateError.message };
  }

  // Replace the line items wholesale. Simpler and safer than diffing, and the
  // ids are not referenced anywhere else.
  await supabase.from('invoice_line_items').delete().eq('invoice_id', invoiceId);

  const { error: itemsError } = await supabase.from('invoice_line_items').insert(
    items.map((item, index) => ({ ...item, invoice_id: invoiceId, sort_order: index })),
  );

  if (itemsError) {
    return { error: `Could not save the line items: ${itemsError.message}` };
  }

  revalidatePath('/invoices');
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}`);
}

/**
 * Updates invoice status. `paid_at` is stamped or cleared alongside, so the
 * revenue report never sees a paid invoice with no payment date.
 */
export async function setInvoiceStatus(
  invoiceId: string,
  status: 'draft' | 'sent' | 'paid' | 'void',
) {
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase
    .from('invoices')
    .update({
      status,
      paid_at: status === 'paid' ? new Date().toISOString() : null,
    })
    .eq('id', invoiceId);

  if (error) {
    throw new Error(`Could not update the invoice status: ${error.message}`);
  }

  revalidatePath('/invoices');
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath('/reports');
}

export async function deleteInvoice(invoiceId: string) {
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase.from('invoices').delete().eq('id', invoiceId);

  if (error) {
    throw new Error(`Could not delete the invoice: ${error.message}`);
  }

  revalidatePath('/invoices');
  redirect('/invoices');
}
