import { formatDateTime, formatDate, getInitials } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import type { Note, ActivityLogEntry } from '@/lib/supabase/database.types';

type NoteRow = Note & { author: { id: string; full_name: string } | null };
type ActivityRow = ActivityLogEntry & { actor: { id: string; full_name: string } | null };

/** Unified timeline entry, so notes and status changes sort together. */
type TimelineEntry =
  | { kind: 'note'; at: string; data: NoteRow }
  | { kind: 'activity'; at: string; data: ActivityRow };

/**
 * Chronological activity history (brief §08): notes interleaved with logged
 * status changes, newest first.
 */
export function Timeline({
  notes,
  activity,
}: {
  notes: NoteRow[];
  activity: ActivityRow[];
}) {
  const entries: TimelineEntry[] = [
    ...notes.map((note): TimelineEntry => ({ kind: 'note', at: note.created_at, data: note })),
    ...activity.map((row): TimelineEntry => ({ kind: 'activity', at: row.created_at, data: row })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <ol className="flex flex-col gap-3">
      {entries.map((entry) => {
        if (entry.kind === 'note') {
          const note = entry.data;
          return (
            <li key={`note-${note.id}`} className="flex gap-3">
              <span
                className="size-7 shrink-0 rounded-full bg-[var(--surface-sunken)] border border-[var(--border-subtle)] flex items-center justify-center text-[10px] font-semibold text-[var(--text-secondary)]"
                aria-hidden="true"
              >
                {getInitials(note.author?.full_name)}
              </span>
              <div className="min-w-0 flex-1 rounded-lg bg-[var(--surface-sunken)] px-3 py-2">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="text-xs font-medium text-[var(--text-primary)]">
                    {note.author?.full_name ?? 'Unknown user'}
                  </span>
                  <time
                    dateTime={note.created_at}
                    className="text-xs text-[var(--text-muted)]"
                  >
                    {formatDateTime(note.created_at)}
                  </time>
                </div>
                <p className="text-sm text-[var(--text-primary)] mt-1 whitespace-pre-wrap break-words">
                  {note.body}
                </p>
                {note.next_action_at && (
                  <p className="mt-2 text-xs">
                    <Badge tone="warning">
                      Next: {note.next_action_description ?? 'Follow up'} ·{' '}
                      {formatDate(note.next_action_at)}
                    </Badge>
                  </p>
                )}
              </div>
            </li>
          );
        }

        const row = entry.data;
        return (
          <li key={`activity-${row.id}`} className="flex gap-3 items-center">
            <span
              className="size-7 shrink-0 rounded-full border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)]"
              aria-hidden="true"
            >
              <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 6v6l4 2" strokeLinecap="round" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            </span>
            <div className="min-w-0 flex-1 flex items-baseline justify-between gap-2 flex-wrap">
              <span className="text-sm text-[var(--text-secondary)]">
                {row.description}
                {row.actor?.full_name && (
                  <span className="text-[var(--text-muted)]"> · {row.actor.full_name}</span>
                )}
              </span>
              <time dateTime={row.created_at} className="text-xs text-[var(--text-muted)]">
                {formatDateTime(row.created_at)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
