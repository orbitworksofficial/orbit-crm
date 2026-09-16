'use client';

import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Input, Select } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { createTask, type ActionState } from './actions';
import type { UserRole } from '@/lib/supabase/database.types';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      Add task
    </Button>
  );
}

/**
 * Creates a task.
 *
 * Collapsed to a single "New task" button until opened: the Tasks page exists
 * to be read first and written to second, and a permanently-open form pushes
 * the actual list below the fold.
 */
export function TaskComposer({
  members,
  contacts,
  currentUserRole,
}: {
  members: { id: string; full_name: string }[];
  contacts: { id: string; full_name: string; company_name: string | null }[];
  currentUserRole: UserRole;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previousState, formData) => {
      const result = await createTask(previousState, formData);
      // Clearing inside the action keeps the reset an event-driven consequence
      // of submitting, rather than a render-triggered cascade.
      if (!result.error) formRef.current?.reset();
      return result;
    },
    {},
  );

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm">
        New task
      </Button>
    );
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title="New task"
        action={
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      />
      <form ref={formRef} action={formAction} className="flex flex-col gap-3">
        <Input
          label="What needs doing?"
          name="title"
          placeholder="e.g. Send the revised proposal"
          required
          autoFocus
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Due date" name="due_date" type="date" />
          <Select
            label="Priority"
            name="priority"
            defaultValue="normal"
            options={[
              { value: 'low', label: 'Low' },
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
            ]}
          />
          {/* Only admins may delegate; a sales user's tasks are their own,
              enforced by RLS. */}
          {currentUserRole === 'admin' ? (
            <Select
              label="Assign to"
              name="assigned_to"
              placeholder="Me"
              options={members.map((m) => ({ value: m.id, label: m.full_name }))}
            />
          ) : (
            <div />
          )}
        </div>

        <Select
          label="Related contact (optional)"
          name="contact_id"
          placeholder="Not linked"
          options={contacts.map((c) => ({
            value: c.id,
            label: c.company_name ? `${c.full_name} — ${c.company_name}` : c.full_name,
          }))}
        />

        <div className="flex items-center gap-3">
          <SubmitButton />
          {state.error && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {state.error}
            </p>
          )}
          {state.success && (
            <p role="status" className="text-xs text-[var(--success)]">
              {state.success}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}
