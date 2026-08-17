import { cn } from '@/lib/utils';

/**
 * Horizontal bar list for categorical breakdowns (leads by source, service, or
 * status — brief §05).
 *
 * Form choice: the job is "compare magnitude across named categories", and the
 * category names are long, so a horizontal bar list beats a column chart. These
 * are *nominal* categories, so every bar wears the same hue — colouring bars by
 * their own value would spend the identity channel re-encoding what bar length
 * already shows.
 *
 * Every row is direct-labelled with its name and count. That is deliberate: the
 * chart hues carry a sub-3:1 contrast warning against the surface, and visible
 * labels are the relief channel that makes them legible regardless.
 */
export function BarList({
  data,
  emptyMessage = 'No data in this period.',
  max: providedMax,
  tone = 'chart-1',
  valueFormatter = (value: number) => value.toLocaleString(),
}: {
  data: { label: string; count: number }[];
  emptyMessage?: string;
  /** Overrides the scale maximum. Defaults to the largest value present. */
  max?: number;
  tone?: 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4';
  valueFormatter?: (value: number) => string;
}) {
  if (data.length === 0) {
    return <p className="text-sm text-[var(--text-muted)] py-2">{emptyMessage}</p>;
  }

  // Scale to the largest bar so the chart uses its full width; guard against a
  // zero maximum, which would produce NaN widths.
  const max = providedMax ?? Math.max(...data.map((item) => item.count), 1);

  return (
    <ul className="flex flex-col gap-2.5">
      {data.map((item) => {
        const pct = max > 0 ? (item.count / max) * 100 : 0;
        return (
          <li key={item.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              {/* Text wears text tokens, never the mark colour. */}
              <span className="text-[var(--text-secondary)] truncate">{item.label}</span>
              <span className="text-[var(--text-primary)] font-medium tabular shrink-0">
                {valueFormatter(item.count)}
              </span>
            </div>
            {/* Track is a recessive one-step-off-surface fill, not a border. */}
            <div className="h-2 rounded-full bg-[var(--chart-track)] overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-[width] duration-500')}
                style={{
                  width: `${Math.max(pct, item.count > 0 ? 2 : 0)}%`,
                  backgroundColor: `var(--${tone})`,
                }}
                // The list itself is the accessible representation; the bar is
                // decorative reinforcement of the number beside it.
                aria-hidden="true"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
