'use client';

import { useActionState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { getInitials, cn } from '@/lib/utils';
import { inviteUser, setUserRole, setUserActive, type ActionState } from './actions';
import type { Profile } from '@/lib/supabase/database.types';

function InviteButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      Send invite
    </Button>
  );
}

/**
 * User management (brief §09): invite by email, assign roles, deactivate.
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
  const [state, formAction] = useActionState<ActionState, FormData>(inviteUser, {});
  const [isPending, startTransition] = useTransition();

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
            <li key={user.id} className="py-2.5 first:pt-0 flex items-center gap-3 flex-wrap">
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
                  {isSelf && <span className="text-[var(--text-muted)] font-normal"> (you)</span>}
                </p>
                <p className="text-xs text-[var(--text-muted)] truncate">{user.email}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!user.is_active && <Badge tone="neutral">Deactivated</Badge>}

                <select
                  value={user.role}
                  // An admin must not be able to demote themselves; the database
                  // refuses it too, this just avoids offering the action.
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
            </li>
          );
        })}
      </ul>

      <form
        action={formAction}
        className="grid gap-3 sm:grid-cols-4 items-end border-t border-[var(--border-subtle)] pt-4"
      >
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
        <InviteButton />
      </form>

      {state.error && (
        <p role="alert" className="text-xs text-[var(--danger)] mt-2">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-xs text-[var(--success)] mt-2">
          {state.success}
        </p>
      )}
    </Card>
  );
}
