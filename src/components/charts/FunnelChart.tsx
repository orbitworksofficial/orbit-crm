'use client';

import { useState } from 'react';
import { formatPercent } from '@/lib/utils';

/**
 * Pipeline funnel: how leads narrow from first contact to won.
 *
 * A real funnel rather than a bar list — each stage is drawn as a tapering
 * band, so the drop-off between stages is visible as shape, not just as two
 * numbers you have to compare mentally.
 *
 * Stages are *ordinal* (they have a fixed order), so they take a single-hue
 * ramp that deepens along the funnel rather than one arbitrary colour each.
 */

export interface FunnelStage {
  label: string;
  count: number;
}

const WIDTH = 800;
const BAND_H = 46;
const GAP = 4;

export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const visible = stages.filter((s, i) => i === 0 || s.count > 0 || stages[i - 1].count > 0);
  if (visible.length === 0 || visible[0].count === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-6 text-center">
        No leads in this period.
      </p>
    );
  }

  const top = visible[0].count;
  const height = visible.length * (BAND_H + GAP);

  // Half-width of each band, as a fraction of the widest.
  const halfWidth = (count: number) => (count / top) * (WIDTH / 2 - 60);

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full"
        style={{ height: Math.min(height, 300) }}
        role="img"
        aria-label="Pipeline funnel"
        onMouseLeave={() => setHovered(null)}
      >
        {visible.map((stage, i) => {
          const nextCount = visible[i + 1]?.count ?? stage.count;
          const yTop = i * (BAND_H + GAP);
          const cx = WIDTH / 2;

          const wTop = Math.max(halfWidth(stage.count), 2);
          const wBottom = Math.max(halfWidth(nextCount), 2);

          // Single hue, deepening down the funnel — ordinal, not categorical.
          const opacity = 0.35 + (i / Math.max(visible.length - 1, 1)) * 0.55;
          const isHovered = hovered === i;

          return (
            <g
              key={stage.label}
              onMouseEnter={() => setHovered(i)}
              style={{ cursor: 'default' }}
            >
              <path
                d={`M ${cx - wTop} ${yTop}
                    L ${cx + wTop} ${yTop}
                    L ${cx + wBottom} ${yTop + BAND_H}
                    L ${cx - wBottom} ${yTop + BAND_H} Z`}
                fill="var(--chart-1)"
                fillOpacity={isHovered ? Math.min(opacity + 0.15, 1) : opacity}
                stroke="var(--surface-raised)"
                strokeWidth="2"
              />

              {/* Direct labels: stage on the left, count and rate on the right.
                  Text never wears the mark colour. */}
              <text
                x={12}
                y={yTop + BAND_H / 2 + 4}
                className="fill-[var(--text-secondary)]"
                style={{ fontSize: 12 }}
              >
                {stage.label}
              </text>
              <text
                x={WIDTH - 12}
                y={yTop + BAND_H / 2 + 4}
                textAnchor="end"
                className="fill-[var(--text-primary)]"
                style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
              >
                {stage.count}
                <tspan className="fill-[var(--text-muted)]" style={{ fontWeight: 400 }}>
                  {' '}
                  · {formatPercent(stage.count, top)}
                </tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
