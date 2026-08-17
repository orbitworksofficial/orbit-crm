/**
 * Shared utilities used across modules.
 */

/** Joins class names, dropping falsy values. Keeps conditional classes readable. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Formats a number as currency. Defaults to USD per the brief. */
export function formatCurrency(amount: number | null | undefined, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount ?? 0);
}

/** Compact currency for dashboard tiles, e.g. $12.4K. */
export function formatCurrencyCompact(amount: number | null | undefined, currency = 'USD'): string {
  const value = amount ?? 0;
  if (Math.abs(value) < 10_000) return formatCurrency(value, currency);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** Formats an ISO date/timestamp as e.g. "17 Aug 2026". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** Formats an ISO timestamp with time, e.g. "17 Aug 2026, 14:32". */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Relative time for activity timelines, e.g. "3 days ago". */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  const thresholds: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'minute'],
    [24 * 60, 'hour'],
    [30 * 24 * 60, 'day'],
    [365 * 24 * 60, 'month'],
  ];

  const abs = Math.abs(diffMinutes);
  if (abs < 1) return 'just now';
  if (abs < thresholds[0][0]) return formatter.format(diffMinutes, 'minute');
  if (abs < thresholds[1][0]) return formatter.format(Math.round(diffMinutes / 60), 'hour');
  if (abs < thresholds[2][0]) return formatter.format(Math.round(diffMinutes / (60 * 24)), 'day');
  if (abs < thresholds[3][0])
    return formatter.format(Math.round(diffMinutes / (60 * 24 * 30)), 'month');
  return formatter.format(Math.round(diffMinutes / (60 * 24 * 365)), 'year');
}

/** Initials for avatar placeholders, e.g. "Kashif Rehman" → "KR". */
export function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

/** URL-safe slug from a display name. Used when admins add services/sources. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Percentage with one decimal, guarding divide-by-zero. */
export function formatPercent(numerator: number, denominator: number): string {
  if (!denominator) return '0%';
  const pct = (numerator / denominator) * 100;
  return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}
