'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { changeOwnPassword, type ActionState } from '../settings/actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      Update password
    </Button>
  );
}

/**
 * Self-service password change, for every role.
 *
 * The current password is required: without it, anyone reaching an unattended
 * logged-in session could lock the real owner out of their account.
 */
export function PasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);

  // Clearing inside the action rather than an effect keeps the reset an
  // event-driven consequence of submitting, not a render-triggered cascade.
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previousState, formData) => {
      const result = await changeOwnPassword(previousState, formData);
      if (!result.error) formRef.current?.reset();
      return result;
    },
    {},
  );

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <Input
        label="Current password"
        name="current_password"
        type="password"
        autoComplete="current-password"
        required
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 8 characters, with upper and lower case and a number."
        />
        <Input
          label="Confirm new password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          required
        />
      </div>

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
  );
}
