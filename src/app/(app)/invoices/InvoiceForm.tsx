'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { formatCurrency } from '@/lib/utils';
import type { ActionState } from './actions';
import type { Invoice, InvoiceLineItem, Service } from '@/lib/supabase/database.types';

/** A line item being edited. `key` is a stable React identity, not persisted. */
interface EditableLineItem {
  key: string;
  service_id: string;
  name: string;
  description: string;
  quantity: string;
  rate: string;
}

function blankItem(): EditableLineItem {
  return {
    key: crypto.randomUUID(),
    service_id: '',
    name: '',
    description: '',
    quantity: '1',
    rate: '0',
  };
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  );
}

/**
 * Create/edit form for an invoice (brief §06).
 *
 * Totals are previewed live in the browser for feedback, but the authoritative
 * figures come from the `invoices_with_status` view — the database is the single
 * source of truth for money.
 */
export function InvoiceForm({
  action,
  invoice,
  lineItems,
  contacts,
  deals,
  services,
  defaults,
  submitLabel,
  cancelHref,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  invoice?: Invoice;
  lineItems?: InvoiceLineItem[];
  contacts: { id: string; full_name: string; company_name: string | null }[];
  deals: { id: string; title: string; contact_id: string }[];
  services: Pick<Service, 'id' | 'name' | 'default_rate'>[];
  /** Organization defaults applied to a new invoice. */
  defaults: { taxRate: number; paymentTermsDays: number; currency: string };
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});

  const [items, setItems] = useState<EditableLineItem[]>(() =>
    lineItems && lineItems.length > 0
      ? lineItems.map((item) => ({
          key: item.id,
          service_id: item.service_id ?? '',
          name: item.name,
          description: item.description ?? '',
          quantity: String(item.quantity),
          rate: String(item.rate),
        }))
      : [blankItem()],
  );

  const [taxRate, setTaxRate] = useState(String(invoice?.tax_rate ?? defaults.taxRate));

  // Computed once on mount rather than every render: reading the clock during
  // render is impure, and a due date that shifts on re-render would be a bug.
  const [today, defaultDueDate] = useState(() => {
    const now = new Date();
    const due = new Date(now.getTime() + defaults.paymentTermsDays * 86_400_000);
    return [now.toISOString().slice(0, 10), due.toISOString().slice(0, 10)] as const;
  })[0];

  function updateItem(key: string, patch: Partial<EditableLineItem>) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  /** Selecting a service pre-fills the name and default rate (brief §04). */
  function applyService(key: string, serviceId: string) {
    const service = services.find((candidate) => candidate.id === serviceId);
    updateItem(key, {
      service_id: serviceId,
      ...(service
        ? {
            name: service.name,
            rate: service.default_rate != null ? String(service.default_rate) : '0',
          }
        : {}),
    });
  }

  const subtotal = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.rate) || 0),
    0,
  );
  const taxAmount = subtotal * ((Number(taxRate) || 0) / 100);
  const total = subtotal + taxAmount;

  return (
    <form action={formAction} className="flex flex-col gap-4 max-w-4xl">
      <Card>
        <CardHeader title="Invoice details" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Contact"
            name="contact_id"
            defaultValue={invoice?.contact_id ?? ''}
            error={state.fieldErrors?.contact_id}
            placeholder="Select a contact…"
            required
            options={contacts.map((contact) => ({
              value: contact.id,
              label: contact.company_name
                ? `${contact.full_name} — ${contact.company_name}`
                : contact.full_name,
            }))}
          />

          <Select
            label="Linked deal (optional)"
            name="deal_id"
            defaultValue={invoice?.deal_id ?? ''}
            placeholder="No linked deal"
            options={deals.map((deal) => ({ value: deal.id, label: deal.title }))}
          />

          <Input
            label="Issue date"
            name="issue_date"
            type="date"
            defaultValue={invoice?.issue_date ?? today}
            error={state.fieldErrors?.issue_date}
            required
          />

          <Input
            label="Due date"
            name="due_date"
            type="date"
            defaultValue={invoice?.due_date ?? defaultDueDate}
            error={state.fieldErrors?.due_date}
            required
          />

          <Input
            label="Payment terms"
            name="payment_terms"
            defaultValue={invoice?.payment_terms ?? `Net ${defaults.paymentTermsDays}`}
            placeholder="e.g. Net 30"
          />

          <Input
            label="Tax rate (%)"
            name="tax_rate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={taxRate}
            onChange={(event) => setTaxRate(event.target.value)}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Line items"
          description="Pick a service to pre-fill its name and rate."
          action={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setItems((current) => [...current, blankItem()])}
            >
              Add item
            </Button>
          }
        />

        <div className="flex flex-col gap-3">
          {items.map((item, index) => (
            <div
              key={item.key}
              className="grid gap-2 sm:grid-cols-12 items-end pb-3 border-b border-[var(--border-subtle)] last:border-0"
            >
              {/* Parallel arrays keyed by position; the server pairs them up. */}
              <input type="hidden" name="item_service_id" value={item.service_id} />

              <div className="sm:col-span-3">
                <Select
                  label={index === 0 ? 'Service' : undefined}
                  aria-label="Service"
                  value={item.service_id}
                  onChange={(event) => applyService(item.key, event.target.value)}
                  placeholder="Custom item"
                  options={services.map((service) => ({
                    value: service.id,
                    label: service.name,
                  }))}
                />
              </div>

              <div className="sm:col-span-4">
                <Input
                  label={index === 0 ? 'Description' : undefined}
                  aria-label="Item name"
                  name="item_name"
                  value={item.name}
                  onChange={(event) => updateItem(item.key, { name: event.target.value })}
                  placeholder="Item name"
                  required
                />
              </div>

              <div className="sm:col-span-2">
                <Input
                  label={index === 0 ? 'Qty' : undefined}
                  aria-label="Quantity"
                  name="item_quantity"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={item.quantity}
                  onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                />
              </div>

              <div className="sm:col-span-2">
                <Input
                  label={index === 0 ? 'Rate' : undefined}
                  aria-label="Rate"
                  name="item_rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.rate}
                  onChange={(event) => updateItem(item.key, { rate: event.target.value })}
                />
              </div>

              <div className="sm:col-span-1 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove item ${index + 1}`}
                  // Always keep one row, so the form is never empty.
                  disabled={items.length === 1}
                  onClick={() =>
                    setItems((current) => current.filter((row) => row.key !== item.key))
                  }
                >
                  ✕
                </Button>
              </div>

              {/* Optional per-item detail line. */}
              <div className="sm:col-span-12">
                <input type="hidden" name="item_description" value={item.description} />
              </div>
            </div>
          ))}
        </div>

        <dl className="mt-4 ml-auto max-w-xs flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--text-secondary)]">Subtotal</dt>
            <dd className="tabular">{formatCurrency(subtotal, defaults.currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--text-secondary)]">Tax ({taxRate || 0}%)</dt>
            <dd className="tabular">{formatCurrency(taxAmount, defaults.currency)}</dd>
          </div>
          <div className="flex justify-between gap-4 pt-1.5 border-t border-[var(--border-subtle)] font-semibold">
            <dt>Total</dt>
            <dd className="tabular">{formatCurrency(total, defaults.currency)}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader title="Notes" />
        <Textarea
          name="notes"
          defaultValue={invoice?.notes ?? ''}
          placeholder="Payment instructions, bank details, or a thank-you note. Appears on the PDF."
          rows={3}
          aria-label="Invoice notes"
        />
      </Card>

      {state.error && (
        <p
          role="alert"
          className="text-sm text-[var(--danger)] bg-[var(--danger-bg)] rounded-lg px-3 py-2"
        >
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <SubmitButton label={submitLabel} />
        <Link href={cancelHref}>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
