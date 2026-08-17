'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { signIn, type AuthActionState } from '../actions';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

function SubmitButton() {
  // Must be a child of <form> for useFormStatus to observe the submission.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} fullWidth size="lg">
      Sign in
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<AuthActionState, FormData>(signIn, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}

      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@orbitworks.com"
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
        <p role="alert" className="text-xs text-[var(--danger)] bg-[var(--danger-bg)] rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
