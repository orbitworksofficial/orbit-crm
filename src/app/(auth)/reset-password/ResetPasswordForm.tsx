'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { resetPassword, type AuthActionState } from '../actions';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} fullWidth size="lg">
      Update password
    </Button>
  );
}

export function ResetPasswordForm() {
  const [state, formAction] = useActionState<AuthActionState, FormData>(resetPassword, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        minLength={8}
        required
        autoFocus
      />

      <Input
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        minLength={8}
        required
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
