'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { portalSignIn, type PortalAuthState } from '../actions';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} fullWidth size="lg">
      Sign in
    </Button>
  );
}

export function PortalLoginForm() {
  const [state, formAction] = useActionState<PortalAuthState, FormData>(portalSignIn, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        required
        autoFocus
      />

      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        required
      />

      {state.error && (
        <p
          role="alert"
          className="text-xs text-[var(--danger)] bg-[var(--danger-bg)] rounded-lg px-3 py-2"
        >
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
