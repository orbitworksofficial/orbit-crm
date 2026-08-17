/**
 * CSV serialisation for report exports (brief §07 "Export to CSV").
 */

/**
 * Escapes a single CSV field per RFC 4180.
 *
 * Quotes any value containing a delimiter, quote, or newline, and doubles inner
 * quotes. Also guards against CSV injection: a value starting with =, +, -, or
 * @ is prefixed with a tab, so spreadsheet software treats it as text rather
 * than executing it as a formula.
 */
function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = String(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    text = `\t${text}`;
  }

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

/**
 * Builds a CSV document from column definitions and rows.
 *
 * A UTF-8 BOM is prepended so Excel opens accented characters correctly, and
 * CRLF line endings are used for the same reason.
 */
export function toCsv<T>(
  columns: { header: string; accessor: (row: T) => unknown }[],
  rows: T[],
): string {
  const headerLine = columns.map((column) => escapeField(column.header)).join(',');
  const dataLines = rows.map((row) =>
    columns.map((column) => escapeField(column.accessor(row))).join(','),
  );

  return `﻿${[headerLine, ...dataLines].join('\r\n')}`;
}

/** Wraps a CSV string in a downloadable Response. */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      // Quoted so filenames containing spaces survive.
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** Builds a dated filename, e.g. "leads-report-2026-08-17.csv". */
export function datedFilename(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
}
