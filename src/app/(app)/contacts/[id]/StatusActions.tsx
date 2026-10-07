'use client';

import { useTransition } from 'react';
import { setContactStatus } from '../actions';

/**
 * Inline lead-status change on the contact detail page.
 *
 * A select rather than buttons: there are seven statuses and the list is
 * user-editable in Settings, so a button row would overflow and would need
 * changing every time someone adds one.
 */
export function StatusActions({
  contactId,
  currentStatusId,
  statuses,
}: {
  contactId: string;
  currentStatusId: string | null;
  statuses: { id: string; name: string }[];
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      value={currentStatusId ?? ''}
      disabled={isPending}
      aria-label="Lead status"
      onChange={(event) => {
        const statusId = event.target.value;
        if (!statusId || statusId === currentStatusId) return;
        startTransition(async () => {
          await setContactStatus(contactId, statusId);
        });
      }}
      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1 text-xs text-[var(--text-primary)] disabled:opacity-60"
    >
      {currentStatusId === null && <option value="">Set status…</option>}
      {statuses.map((status) => (
        <option key={status.id} value={status.id}>
          {status.name}
        </option>
      ))}
    </select>
  );
}
