'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatDate, cn } from '@/lib/utils';
import {
  grantPortalAccess,
  setPortalAccessActive,
  resetPortalPassword,
  revokePortalAccess,
  type ActionState,
  type PortalAccessSummary,
} from './portal/actions';

/**
 * Client portal access management (Settings, admin only).
 *
 * Giving someone outside the company a login is consequential, so this section
 * states plainly what a client can and cannot see. Without that, nobody can
 * grant access confidently — or notice if the boundary later changes.
 */

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {label}
    </Button>
  );
}

/** Inline password reset for one client. Own state per row. */
function PasswordReset({ user, onDone }: { user: PortalAccessSummary; onDone: () => void }) {
  const bound = resetPortalPassword.bind(null, user.id);
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await bound(previous, formData);
      if (!result.error) setTimeout(onDone, 2500);
      return result;
    },
    {},
  );

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      <div className="flex items-end gap-2 flex-wrap">
        <Input
          label={`New password for ${user.fullName}`}
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
    </form>
  );
}

export function PortalAccessSection({
  portalUsers,
  contacts,
}: {
  portalUsers: PortalAccessSummary[];
  contacts: { id: string; full_name: string; company_name: string | null; email: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await grantPortalAccess(previous, formData);
      if (!result.error) setOpen(false);
      return result;
    },
    {},
  );

  // Contacts who already have access should not be offered again — the unique
  // constraint would reject it, but an option that always errors is a bad form.
  const withAccess = new Set(portalUsers.map((u) => u.contactId));
  const available = contacts.filter((c) => !withAccess.has(c.id));

  return (
    <Card>
      <CardHeader
        title="Client portal access"
        description="Let clients sign in to see their own invoices and projects."
        action={
          <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
            {open ? 'Cancel' : 'Grant access'}
          </Button>
        }
      />

      {open && (
        <form
          action={formAction}
          className="flex flex-col gap-3 mb-4 pb-4 border-b border-[var(--border-subtle)]"
        >
          <Select
            label="Client"
            name="contact_id"
            placeholder="Select a contact…"
            required
            options={available.map((c) => ({
              value: c.id,
              label: c.company_name ? `${c.full_name} — ${c.company_name}` : c.full_name,
            }))}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Their name" name="full_name" placeholder="Jane Doe" required />
            <Input
              label="Their email"
              name="email"
              type="email"
              placeholder="jane@client.com"
              required
              hint="This is the address they sign in with."
            />
          </div>

          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            hint="At least 8 characters, with upper and lower case and a number. Send it to them securely."
          />

          <div className="flex items-center gap-3 flex-wrap">
            <SubmitButton label="Grant access" />
            <span className="text-xs text-[var(--text-muted)]">
              They sign in at <code className="text-[var(--text-secondary)]">/portal</code>
            </span>
          </div>

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
        </form>
      )}

      {portalUsers.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No clients have portal access yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
          {portalUsers.map((user) => (
            <li key={user.id} className="py-2.5 first:pt-0">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      !user.isActive && 'text-[var(--text-muted)]',
                    )}
                  >
                    {user.contactName ?? user.fullName}
                    {user.companyName && (
                      <span className="text-[var(--text-muted)] font-normal">
                        {' '}
                        · {user.companyName}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {user.email}
                    {user.lastSeenAt
                      ? ` · last seen ${formatDate(user.lastSeenAt)}`
                      : ' · never signed in'}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!user.isActive && <Badge tone="neutral">Suspended</Badge>}

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setResettingId(resettingId === user.id ? null : user.id)}
                  >
                    {resettingId === user.id ? 'Close' : 'Password'}
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        await setPortalAccessActive(user.id, !user.isActive);
                      })
                    }
                  >
                    {user.isActive ? 'Suspend' : 'Restore'}
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Remove portal access for ${user.fullName}? Their login will be deleted.`,
                        )
                      )
                        return;
                      startTransition(async () => {
                        await revokePortalAccess(user.id);
                      });
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>

              {resettingId === user.id && (
                <PasswordReset user={user} onDone={() => setResettingId(null)} />
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] text-xs text-[var(--text-muted)] flex flex-col gap-1">
        <p>
          <strong className="text-[var(--text-secondary)]">Clients can see:</strong> their own
          sent invoices, their projects, and documents attached to their record.
        </p>
        <p>
          <strong className="text-[var(--text-secondary)]">They cannot see:</strong> internal
          notes, lead scores, draft invoices, other clients, or anything about your team.
          Enforced in the database, not just hidden in the interface.
        </p>
      </div>
    </Card>
  );
}
