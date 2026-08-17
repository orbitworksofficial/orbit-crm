'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Input, Select } from '@/components/ui/Field';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import type { ActionState } from './actions';
import type { Deal, UserRole } from '@/lib/supabase/database.types';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  );
}

/**
 * Create/edit form for a deal. Serves both modes; `deal` switches to edit.
 */
export function DealForm({
  action,
  deal,
  contacts,
  services,
  members,
  selectedServiceIds = [],
  defaultContactId,
  currentUserRole,
  submitLabel,
  cancelHref,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  deal?: Deal;
  contacts: { id: string; full_name: string; company_name: string | null }[];
  services: { id: string; name: string }[];
  members: { id: string; full_name: string }[];
  selectedServiceIds?: string[];
  /** Pre-selects the contact when arriving from a contact's detail page. */
  defaultContactId?: string;
  currentUserRole: UserRole;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-4 max-w-3xl">
      <Card>
        <CardHeader title="Deal details" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Deal title"
            name="title"
            defaultValue={deal?.title ?? ''}
            error={state.fieldErrors?.title}
            placeholder="e.g. Website redesign — Q3"
            required
            autoFocus={!deal}
            className="sm:col-span-2"
          />

          <Select
            label="Contact"
            name="contact_id"
            defaultValue={deal?.contact_id ?? defaultContactId ?? ''}
            error={state.fieldErrors?.contact_id}
            placeholder="Select a contact…"
            required
            options={contacts.map((contact) => ({
              value: contact.id,
              label: contact.company_name
                ? `${contact.full_name} — ${contact.company_name}`
                : contact.full_name,
            }))}
            className="sm:col-span-2"
          />

          <Input
            label="Deal value (USD)"
            name="value"
            type="number"
            min="0"
            step="0.01"
            defaultValue={deal?.value ?? ''}
            error={state.fieldErrors?.value}
            placeholder="0.00"
          />

          <Select
            label="Status"
            name="status"
            defaultValue={deal?.status ?? 'open'}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'won', label: 'Won' },
              { value: 'lost', label: 'Lost' },
            ]}
          />

          <Input
            label="Expected close date"
            name="expected_close_date"
            type="date"
            defaultValue={deal?.expected_close_date ?? ''}
          />

          {currentUserRole === 'admin' && (
            <Select
              label="Assigned to"
              name="assigned_to"
              defaultValue={deal?.assigned_to ?? ''}
              placeholder="Unassigned"
              options={members.map((member) => ({ value: member.id, label: member.full_name }))}
            />
          )}

          <div className="sm:col-span-2">
            <MultiSelect
              name="service_ids"
              label="Services in scope"
              options={services.map((service) => ({ value: service.id, label: service.name }))}
              defaultSelected={selectedServiceIds}
              placeholder="Select services…"
              hint="Drives the service revenue report."
            />
          </div>
        </div>
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
