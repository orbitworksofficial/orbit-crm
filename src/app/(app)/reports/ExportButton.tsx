import { Button } from '@/components/ui/Button';

/**
 * CSV export link.
 *
 * A plain anchor rather than a fetch + blob: the route replies with
 * `Content-Disposition: attachment`, so the browser downloads it directly and
 * the button keeps working without JavaScript.
 */
export function ExportButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} download>
      <Button size="sm" variant="secondary" type="button">
        <svg
          className="size-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
        {label}
      </Button>
    </a>
  );
}
