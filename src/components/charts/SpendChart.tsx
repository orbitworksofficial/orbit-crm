'use client';

import { useState } from 'react';
import { Panel, type Series } from './TrendChart';
import { formatCurrency, cn } from '@/lib/utils';
import type { SpendPoint } from '@/lib/metrics';

/**
 * Ad spend, reach and leads over time.
 *
 * Three measures of wildly different magnitude — dollars, impressions in the
 * thousands, lead counts in single figures. They get a panel each with its own
 * scale rather than one chart with multiple axes, because a dual-axis chart
 * invites a comparison the data does not support: a line crossing another
 * means nothing when the two are measured differently.
 *
 * The panels share a hover index, so moving across one reads all three for the
 * same day. That is the comparison that *is* meaningful — what did this day
 * cost, reach and produce.
 */

const SERIES: Series[] = [
  {
    key: 'spend',
    label: 'Spend',
    colorVar: '--chart-4',
    format: (v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`),
  },
  {
    key: 'impressions',
    label: 'Impressions',
    colorVar: '--chart-1',
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(Math.round(v))),
  },
  {
    key: 'leads',
    label: 'Leads',
    colorVar: '--chart-3',
    format: (v) => String(Math.round(v)),
  },
];

export function SpendChart({ points }: { points: SpendPoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-6 text-center">
        No ad spend in this period.
      </p>
    );
  }

  const totals = points.reduce(
    (acc, p) => ({
      spend: acc.spend + p.spend,
      impressions: acc.impressions + p.impressions,
      clicks: acc.clicks + p.clicks,
      leads: acc.leads + p.leads,
    }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0 },
  );

  const active = hovered !== null ? points[hovered] : null;

  return (
    <div>
      {/* Legend: identity comes from the swatch, never from coloured text. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs">
            <span
              className="size-2 rounded-full"
              style={{ background: `var(${s.colorVar})` }}
              aria-hidden="true"
            />
            <span className="text-[var(--text-secondary)]">{s.label}</span>
            {active && (
              <span className="text-[var(--text-primary)] font-medium tabular">
                {s.key === 'spend'
                  ? formatCurrency(active.spend)
                  : Number(active[s.key as keyof SpendPoint]).toLocaleString()}
              </span>
            )}
          </span>
        ))}
        {active && (
          <span className="text-xs text-[var(--text-muted)] ml-auto">{active.label}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {SERIES.map((series) => (
          <Panel
            key={series.key}
            points={points}
            series={series}
            height={series.key === 'spend' ? 140 : 100}
            hovered={hovered}
            onHover={setHovered}
          />
        ))}
      </div>

      <div
        className={cn(
          'mt-3 pt-3 border-t border-[var(--border-subtle)]',
          'flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]',
        )}
      >
        <span>
          <span className="text-[var(--text-secondary)] font-medium tabular">
            {formatCurrency(totals.spend)}
          </span>{' '}
          spent
        </span>
        <span>
          <span className="text-[var(--text-secondary)] font-medium tabular">
            {totals.impressions.toLocaleString()}
          </span>{' '}
          impressions
        </span>
        <span>
          <span className="text-[var(--text-secondary)] font-medium tabular">
            {totals.clicks.toLocaleString()}
          </span>{' '}
          clicks
        </span>
        <span>
          <span className="text-[var(--text-secondary)] font-medium tabular">
            {totals.leads.toLocaleString()}
          </span>{' '}
          leads reported by Meta
        </span>
      </div>
    </div>
  );
}
