/**
 * Date-range presets driving the dashboard and report filters (brief §05).
 *
 * Ranges are half-open [from, to): `from` is inclusive, `to` is exclusive. That
 * avoids the classic end-of-day bug where `<= endDate` silently drops rows
 * timestamped later the same day.
 */

export type DateRangePreset =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'last_30_days'
  | 'last_90_days'
  | 'custom'
  | 'all_time';

export const DATE_RANGE_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_30_days', label: 'Last 30 Days' },
  { value: 'last_90_days', label: 'Last 90 Days' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
];

export interface ResolvedRange {
  /** Inclusive lower bound as an ISO timestamp, or null for all-time. */
  from: string | null;
  /** Exclusive upper bound as an ISO timestamp, or null for all-time. */
  to: string | null;
  preset: DateRangePreset;
  label: string;
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Resolves a preset (plus optional custom bounds) into concrete timestamps.
 *
 * Computed in the server's local timezone. If the team later operates across
 * several timezones, this is the single place to introduce an explicit one.
 */
export function resolveDateRange(
  preset: DateRangePreset | undefined,
  customFrom?: string,
  customTo?: string,
): ResolvedRange {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);

  const effective: DateRangePreset = preset ?? 'last_30_days';

  switch (effective) {
    case 'today':
      return {
        from: today.toISOString(),
        to: tomorrow.toISOString(),
        preset: 'today',
        label: 'Today',
      };

    case 'this_week': {
      // Week starts Monday.
      const dayOfWeek = (today.getDay() + 6) % 7;
      const monday = addDays(today, -dayOfWeek);
      return {
        from: monday.toISOString(),
        to: tomorrow.toISOString(),
        preset: 'this_week',
        label: 'This Week',
      };
    }

    case 'this_month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return {
        from: first.toISOString(),
        to: tomorrow.toISOString(),
        preset: 'this_month',
        label: 'This Month',
      };
    }

    case 'last_90_days':
      return {
        from: addDays(today, -89).toISOString(),
        to: tomorrow.toISOString(),
        preset: 'last_90_days',
        label: 'Last 90 Days',
      };

    case 'all_time':
      return { from: null, to: null, preset: 'all_time', label: 'All Time' };

    case 'custom': {
      const parsedFrom = customFrom ? new Date(customFrom) : null;
      const parsedTo = customTo ? new Date(customTo) : null;

      // Fall back to the default range if the supplied dates are unusable,
      // rather than issuing a query with NaN bounds.
      if (
        !parsedFrom ||
        !parsedTo ||
        Number.isNaN(parsedFrom.getTime()) ||
        Number.isNaN(parsedTo.getTime())
      ) {
        return resolveDateRange('last_30_days');
      }

      return {
        from: startOfDay(parsedFrom).toISOString(),
        // `to` is exclusive, so advance a day to make the picked date inclusive.
        to: addDays(startOfDay(parsedTo), 1).toISOString(),
        preset: 'custom',
        label: 'Custom Range',
      };
    }

    case 'last_30_days':
    default:
      return {
        from: addDays(today, -29).toISOString(),
        to: tomorrow.toISOString(),
        preset: 'last_30_days',
        label: 'Last 30 Days',
      };
  }
}

/** Narrows an arbitrary query-string value to a valid preset. */
export function parsePreset(value: string | undefined): DateRangePreset | undefined {
  if (!value) return undefined;
  return DATE_RANGE_OPTIONS.some((option) => option.value === value)
    ? (value as DateRangePreset)
    : undefined;
}
