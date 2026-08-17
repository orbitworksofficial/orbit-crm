'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, useTransition } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DATE_RANGE_OPTIONS } from '@/lib/date-range';

interface Option {
  id: string;
  name: string;
}

/**
 * Filter bar for the contacts list (brief §02: filter by source, status,
 * service, assignee, and date range).
 *
 * State lives in the URL rather than component state, so a filtered view is
 * shareable, survives a refresh, and lets the server do the filtering.
 */
export function ContactFilters({
  sources,
  statuses,
  services,
  members,
  current,
}: {
  sources: Option[];
  statuses: Option[];
  services: Option[];
  members: { id: string; full_name: string }[];
  current: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(current.q ?? '');

  // Debounce free-text search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const currentQuery = searchParams.get('q') ?? '';
    if (search === currentQuery) return;

    const timer = setTimeout(() => {
      updateParam('q', search);
    }, 350);
    return () => clearTimeout(timer);
    // updateParam is stable for the lifetime of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // Any filter change invalidates the current page offset.
    params.delete('page');
    startTransition(() => {
      router.push(`/contacts?${params.toString()}`);
    });
  }

  const selectClass =
    'rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 min-h-9 text-xs text-[var(--text-primary)] cursor-pointer';

  const isCustomRange = current.range === 'custom';
  const hasAny = Boolean(
    current.q || current.source || current.status || current.service || current.assignee || current.range,
  );

  return (
    <Card className="mb-4" padded={false}>
      <div className="p-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, email, or company…"
          aria-label="Search contacts"
          className="flex-1 min-w-[180px] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 min-h-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />

        <select
          value={current.status ?? ''}
          onChange={(event) => updateParam('status', event.target.value)}
          className={selectClass}
          aria-label="Filter by lead status"
        >
          <option value="">All statuses</option>
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>

        <select
          value={current.source ?? ''}
          onChange={(event) => updateParam('source', event.target.value)}
          className={selectClass}
          aria-label="Filter by lead source"
        >
          <option value="">All sources</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>

        <select
          value={current.service ?? ''}
          onChange={(event) => updateParam('service', event.target.value)}
          className={selectClass}
          aria-label="Filter by service interest"
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
            onClick={() => startTransition(() => router.push('/contacts'))}
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
