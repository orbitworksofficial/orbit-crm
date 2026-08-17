'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
];

/** Status filter for the invoice list (brief §06). */
export function InvoiceFilters({ current }: { current: { status?: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setStatus(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('status', value);
    else params.delete('status');
    params.delete('page');
    startTransition(() => router.push(`/invoices?${params.toString()}`));
  }

  const active = current.status ?? '';

  return (
    <Card className="mb-4" padded={false}>
      <div className="p-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar" role="group" aria-label="Filter by status">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value || 'all'}
              type="button"
              onClick={() => setStatus(option.value)}
              aria-pressed={active === option.value}
              className={cn(
                'px-2.5 min-h-8 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                active === option.value
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {isPending && (
          <span className="text-xs text-[var(--text-muted)]" role="status">
            Updating…
          </span>
        )}
      </div>
    </Card>
  );
}
