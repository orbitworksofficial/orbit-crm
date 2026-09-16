'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { formatCurrency } from '@/lib/utils';
import type { ActionState } from './actions';
import type { Proposal, ProposalLineItem, Service } from '@/lib/supabase/database.types';

/** A line being edited. `key` is React identity only, never persisted. */
interface EditableItem {
  key: string;
  service_id: string;
  name: string;
  description: string;
  quantity: string;
  rate: string;
}

function blankItem(): EditableItem {
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
 * Create/edit form for a proposal.
 *
 * Totals preview live in the browser for feedback, but the authoritative
 * figures come from `proposals_with_status` — the database is the single source
 * of truth for money, here as with invoices.
 *
 * Discount applies before tax, which is the conventional order and matches the
 * view's calculation.
 */
export function ProposalForm({
  action,
  proposal,
  lineItems,
  contacts,
  services,
  defaults,
  submitLabel,
  cancelHref,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  proposal?: Proposal;
  lineItems?: ProposalLineItem[];
  contacts: { id: string; full_name: string; company_name: string | null }[];
  services: Pick<Service, 'id' | 'name' | 'default_rate'>[];
  defaults: { taxRate: number; currency: string; validDays: number };
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});

  const [items, setItems] = useState<EditableItem[]>(() =>
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

  const [taxRate, setTaxRate] = useState(String(proposal?.tax_rate ?? defaults.taxRate));
  const [discountRate, setDiscountRate] = useState(String(proposal?.discount_rate ?? 0));

  // Computed once on mount: reading the clock during render is impure, and a
  // validity date that shifts on re-render would be a bug.
  const [today, defaultValidUntil] = useState(() => {
    const now = new Date();
    const until = new Date(now.getTime() + defaults.validDays * 86_400_000);
    return [now.toISOString().slice(0, 10), until.toISOString().slice(0, 10)] as const;
  })[0];

  function updateItem(key: string, patch: Partial<EditableItem>) {
    setItems((current) => current.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  /** Selecting a service pre-fills its name and catalogue rate. */
  function applyService(key: string, serviceId: string) {
    const service = services.find((s) => s.id === serviceId);
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
    (sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.rate) || 0),
    0,
  );
  const discountAmount = subtotal * ((Number(discountRate) || 0) / 100);
  const afterDiscount = subtotal - discountAmount;
  const taxAmount = afterDiscount * ((Number(taxRate) || 0) / 100);
  const total = afterDiscount + taxAmount;

  return (
    <form action={formAction} className="flex flex-col gap-4 max-w-4xl">
      <Card>
        <CardHeader title="Proposal details" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Title"
            name="title"
            defaultValue={proposal?.title ?? ''}
            placeholder="e.g. Website rebuild and SEO retainer"
            required
            autoFocus={!proposal}
            className="sm:col-span-2"
          />

          <Select
            label="Contact"
            name="contact_id"
            defaultValue={proposal?.contact_id ?? ''}
            placeholder="Select a contact…"
            required
            options={contacts.map((c) => ({
              value: c.id,
              label: c.company_name ? `${c.full_name} — ${c.company_name}` : c.full_name,
            }))}
            className="sm:col-span-2"
          />

          <Input
            label="Issue date"
            name="issue_date"
            type="date"
            defaultValue={proposal?.issue_date ?? today}
            required
          />
          <Input
            label="Valid until"
            name="valid_until"
            type="date"
            defaultValue={proposal?.valid_until ?? defaultValidUntil}
            required
            hint="The quote shows this date prominently."
          />
        </div>

        <div className="mt-4">
          <Textarea
            label="Overview"
            name="summary"
            defaultValue={proposal?.summary ?? ''}
            placeholder="What you are proposing and why. Appears above the pricing."
            rows={4}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Services quoted"
          description="Pick from the catalogue to pre-fill the name and rate."
          action={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setItems((c) => [...c, blankItem()])}
            >
              Add service
            </Button>
          }
        />

        <div className="flex flex-col gap-3">
          {items.map((item, index) => (
            <div
              key={item.key}
              className="grid gap-2 sm:grid-cols-12 items-end pb-3 border-b border-[var(--border-subtle)] last:border-0"
            >
              <input type="hidden" name="item_service_id" value={item.service_id} />
              <input type="hidden" name="item_description" value={item.description} />

              <div className="sm:col-span-3">
                <Select
                  label={index === 0 ? 'Service' : undefined}
                  aria-label="Service"
                  value={item.service_id}
                  onChange={(e) => applyService(item.key, e.target.value)}
                  placeholder="Custom item"
                  options={services.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>

              <div className="sm:col-span-4">
                <Input
                  label={index === 0 ? 'Description' : undefined}
                  aria-label="Item name"
                  name="item_name"
                  value={item.name}
                  onChange={(e) => updateItem(item.key, { name: e.target.value })}
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
                  onChange={(e) => updateItem(item.key, { quantity: e.target.value })}
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
                  onChange={(e) => updateItem(item.key, { rate: e.target.value })}
                />
              </div>

              <div className="sm:col-span-1 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove item ${index + 1}`}
                  disabled={items.length === 1}
                  onClick={() => setItems((c) => c.filter((r) => r.key !== item.key))}
                >
                  ✕
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 mt-4 max-w-md ml-auto">
          <Input
            label="Discount (%)"
            name="discount_rate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={discountRate}
            onChange={(e) => setDiscountRate(e.target.value)}
          />
          <Input
            label="Tax (%)"
            name="tax_rate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
          />
        </div>

        <dl className="mt-4 ml-auto max-w-xs flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--text-secondary)]">Subtotal</dt>
            <dd className="tabular">{formatCurrency(subtotal, defaults.currency)}</dd>
          </div>
          {Number(discountRate) > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--text-secondary)]">Discount ({discountRate}%)</dt>
              <dd className="tabular text-[var(--primary)]">
                −{formatCurrency(discountAmount, defaults.currency)}
              </dd>
            </div>
          )}
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
        <CardHeader title="Terms" />
        <Textarea
          name="terms"
          defaultValue={proposal?.terms ?? ''}
          placeholder="Payment terms, timelines, what is excluded. Appears at the foot of the PDF."
          rows={3}
          aria-label="Terms"
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
