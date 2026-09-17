'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { TR, TD } from '@/components/ui/Table';
import {
  setSubscriptionStatus,
  markCycleBilled,
  prepareInvoiceFromSubscription,
} from './actions';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import type { SubscriptionStatus, BillingCycle } from '@/lib/supabase/database.types';

/**
 * One retainer in the list, with its actions.
 *
 * Kept as a client component per row so each carries its own pending state —
 * a single shared state would disable every row while one was saving.
 */

export interface SubscriptionRowData {
  id: string;
  name: string;
  amount: number;
  currency: string;
  cycle: BillingCycle;
  status: SubscriptionStatus;
  nextBillingDate: string;
  contactId: string;
  contactName: string | null;
  companyName: string | null;
}

const STATUS_TONE: Record<SubscriptionStatus, BadgeTone> = {
  active: 'success',
  paused: 'warning',
  cancelled: 'neutral',
};

const CYCLE_LABEL: Record<BillingCycle, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

/** Days until billing; negative when overdue. */
function daysUntil(date: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${date}T00:00:00`).getTime() - today.getTime()) / 864e5);
}

export function SubscriptionRow({ row }: { row: SubscriptionRowData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const days = daysUntil(row.nextBillingDate);
  const isOverdue = row.status === 'active' && days < 0;
  const isDueSoon = row.status === 'active' && days >= 0 && days <= 7;

  function raiseInvoice() {
    startTransition(async () => {
      setError(null);
      const result = await prepareInvoiceFromSubscription(row.id);
      if (result.error) setError(result.error);
      else if (result.invoiceId) router.push(`/invoices/${result.invoiceId}`);
    });
  }

  return (
    <>
      <TR>
        <TD>
          <span className="font-medium text-[var(--text-primary)]">{row.name}</span>
          <span className="block text-xs text-[var(--text-muted)]">
            {CYCLE_LABEL[row.cycle]}
          </span>
        </TD>

        <TD className="text-[var(--text-secondary)]">
          {row.contactName ? (
            <Link
              href={`/contacts/${row.contactId}`}
              className="hover:text-[var(--primary)] transition-colors"
            >
              {row.contactName}
            </Link>
          ) : (
            '—'
          )}
          {row.companyName && (
            <span className="block text-xs text-[var(--text-muted)]">{row.companyName}</span>
          )}
        </TD>

        <TD>
          <Badge tone={STATUS_TONE[row.status]}>
            {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
          </Badge>
        </TD>

        <TD className="text-xs whitespace-nowrap">
          <span
            className={cn(
              isOverdue && 'text-[var(--danger)] font-medium',
              isDueSoon && 'text-[var(--warning)] font-medium',
              !isOverdue && !isDueSoon && 'text-[var(--text-secondary)]',
            )}
          >
            {formatDate(row.nextBillingDate)}
          </span>
          {row.status === 'active' && (
            <span className="block text-[var(--text-muted)]">
              {isOverdue
                ? `${Math.abs(days)}d overdue`
                : days === 0
                  ? 'Due today'
                  : `in ${days}d`}
            </span>
          )}
        </TD>

        <TD align="right" className="font-medium whitespace-nowrap">
          {formatCurrency(row.amount, row.currency)}
        </TD>

        <TD align="right">
          <div className="flex items-center justify-end gap-1">
            {row.status === 'active' && (
              <>
                {/* Creates a DRAFT invoice — nothing is sent automatically. */}
                <Button size="sm" onClick={raiseInvoice} disabled={isPending}>
                  Invoice
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  title="Mark this cycle billed without creating an invoice here"
                  onClick={() =>
                    startTransition(async () => {
                      const result = await markCycleBilled(row.id);
                      if (result.error) setError(result.error);
                    })
                  }
                >
                  Skip
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      await setSubscriptionStatus(row.id, 'paused');
                    })
                  }
                >
                  Pause
                </Button>
              </>
            )}

            {row.status === 'paused' && (
              <Button
                size="sm"
                variant="secondary"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    await setSubscriptionStatus(row.id, 'active');
                  })
                }
              >
                Resume
              </Button>
            )}

            {row.status !== 'cancelled' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => {
                  if (!window.confirm(`Cancel "${row.name}"?`)) return;
                  startTransition(async () => {
                    await setSubscriptionStatus(row.id, 'cancelled');
                  });
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </TD>
      </TR>

      {error && (
        <TR>
          <TD className="text-xs text-[var(--danger)]">{error}</TD>
        </TR>
      )}
    </>
  );
}
