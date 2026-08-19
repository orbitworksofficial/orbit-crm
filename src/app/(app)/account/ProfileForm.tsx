'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { updateOwnProfile, type ActionState } from '../settings/actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      Save details
    </Button>
  );
}

/** Lets any user update their own display name. */
export function ProfileForm({ fullName }: { fullName: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateOwnProfile, {});

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Input
        label="Full name"
        name="full_name"
        defaultValue={fullName}
        required
        hint="Shown on the notes and activity you record."
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
  );
}
