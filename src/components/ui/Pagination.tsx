import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * URL-driven pagination for list views.
 *
 * Renders nothing for a single page, so list pages can include it
 * unconditionally.
 */
export function Pagination({
  page,
  pageSize,
  total,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  /** Current query params to carry across page links (filters, sort). */
  params: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  function hrefForPage(target: number) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') search.set(key, value);
    }
    if (target > 1) search.set('page', String(target));
    const query = search.toString();
    return query ? `?${query}` : '?';
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const linkClass =
    'inline-flex items-center justify-center min-h-9 px-3 rounded-lg border text-sm transition-colors ' +
    'border-[var(--border-strong)] hover:bg-[var(--surface-sunken)] text-[var(--text-primary)]';

  return (
    <nav
      className="flex items-center justify-between gap-3 mt-4 flex-wrap"
      aria-label="Pagination"
    >
      <p className="text-xs text-[var(--text-secondary)] tabular">
        Showing {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefForPage(page - 1)} className={linkClass} rel="prev">
            Previous
          </Link>
        ) : (
          <span className={cn(linkClass, 'opacity-40 pointer-events-none')}>Previous</span>
        )}
        <span className="text-xs text-[var(--text-secondary)] tabular px-1">
          {page} / {totalPages}
        </span>
        {page < totalPages ? (
          <Link href={hrefForPage(page + 1)} className={linkClass} rel="next">
            Next
          </Link>
        ) : (
          <span className={cn(linkClass, 'opacity-40 pointer-events-none')}>Next</span>
        )}
      </div>
    </nav>
  );
}
