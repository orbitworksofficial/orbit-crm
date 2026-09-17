'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { formatCurrency } from '@/lib/utils';
import type { ActionState } from './actions';
import type { Subscription, Service } from '@/lib/supabase/database.types';

/** A covered service being edited. `key` is React identity only. */
interface CoveredService {
  key: string;
  service_id: string;
  quantity: string;
  rate: string;
}

function blankService(): CoveredService {
  return { key: crypto.randomUUID(), service_id: '', quantity: '1', rate: '0' };
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
 * Create/edit form for a retainer.
 *
 * Covered services are optional but worth filling in: when the billing date
 * arrives, the Invoice button pre-fills a draft from them, so the same line
 * items are not retyped every cycle.
 */
export function SubscriptionForm({
  action,
  subscription,
  coveredServices,
  contacts,
  services,
  defaults,
  submitLabel,
  cancelHref,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  subscription?: Subscription;
  coveredServices?: { service_id: string; quantity: number; rate: number }[];
  contacts: { id: string; full_name: string; company_name: string | null }[];
  services: Pick<Service, 'id' | 'name' | 'default_rate'>[];
  defaults: { currency: string };
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});

  const [covered, setCovered] = useState<CoveredService[]>(() =>
    coveredServices && coveredServices.length > 0
      ? coveredServices.map((s) => ({
          key: s.service_id,
          service_id: s.service_id,
          quantity: String(s.quantity),
          rate: String(s.rate),
        }))
      : [blankService()],
  );

  // Computed once on mount: reading the clock during render is impure, and a
  // default date that shifts on re-render would be a bug.
  const [today, nextMonth] = useState(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    return [now.toISOString().slice(0, 10), next.toISOString().slice(0, 10)] as const;
  })[0];

  function updateService(key: string, patch: Partial<CoveredService>) {
    setCovered((c) => c.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  /** Picking a service pre-fills its catalogue rate. */
  function applyService(key: string, serviceId: string) {
    const service = services.find((s) => s.id === serviceId);
    updateService(key, {
      service_id: serviceId,
      ...(service && service.default_rate != null ? { rate: String(service.default_rate) } : {}),
    });
  }

  const servicesTotal = covered.reduce(
    (sum, s) => sum + (Number(s.quantity) || 0) * (Number(s.rate) || 0),
    0,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4 max-w-3xl">
      <Card>
        <CardHeader title="Retainer details" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Name"
            name="name"
            defaultValue={subscription?.name ?? ''}
            placeholder="e.g. Monthly SEO retainer"
            required
            autoFocus={!subscription}
            className="sm:col-span-2"
          />

          <Select
            label="Client"
            name="contact_id"
            defaultValue={subscription?.contact_id ?? ''}
            placeholder="Select a contact…"
            required
            options={contacts.map((c) => ({
              value: c.id,
              label: c.company_name ? `${c.full_name} — ${c.company_name}` : c.full_name,
            }))}
            className="sm:col-span-2"
          />

          <Input
            label="Amount per cycle"
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            defaultValue={subscription?.amount ?? ''}
            required
          />

          <Select
            label="Billing cycle"
            name="cycle"
            defaultValue={subscription?.cycle ?? 'monthly'}
            options={[
              { value: 'monthly', label: 'Monthly' },
              { value: 'quarterly', label: 'Quarterly' },
              { value: 'annual', label: 'Annual' },
            ]}
          />

          <Input
            label="Started on"
            name="started_on"
            type="date"
            defaultValue={subscription?.started_on ?? today}
            required
          />

          <Input
            label="Next billing date"
            name="next_billing_date"
            type="date"
            defaultValue={subscription?.next_billing_date ?? nextMonth}
            required
            hint="Advances automatically once you invoice a cycle."
          />

          <Input
            label="Ends on (optional)"
            name="ends_on"
            type="date"
            defaultValue={subscription?.ends_on ?? ''}
            hint="Leave blank to run until cancelled."
          />

          <Input
            label="Remind me this many days early"
            name="reminder_days"
            type="number"
            min="0"
            max="90"
            defaultValue={subscription?.reminder_days ?? 7}
          />
        </div>

        <div className="mt-4">
          <Textarea
            label="Notes (optional)"
            name="description"
            defaultValue={subscription?.description ?? ''}
            placeholder="What the retainer covers, and anything to remember when invoicing."
            rows={2}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Covered services"
          description="Optional. Used to pre-fill the invoice each cycle instead of retyping it."
          action={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setCovered((c) => [...c, blankService()])}
            >
              Add service
            </Button>
          }
        />

        <div className="flex flex-col gap-3">
          {covered.map((item, index) => (
            <div key={item.key} className="grid gap-2 sm:grid-cols-12 items-end">
              <input type="hidden" name="service_id" value={item.service_id} />

              <div className="sm:col-span-6">
                <Select
                  label={index === 0 ? 'Service' : undefined}
                  aria-label="Service"
                  value={item.service_id}
                  onChange={(e) => applyService(item.key, e.target.value)}
                  placeholder="Select a service…"
                  options={services.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>

              <div className="sm:col-span-2">
                <Input
                  label={index === 0 ? 'Qty' : undefined}
                  aria-label="Quantity"
                  name="service_quantity"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={item.quantity}
                  onChange={(e) => updateService(item.key, { quantity: e.target.value })}
                />
              </div>

              <div className="sm:col-span-3">
                <Input
                  label={index === 0 ? 'Rate' : undefined}
                  aria-label="Rate"
                  name="service_rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.rate}
                  onChange={(e) => updateService(item.key, { rate: e.target.value })}
                />
              </div>

              <div className="sm:col-span-1 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove service ${index + 1}`}
                  disabled={covered.length === 1}
                  onClick={() => setCovered((c) => c.filter((s) => s.key !== item.key))}
                >
                  ✕
                </Button>
              </div>
            </div>
          ))}
        </div>

        {servicesTotal > 0 && (
          <p className="text-xs text-[var(--text-muted)] mt-3 text-right">
            Services total {formatCurrency(servicesTotal, defaults.currency)} — this is what an
            invoice would bill. Set the retainer amount above to match unless they differ
            deliberately.
          </p>
        )}
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
