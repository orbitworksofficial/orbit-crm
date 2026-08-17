'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { requestPasswordReset, type AuthActionState } from '../actions';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} fullWidth size="lg">
      Send reset link
    </Button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<AuthActionState, FormData>(requestPasswordReset, {});

  // On success the form is replaced entirely, so the user isn't invited to
  // submit repeatedly while waiting for the email.
  if (state.success) {
    return (
      <p
        role="status"
        className="text-sm text-[var(--success)] bg-[var(--success-bg)] rounded-lg px-3 py-3"
      >
        {state.success}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@orbitworks.com"
        required
        autoFocus
      />

      {state.error && (
        <p role="alert" className="text-xs text-[var(--danger)] bg-[var(--danger-bg)] rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
