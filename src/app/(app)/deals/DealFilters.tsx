'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, useTransition } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DATE_RANGE_OPTIONS } from '@/lib/date-range';

/**
 * Filter bar for the deals list (brief §03: filter by status, assigned to,
 * date, and service). URL-driven, like the contacts filters.
 */
export function DealFilters({
  services,
  members,
  current,
}: {
  services: { id: string; name: string }[];
  members: { id: string; full_name: string }[];
  current: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(current.q ?? '');

  useEffect(() => {
    const currentQuery = searchParams.get('q') ?? '';
    if (search === currentQuery) return;

    const timer = setTimeout(() => updateParam('q', search), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete('page');
    startTransition(() => router.push(`/deals?${params.toString()}`));
  }

  const selectClass =
    'rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 min-h-9 text-xs text-[var(--text-primary)] cursor-pointer';

  const isCustomRange = current.range === 'custom';
  const hasAny = Boolean(
    current.q || current.status || current.service || current.assignee || current.range,
  );

  return (
    <Card className="mb-4" padded={false}>
      <div className="p-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search deal title…"
          aria-label="Search deals"
          className="flex-1 min-w-[180px] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 min-h-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />

        <select
          value={current.status ?? ''}
          onChange={(event) => updateParam('status', event.target.value)}
          className={selectClass}
          aria-label="Filter by deal status"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>

        <select
          value={current.service ?? ''}
          onChange={(event) => updateParam('service', event.target.value)}
          className={selectClass}
          aria-label="Filter by service"
        >
          <option value="">All services</option>
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </select>

        <select
          value={current.assignee ?? ''}
          onChange={(event) => updateParam('assignee', event.target.value)}
          className={selectClass}
          aria-label="Filter by assigned team member"
        >
          <option value="">All owners</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.full_name}
            </option>
          ))}
        </select>

        <select
          value={current.range ?? ''}
          onChange={(event) => updateParam('range', event.target.value)}
          className={selectClass}
          aria-label="Filter by date created"
        >
          <option value="">Any date</option>
          {DATE_RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {isCustomRange && (
          <>
            <input
              type="date"
              value={current.from ?? ''}
              onChange={(event) => updateParam('from', event.target.value)}
              className={selectClass}
              aria-label="From date"
            />
            <input
              type="date"
              value={current.to ?? ''}
              onChange={(event) => updateParam('to', event.target.value)}
              className={selectClass}
              aria-label="To date"
            />
          </>
        )}

        {hasAny && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => startTransition(() => router.push('/deals'))}
          >
            Clear
          </Button>
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
