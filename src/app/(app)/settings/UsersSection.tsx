'use client';

import { useActionState, useTransition, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { getInitials, cn } from '@/lib/utils';
import {
  createUser,
  inviteUser,
  setUserPassword,
  setUserRole,
  setUserActive,
  type ActionState,
} from './actions';
import type { Profile } from '@/lib/supabase/database.types';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {label}
    </Button>
  );
}

function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-xs text-[var(--danger)]">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p role="status" className="text-xs text-[var(--success)]">
        {state.success}
      </p>
    );
  }
  return null;
}

/**
 * Inline password reset for one user.
 *
 * Kept as its own component so each row owns its action state — a single shared
 * state would surface the result under whichever row was expanded last.
 */
function PasswordReset({ user, onDone }: { user: Profile; onDone: () => void }) {
  const boundAction = setUserPassword.bind(null, user.id);

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previousState, formData) => {
      const result = await boundAction(previousState, formData);
      // Leave the panel open briefly so the confirmation is readable before it
      // disappears.
      if (!result.error) setTimeout(onDone, 2500);
      return result;
    },
    {},
  );

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2 w-full">
      <div className="flex items-end gap-2 flex-wrap">
        <Input
          label={`New password for ${user.full_name}`}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className="flex-1 min-w-[220px]"
          hint="At least 8 characters, with upper and lower case and a number."
        />
        <SubmitButton label="Set password" />
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

/**
 * User management (brief §09).
 *
 * Two ways to add someone: create the account directly with a password, or send
 * an invitation and let them choose their own. Direct creation suits setting
 * someone up in person; invitations suit remote onboarding.
 *
 * Users are deactivated rather than deleted, so their authorship of historical
 * notes and activity survives.
 */
export function UsersSection({
  users,
  currentUserId,
}: {
  users: Profile[];
  currentUserId: string;
}) {
  const [createState, createAction] = useActionState<ActionState, FormData>(createUser, {});
  const [inviteState, inviteAction] = useActionState<ActionState, FormData>(inviteUser, {});
  const [isPending, startTransition] = useTransition();
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [mode, setMode] = useState<'create' | 'invite'>('create');

  return (
    <Card>
      <CardHeader
        title="Team"
        description="Admins see everything. Sales users see only their own contacts and deals."
      />

      <ul className="flex flex-col divide-y divide-[var(--border-subtle)] mb-4">
        {users.map((user) => {
          const isSelf = user.id === currentUserId;
          return (
            <li key={user.id} className="py-2.5 first:pt-0">
              <div className="flex items-center gap-3 flex-wrap">
                <span
                  className="size-8 rounded-full bg-[var(--surface-sunken)] border border-[var(--border-subtle)] flex items-center justify-center text-xs font-semibold text-[var(--text-secondary)] shrink-0"
                  aria-hidden="true"
                >
                  {getInitials(user.full_name)}
                </span>

                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      !user.is_active && 'text-[var(--text-muted)]',
                    )}
                  >
                    {user.full_name}
                    {isSelf && (
                      <span className="text-[var(--text-muted)] font-normal"> (you)</span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] truncate">{user.email}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!user.is_active && <Badge tone="neutral">Deactivated</Badge>}

                  <select
                    value={user.role}
                    // An admin must not demote themselves; the database refuses
                    // it too, this just avoids offering the action.
                    disabled={isSelf || isPending}
                    onChange={(event) =>
                      startTransition(async () => {
                        await setUserRole(user.id, event.target.value as 'admin' | 'sales');
                      })
                    }
                    aria-label={`Role for ${user.full_name}`}
                    className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 min-h-8 text-xs disabled:opacity-50"
                  >
                    <option value="admin">Admin</option>
                    <option value="sales">Sales</option>
                  </select>

                  {/* Your own password is changed on the Account page, which
                      asks for the current one first. */}
                  {!isSelf && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() =>
                        setResettingId(resettingId === user.id ? null : user.id)
                      }
                    >
                      {resettingId === user.id ? 'Close' : 'Password'}
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isSelf || isPending}
                    onClick={() =>
                      startTransition(async () => {
                        await setUserActive(user.id, !user.is_active);
                      })
                    }
                  >
                    {user.is_active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              </div>

              {resettingId === user.id && (
                <PasswordReset user={user} onDone={() => setResettingId(null)} />
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-[var(--border-subtle)] pt-4">
        <div
          className="flex items-center gap-1 mb-3"
          role="group"
          aria-label="How to add a user"
        >
          {(['create', 'invite'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              aria-pressed={mode === option}
              className={cn(
                'px-2.5 min-h-8 rounded-lg text-xs font-medium transition-colors',
                mode === option
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]',
              )}
            >
              {option === 'create' ? 'Create directly' : 'Send invitation'}
            </button>
          ))}
        </div>

        {mode === 'create' ? (
          <form action={createAction} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Full name" name="full_name" placeholder="Jane Doe" required />
              <Input
                label="Email"
                name="email"
                type="email"
                placeholder="jane@orbitworks.com"
                required
              />
              <Input
                label="Password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                hint="At least 8 characters, with upper and lower case and a number."
              />
              <Select
                label="Role"
                name="role"
                defaultValue="sales"
                options={[
                  { value: 'sales', label: 'Sales' },
                  { value: 'admin', label: 'Admin' },
                ]}
              />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <SubmitButton label="Create user" />
              <span className="text-xs text-[var(--text-muted)]">
                They can sign in immediately — no confirmation email is sent.
              </span>
            </div>
            <Feedback state={createState} />
          </form>
        ) : (
          <form action={inviteAction} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Full name" name="full_name" placeholder="Jane Doe" required />
              <Input
                label="Email"
                name="email"
                type="email"
                placeholder="jane@orbitworks.com"
                required
              />
              <Select
                label="Role"
                name="role"
                defaultValue="sales"
                options={[
                  { value: 'sales', label: 'Sales' },
                  { value: 'admin', label: 'Admin' },
                ]}
              />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <SubmitButton label="Send invite" />
              <span className="text-xs text-[var(--text-muted)]">
                They choose their own password from the emailed link.
              </span>
            </div>
            <Feedback state={inviteState} />
          </form>
        )}
      </div>
    </Card>
  );
}
