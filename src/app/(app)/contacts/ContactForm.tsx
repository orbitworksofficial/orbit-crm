'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Input, Select } from '@/components/ui/Field';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import type { ActionState } from './actions';
import type { Contact, UserRole } from '@/lib/supabase/database.types';

interface Option {
  id: string;
  name: string;
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
 * Create/edit form for a contact.
 *
 * The same component serves both modes; `contact` being present switches it to
 * edit and pre-fills every field.
 */
export function ContactForm({
  action,
  contact,
  sources,
  statuses,
  services,
  members,
  selectedServiceIds = [],
  currentUserRole,
  submitLabel,
  cancelHref,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  contact?: Contact;
  sources: Option[];
  statuses: Option[];
  services: Option[];
  members: { id: string; full_name: string }[];
  selectedServiceIds?: string[];
  currentUserRole: UserRole;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-4 max-w-3xl">
      <Card>
        <CardHeader title="Contact details" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Full name"
            name="full_name"
            defaultValue={contact?.full_name ?? ''}
            error={state.fieldErrors?.full_name}
            required
            autoFocus={!contact}
            className="sm:col-span-2"
          />
          <Input
            label="Email"
            name="email"
            type="email"
            defaultValue={contact?.email ?? ''}
            error={state.fieldErrors?.email}
            placeholder="name@company.com"
          />
          <Input
            label="WhatsApp number"
            name="whatsapp_number"
            type="tel"
            defaultValue={contact?.whatsapp_number ?? ''}
            placeholder="+971 50 123 4567"
          />
          <Input
            label="Company"
            name="company_name"
            defaultValue={contact?.company_name ?? ''}
          />
          <Input label="Industry" name="industry" defaultValue={contact?.industry ?? ''} />
          <Input label="City" name="city" defaultValue={contact?.city ?? ''} />
          <Input label="Country" name="country" defaultValue={contact?.country ?? ''} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Classification" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Lead status"
            name="lead_status_id"
            defaultValue={contact?.lead_status_id ?? ''}
            placeholder="Select status…"
            options={statuses.map((status) => ({ value: status.id, label: status.name }))}
          />
          <Select
            label="Lead source"
            name="lead_source_id"
            defaultValue={contact?.lead_source_id ?? ''}
            placeholder="Select source…"
            options={sources.map((source) => ({ value: source.id, label: source.name }))}
          />

          <div className="sm:col-span-2">
            <MultiSelect
              name="service_ids"
              label="Service interest"
              options={services.map((service) => ({ value: service.id, label: service.name }))}
              defaultSelected={selectedServiceIds}
              placeholder="Select services…"
              hint="What this lead is interested in. Drives the leads-by-service report."
            />
          </div>

          {/* Only admins may assign work to other people; a sales user's
              contacts are always their own, enforced by RLS. */}
          {currentUserRole === 'admin' && (
            <Select
              label="Assigned to"
              name="assigned_to"
              defaultValue={contact?.assigned_to ?? ''}
              placeholder="Unassigned"
              options={members.map((member) => ({ value: member.id, label: member.full_name }))}
              className="sm:col-span-2"
            />
          )}
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
