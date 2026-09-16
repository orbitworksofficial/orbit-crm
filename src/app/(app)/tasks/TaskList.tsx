'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { toggleTaskComplete, dismissNoteReminder } from './actions';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import { formatDate, cn } from '@/lib/utils';
import type { PendingReminder } from '@/lib/supabase/database.types';

/**
 * A due-date grouped list of tasks and note reminders.
 *
 * Both kinds render as one list because they are the same idea to the reader:
 * something that needs doing on a date. They differ only in how they are
 * cleared — a task completes, a note reminder is dismissed.
 *
 * Grouping by urgency rather than showing a flat date-sorted list: "overdue"
 * and "today" are the two groups anyone actually acts on, and burying them in a
 * chronological list makes them easy to miss.
 */

export interface ReminderRow extends PendingReminder {
  contact_name: string | null;
  assignee_name: string | null;
}

/** Bucket a due date into the group it belongs to. */
function bucketOf(dueDate: string | null): 'overdue' | 'today' | 'soon' | 'later' | 'undated' {
  if (!dueDate) return 'undated';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);

  const diffDays = Math.round((due.getTime() - today.getTime()) / 864e5);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays <= 7) return 'soon';
  return 'later';
}

const GROUPS: { key: ReturnType<typeof bucketOf>; label: string; tone: 'danger' | 'warning' | 'info' | 'neutral' }[] = [
  { key: 'overdue', label: 'Overdue', tone: 'danger' },
  { key: 'today', label: 'Due today', tone: 'warning' },
  { key: 'soon', label: 'Next 7 days', tone: 'info' },
  { key: 'later', label: 'Later', tone: 'neutral' },
  { key: 'undated', label: 'No due date', tone: 'neutral' },
];

function ReminderItem({ row }: { row: ReminderRow }) {
  const [isPending, startTransition] = useTransition();
  const bucket = bucketOf(row.due_date);

  function clear() {
    startTransition(async () => {
      if (row.kind === 'task') await toggleTaskComplete(row.id, true);
      else await dismissNoteReminder(row.id);
    });
  }

  const linkHref = row.deal_id
    ? `/deals/${row.deal_id}`
    : row.contact_id
      ? `/contacts/${row.contact_id}`
      : null;

  return (
    <li className="flex items-start gap-3 py-3 border-b border-[var(--border-subtle)] last:border-0">
      {/* A checkbox, because "tick it off" is the expected gesture — even for a
          note reminder, where the effect is to clear the date. */}
      <button
        type="button"
        onClick={clear}
        disabled={isPending}
        aria-label={`Mark "${row.title}" done`}
        className={cn(
          'mt-0.5 size-4 shrink-0 rounded border-2 transition-colors',
          'border-[var(--border-strong)] hover:border-[var(--primary)]',
          'disabled:opacity-50',
        )}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {row.title}
          </span>
          {row.priority === 'high' && <Badge tone="danger">High</Badge>}
          {row.kind === 'note' && <Badge tone="neutral">From a note</Badge>}
        </div>

        {row.detail && (
          <p className="text-xs text-[var(--text-secondary)] mt-0.5 line-clamp-2">
            {row.detail}
          </p>
        )}

        <div className="flex items-center gap-2 mt-1 text-xs text-[var(--text-muted)] flex-wrap">
          {row.due_date && (
            <span className={cn(bucket === 'overdue' && 'text-[var(--danger)] font-medium')}>
              {formatDate(row.due_date)}
            </span>
          )}
          {linkHref && row.contact_name && (
            <>
              <span aria-hidden="true">·</span>
              <Link href={linkHref} className="hover:text-[var(--primary)] transition-colors">
                {row.contact_name}
              </Link>
            </>
          )}
          {row.assignee_name && (
            <>
              <span aria-hidden="true">·</span>
              <span>{row.assignee_name}</span>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export function TaskList({ rows }: { rows: ReminderRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing outstanding"
        description="Tasks you create, and reminders you set on notes, appear here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map((group) => {
        const items = rows.filter((row) => bucketOf(row.due_date) === group.key);
        if (items.length === 0) return null;

        return (
          <section key={group.key}>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
                {group.label}
              </h2>
              <Badge tone={group.tone}>{items.length}</Badge>
            </div>
            <ul className="flex flex-col">
              {items.map((row) => (
                <ReminderItem key={`${row.kind}-${row.id}`} row={row} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Completed tasks, shown collapsed beneath the open ones. */
export function CompletedTasks({
  rows,
}: {
  rows: { id: string; title: string; completed_at: string | null }[];
}) {
  const [isPending, startTransition] = useTransition();

  if (rows.length === 0) return null;

  return (
    <details className="mt-6">
      <summary className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide cursor-pointer">
        Completed ({rows.length})
      </summary>
      <ul className="flex flex-col mt-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center gap-3 py-2 border-b border-[var(--border-subtle)] last:border-0"
          >
            <span className="size-4 shrink-0 rounded bg-[var(--success)] flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="size-3 text-white" fill="none" stroke="currentColor" strokeWidth={3}>
                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="text-sm text-[var(--text-muted)] line-through flex-1 min-w-0 truncate">
              {row.title}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => startTransition(async () => { await toggleTaskComplete(row.id, false); })}
            >
              Reopen
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
