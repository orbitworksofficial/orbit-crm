'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { setDealStatus } from '../actions';
import type { DealStatus } from '@/lib/supabase/database.types';

/**
 * One-click status change on the deal detail page.
 *
 * Marking a deal Won is what feeds dashboard revenue, so it should not require
 * opening the full edit form.
 */
export function StatusActions({
  dealId,
  currentStatus,
}: {
  dealId: string;
  currentStatus: DealStatus;
}) {
  const [isPending, startTransition] = useTransition();

  function change(status: DealStatus) {
    startTransition(async () => {
      await setDealStatus(dealId, status);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {currentStatus !== 'won' && (
        <Button size="sm" onClick={() => change('won')} disabled={isPending}>
          Mark won
        </Button>
      )}
      {currentStatus !== 'lost' && (
        <Button size="sm" variant="secondary" onClick={() => change('lost')} disabled={isPending}>
          Mark lost
        </Button>
      )}
      {currentStatus !== 'open' && (
        <Button size="sm" variant="ghost" onClick={() => change('open')} disabled={isPending}>
          Reopen
        </Button>
      )}
    </div>
  );
}
