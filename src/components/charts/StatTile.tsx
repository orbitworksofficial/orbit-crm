import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

/**
 * Stat tile: label, value, optional supporting caption.
 *
 * The value uses proportional figures rather than `tabular-nums` — tabular
 * digits are for columns that must align vertically, and make a large
 * standalone number look loose.
 */
export function StatTile({
  label,
  value,
  caption,
  accent,
  icon,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  /** Tints the value only. Used sparingly, for money and rates. */
  accent?: 'default' | 'success' | 'info' | 'warning';
  icon?: ReactNode;
}) {
  const accentClass =
    accent === 'success'
      ? 'text-[var(--success)]'
      : accent === 'info'
        ? 'text-[var(--info)]'
        : accent === 'warning'
          ? 'text-[var(--warning)]'
          : 'text-[var(--text-primary)]';

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-[var(--text-secondary)]">{label}</p>
        {icon && <span className="text-[var(--text-muted)] shrink-0">{icon}</span>}
      </div>
      <p className={cn('text-2xl font-semibold mt-1.5 truncate', accentClass)}>{value}</p>
      {caption && <p className="text-xs text-[var(--text-muted)] mt-1">{caption}</p>}
    </Card>
  );
}
