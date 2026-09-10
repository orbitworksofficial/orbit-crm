'use client';

import { useState, useId, useMemo } from 'react';
import { formatCurrency, cn } from '@/lib/utils';
import type { TimePoint } from '@/lib/metrics';

/**
 * Revenue and lead trend over time.
 *
 * A real plotted chart: SVG line with an area wash, a value axis, gridlines,
 * and a hover crosshair with a tooltip. Drawn by hand rather than with a chart
 * library — two series over a shared time axis needs about 120 lines of SVG,
 * where a library would add ~150KB to the bundle for the same result.
 *
 * Two measures with wildly different magnitudes (dollars and lead counts) must
 * never share one y-axis, so this renders them as **two stacked panels** with
 * their own scales — the alternative, a dual-axis chart, is the single most
 * misleading thing you can do with a time series.
 */

const PAD = { top: 12, right: 12, bottom: 22, left: 46 };

interface Series {
  key: 'revenue' | 'leads';
  label: string;
  colorVar: string;
  format: (value: number) => string;
}

/** Rounds an axis maximum up to a clean number so ticks read well. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function Panel({
  points,
  series,
  height,
  hovered,
  onHover,
}: {
  points: TimePoint[];
  series: Series;
  height: number;
  hovered: number | null;
  onHover: (index: number | null) => void;
}) {
  const gradientId = useId();
  const width = 800; // viewBox units; the SVG scales to its container.

  const values = points.map((p) => p[series.key]);
  const max = niceMax(Math.max(...values, 0));

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (max > 0 ? (v / max) * plotH : 0);

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[series.key]).toFixed(1)}`)
    .join(' ');

  const areaPath =
    points.length > 0
      ? `${linePath} L ${x(points.length - 1).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} ` +
        `L ${x(0).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} Z`
      : '';

  // Four gridlines including the baseline.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ value: max * f, y: y(max * f) }));

  // Label roughly six x positions, so ticks never collide at 90 buckets.
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={`${series.label} over time`}
      onMouseLeave={() => onHover(null)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          {/* Area is a wash, never a saturated block. */}
          <stop offset="0%" stopColor={`var(${series.colorVar})`} stopOpacity="0.18" />
          <stop offset="100%" stopColor={`var(${series.colorVar})`} stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {/* Gridlines: hairline, solid, recessive. */}
      {ticks.map((tick) => (
        <g key={tick.value}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
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
            {series.format(tick.value)}
          </text>
        </g>
      ))}

      {points.length > 0 && (
        <>
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path
            d={linePath}
            fill="none"
            stroke={`var(${series.colorVar})`}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      )}

      {/* X labels */}
      {points.map((p, i) =>
        i % labelEvery === 0 || i === points.length - 1 ? (
          <text
            key={p.date}
            x={x(i)}
            y={height - 6}
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
            className="fill-[var(--text-muted)]"
            style={{ fontSize: 10 }}
          >
            {p.label}
          </text>
        ) : null,
      )}

      {/* Crosshair + emphasised point */}
      {hovered !== null && points[hovered] && (
        <g pointerEvents="none">
          <line
            x1={x(hovered)}
            x2={x(hovered)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="var(--border-strong)"
            strokeWidth="1"
          />
          {/* 2px surface ring keeps the dot legible where it crosses the line. */}
          <circle
            cx={x(hovered)}
            cy={y(points[hovered][series.key])}
            r="5"
            fill={`var(${series.colorVar})`}
            stroke="var(--surface-raised)"
            strokeWidth="2"
          />
        </g>
      )}

      {/* Invisible hit areas, wider than the marks so hovering is forgiving. */}
      {points.map((p, i) => (
        <rect
          key={`hit-${p.date}`}
          x={x(i) - plotW / Math.max(points.length, 1) / 2}
          y={PAD.top}
          width={Math.max(plotW / Math.max(points.length, 1), 8)}
          height={plotH}
          fill="transparent"
          onMouseEnter={() => onHover(i)}
        />
      ))}
    </svg>
  );
}

export function TrendChart({
  points,
  bucket,
}: {
  points: TimePoint[];
  bucket: 'day' | 'week';
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const totals = useMemo(
    () => ({
      revenue: points.reduce((sum, p) => sum + p.revenue, 0),
      leads: points.reduce((sum, p) => sum + p.leads, 0),
    }),
    [points],
  );

  if (points.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-6 text-center">
        No activity in this period.
      </p>
    );
  }

  const active = hovered !== null ? points[hovered] : null;

  return (
    <div className="flex flex-col gap-1">
      {/* Legend + hovered readout. Text wears text tokens; the swatch carries
          identity. */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-1">
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[var(--chart-4)]" aria-hidden="true" />
            <span className="text-[var(--text-secondary)]">Revenue</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[var(--chart-1)]" aria-hidden="true" />
            <span className="text-[var(--text-secondary)]">Leads</span>
          </span>
        </div>

        <div
          className={cn(
            'text-xs tabular transition-opacity',
            active ? 'opacity-100' : 'opacity-0',
          )}
          role="status"
          aria-live="polite"
        >
          {active && (
            <>
              <span className="text-[var(--text-muted)]">{active.label}</span>
              <span className="text-[var(--text-primary)] font-medium ml-2">
                {formatCurrency(active.revenue)}
              </span>
              <span className="text-[var(--text-secondary)] ml-2">
                · {active.leads} lead{active.leads === 1 ? '' : 's'}
              </span>
            </>
          )}
        </div>
      </div>

      <Panel
        points={points}
        height={150}
        hovered={hovered}
        onHover={setHovered}
        series={{
          key: 'revenue',
          label: 'Revenue',
          colorVar: '--chart-4',
          format: (v) =>
            v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`,
        }}
      />

      <Panel
        points={points}
        height={110}
        hovered={hovered}
        onHover={setHovered}
        series={{
          key: 'leads',
          label: 'Leads',
          colorVar: '--chart-1',
          format: (v) => String(Math.round(v)),
        }}
      />

      <p className="text-xs text-[var(--text-muted)] mt-1">
        {formatCurrency(totals.revenue)} closed and {totals.leads} leads over this
        period, by {bucket}.
      </p>
    </div>
  );
}
