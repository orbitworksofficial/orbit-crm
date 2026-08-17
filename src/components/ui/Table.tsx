import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Table primitives.
 *
 * The wrapper scrolls horizontally on small screens rather than letting wide
 * tables push the page body sideways (brief: mobile-first, must work on phones).
 */

export function TableWrapper({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return <table className="w-full text-sm border-collapse">{children}</table>;
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-[var(--surface-sunken)] border-b border-[var(--border-subtle)]">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-[var(--border-subtle)]">{children}</tbody>;
}

export function TR({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr className={cn('hover:bg-[var(--surface-sunken)] transition-colors', className)}>
      {children}
    </tr>
  );
}

export function TH({
  children,
  align = 'left',
  className,
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'px-3 py-2.5 text-xs font-semibold text-[var(--text-secondary)] whitespace-nowrap',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  align = 'left',
  className,
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <td
      className={cn(
        'px-3 py-2.5 text-[var(--text-primary)] align-middle',
        align === 'right' && 'text-right tabular',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

/**
 * Sortable column header.
 *
 * Sorting is URL-driven (`?sort=field&dir=asc`) rather than client state, so a
 * sorted view is shareable, survives refresh, and lets the server do the work.
 */
export function SortableTH({
  children,
  field,
  currentSort,
  currentDir,
  baseParams,
  align = 'left',
}: {
  children: ReactNode;
  field: string;
  currentSort?: string;
  currentDir?: string;
  /** Existing query params to preserve (filters, page). */
  baseParams: Record<string, string | undefined>;
  align?: 'left' | 'right' | 'center';
}) {
  const isActive = currentSort === field;
  const nextDir = isActive && currentDir === 'asc' ? 'desc' : 'asc';

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(baseParams)) {
    if (value && key !== 'sort' && key !== 'dir') params.set(key, value);
  }
  params.set('sort', field);
  params.set('dir', nextDir);

  return (
    <TH align={align}>
      <Link
        href={`?${params.toString()}`}
        className={cn(
          'inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors',
          isActive && 'text-[var(--text-primary)]',
        )}
        aria-sort={isActive ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {children}
        <span aria-hidden="true" className={cn('text-[10px]', !isActive && 'opacity-30')}>
          {isActive && currentDir === 'asc' ? '▲' : '▼'}
        </span>
      </Link>
    </TH>
  );
}
