import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Elevated container used for panels, forms, and dashboard tiles. */
export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)]',
        padded && 'p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 mb-4', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        {description && (
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Page-level heading with optional actions. Consistent across all modules. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-[var(--text-primary)] truncate">{title}</h1>
        {description && (
          <p className="text-sm text-[var(--text-secondary)] mt-1">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
}

/** Shown when a filtered list returns nothing, or a module has no data yet. */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-4">
      {icon && <div className="mb-3 text-[var(--text-muted)]">{icon}</div>}
      <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
      {description && (
        <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
