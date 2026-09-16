'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Refreshes the current route when watched tables change (technical spec:
 * "Supabase Realtime for live dashboard metric updates. Contacts list refreshes
 * on new lead from website form").
 *
 * Calls `router.refresh()` rather than mutating local state: every page here is
 * a Server Component that reads through RLS, so re-running the server render is
 * both the simplest correct answer and the only one that cannot drift from what
 * a fresh page load would show.
 *
 * Two deliberate constraints:
 *
 *   - **Debounced.** A bulk import or a multi-row write fires many events in
 *     quick succession. Without debouncing each one triggers a server round
 *     trip, and the page thrashes.
 *
 *   - **Paused when the tab is hidden.** A background tab refreshing on every
 *     change burns the free tier's bandwidth for a view nobody is looking at.
 *     On becoming visible again it refreshes once to catch up.
 *
 * Realtime applies the same RLS policies as a query, so a sales user is only
 * woken for rows they could already read.
 */
export function useRealtimeRefresh(
  tables: ('contacts' | 'deals' | 'notes')[],
  options: { debounceMs?: number } = {},
) {
  const { debounceMs = 800 } = options;
  const router = useRouter();

  const [status, setStatus] = useState<'connecting' | 'live' | 'off'>('connecting');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const missedRef = useRef(false);

  // Keyed on the table list so a caller passing an inline array does not
  // resubscribe on every render.
  const key = tables.join(',');

  useEffect(() => {
    const supabase = createClient();
    const watched = key.split(',') as typeof tables;

    function scheduleRefresh() {
      // Defer while hidden; catch up on return rather than refreshing a tab
      // nobody is watching.
      if (document.visibilityState === 'hidden') {
        missedRef.current = true;
        return;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => router.refresh(), debounceMs);
    }

    const channel = supabase.channel(`crm-changes-${key}`);

    for (const table of watched) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        scheduleRefresh,
      );
    }

    channel.subscribe((channelStatus) => {
      if (channelStatus === 'SUBSCRIBED') setStatus('live');
      else if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
        // Failing to connect must never break the page — it simply stops being
        // live and behaves like any ordinary server-rendered view.
        setStatus('off');
      }
    });

    function handleVisibility() {
      if (document.visibilityState === 'visible' && missedRef.current) {
        missedRef.current = false;
        router.refresh();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      supabase.removeChannel(channel);
    };
  }, [key, debounceMs, router]);

  return status;
}
