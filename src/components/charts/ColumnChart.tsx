'use client';

import { useState } from 'react';

/**
 * Vertical column chart with a value axis and gridlines.
 *
 * Replaces the flat bar lists for categorical breakdowns. Columns are capped at
 * 24px so a two-category chart does not render two enormous slabs; the leftover
 * band width stays as air.
 *
 * Categories here are *nominal* — Google is not "more" than Facebook — so every
 * column wears the same hue. Colouring each one differently would spend the
 * identity channel re-encoding what column height already shows.
 */

export interface ColumnDatum {
  label: string;
  count: number;
}

const WIDTH = 800;
const HEIGHT = 190;
const PAD = { top: 14, right: 8, bottom: 40, left: 34 };
const MAX_COL_W = 24;

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Truncates a long category name so axis labels never overlap. */
function short(label: string, limit = 12): string {
  return label.length > limit ? `${label.slice(0, limit - 1)}…` : label;
}

export function ColumnChart({
  data,
  tone = 'chart-1',
  emptyMessage = 'No data in this period.',
}: {
  data: ColumnDatum[];
  tone?: 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4';
  emptyMessage?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length === 0) {
    return <p className="text-sm text-[var(--text-muted)] py-6 text-center">{emptyMessage}</p>;
  }

  const max = niceMax(Math.max(...data.map((d) => d.count), 0));
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const band = plotW / data.length;
  const colW = Math.min(band * 0.6, MAX_COL_W);

  const y = (v: number) => PAD.top + plotH - (max > 0 ? (v / max) * plotH : 0);
  const ticks = [0, 0.5, 1].map((f) => ({ value: max * f, y: y(max * f) }));

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        style={{ height: HEIGHT }}
        role="img"
        aria-label="Category breakdown"
        onMouseLeave={() => setHovered(null)}
      >
        {ticks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--border-subtle)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={tick.y + 3.5}
              textAnchor="end"
              className="fill-[var(--text-muted)]"
              style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
            >
              {Math.round(tick.value)}
            </text>
          </g>
        ))}

        {data.map((datum, i) => {
          const cx = PAD.left + band * i + band / 2;
          const top = y(datum.count);
          const h = Math.max(PAD.top + plotH - top, datum.count > 0 ? 2 : 0);
          const isHovered = hovered === i;

          return (
            <g key={datum.label} onMouseEnter={() => setHovered(i)}>
              {/* Rounded data-end, square at the baseline. */}
              <rect
                x={cx - colW / 2}
                y={top}
                width={colW}
                height={h}
                rx="4"
                fill={`var(--${tone})`}
                fillOpacity={isHovered ? 1 : 0.85}
              />
              <rect
                x={cx - colW / 2}
                y={PAD.top + plotH - Math.min(h, 4)}
                width={colW}
                height={Math.min(h, 4)}
                fill={`var(--${tone})`}
                fillOpacity={isHovered ? 1 : 0.85}
              />

              {/* Value on the cap, shown on hover or when there is room. */}
              {(isHovered || data.length <= 8) && datum.count > 0 && (
                <text
                  x={cx}
                  y={top - 5}
                  textAnchor="middle"
                  className="fill-[var(--text-primary)]"
                  style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                >
                  {datum.count}
                </text>
              )}

              <text
                x={cx}
                y={HEIGHT - 22}
                textAnchor="middle"
                className={
                  isHovered ? 'fill-[var(--text-primary)]' : 'fill-[var(--text-muted)]'
                }
                style={{ fontSize: 10 }}
              >
                {short(datum.label)}
              </text>

              {/* Full label on hover, for anything truncated. */}
              {isHovered && datum.label.length > 12 && (
                <text
                  x={cx}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-[var(--text-secondary)]"
                  style={{ fontSize: 10 }}
                >
                  {datum.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
