'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import { DATE_RANGE_OPTIONS } from '@/lib/date-range';

/**
 * Date-range filter driving every dashboard metric (brief §05).
 *
 * Presets render as a single scrollable row of buttons rather than a select, so
 * the common ranges are one tap on mobile. Custom range reveals two date
 * inputs. State lives in the URL so a filtered dashboard is shareable.
 */
export function DateRangeFilter({
  current,
}: {
  current: { range?: string; from?: string; to?: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Default matches resolveDateRange's own fallback, so the highlighted button
  // always reflects the data actually on screen.
  const activeRange = current.range ?? 'last_30_days';

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <Card className="mb-4" padded={false}>
      <div className="p-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar" role="group" aria-label="Date range">
          {DATE_RANGE_OPTIONS.map((option) => {
            const isActive = activeRange === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setParam('range', option.value)}
                aria-pressed={isActive}
                className={cn(
                  'px-2.5 min-h-8 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {activeRange === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={current.from ?? ''}
              onChange={(event) => setParam('from', event.target.value)}
              aria-label="From date"
              className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 min-h-8 text-xs"
            />
            <span className="text-xs text-[var(--text-muted)]">to</span>
            <input
              type="date"
              value={current.to ?? ''}
              onChange={(event) => setParam('to', event.target.value)}
              aria-label="To date"
              className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 min-h-8 text-xs"
            />
          </div>
        )}

        {isPending && (
          <span className="text-xs text-[var(--text-muted)]" role="status">
            Updating…
          </span>
        )}
      </div>
    </Card>
  );
}
