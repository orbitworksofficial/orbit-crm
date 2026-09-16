'use client';

import { useRealtimeRefresh } from './useRealtimeRefresh';
import { cn } from '@/lib/utils';

/**
 * Subscribes the current page to live table changes and shows the connection
 * state.
 *
 * Rendering the state matters: a dashboard that silently updates leaves you
 * unsure whether you are looking at current numbers or a stale render. A small
 * "Live" marker answers that without drawing attention to itself.
 *
 * When Realtime cannot connect the component renders nothing rather than an
 * error. The page still works — it just stops updating on its own, which is
 * exactly how it behaved before this existed.
 */
export function LiveIndicator({
  tables,
  className,
}: {
  tables: ('contacts' | 'deals' | 'notes')[];
  className?: string;
}) {
  const status = useRealtimeRefresh(tables);

  if (status === 'off') return null;

  const isLive = status === 'live';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]',
        className,
      )}
      // Not announced: this is ambient status, and a screen reader interrupting
      // to say "live" on every reconnect would be noise.
      aria-hidden="true"
    >
      <span className="relative flex size-2">
        {isLive && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--success)] opacity-60" />
        )}
        <span
          className={cn(
            'relative inline-flex size-2 rounded-full',
            isLive ? 'bg-[var(--success)]' : 'bg-[var(--text-muted)]',
          )}
        />
      </span>
      {isLive ? 'Live' : 'Connecting…'}
    </span>
  );
}
