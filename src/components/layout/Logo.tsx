import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * Orbit Works brand mark.
 *
 * The supplied artwork sets "Orbit" and the tagline in white, with only the
 * orbital symbol and "Works" in brand pink — so the full lockup disappears on a
 * light background. Rather than force a single asset to work everywhere, this
 * component offers two treatments derived from that same source file:
 *
 *   `mark` — the orbital symbol alone (`logo-mark.png`, trimmed from the
 *     original). It is pure pink, so it reads on any surface in either theme.
 *     Paired with the company name as live text, which inherits the theme's
 *     ink colour. Used in the sidebar and mobile header.
 *
 *   `full` — the complete lockup (`logo-full.png`) on a dark plate, which is
 *     the ground it was drawn for. Used on the login screen, where the brand
 *     should lead.
 *
 * Both assets are generated from `public/logo.png`; see docs/BRANDING.md.
 */

export function Logo({
  variant = 'mark',
  className,
  priority = false,
}: {
  /**
   * `full` — complete lockup on a dark plate, for the login screen.
   * `bar`  — same lockup sized for the sidebar's brand row.
   * `mark` — orbital symbol plus live text, for tight or light surfaces.
   */
  variant?: 'full' | 'bar' | 'mark';
  className?: string;
  /** Set where the logo is the largest element on the page (the login screen). */
  priority?: boolean;
}) {
  if (variant === 'full' || variant === 'bar') {
    const isBar = variant === 'bar';
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center bg-[#0b1120]',
          // The plate is mandatory, not stylistic: "Orbit" and the tagline are
          // white in the source artwork and vanish on a light surface.
          isBar ? 'rounded-lg px-3 py-2' : 'rounded-xl px-6 py-4',
          className,
        )}
      >
        <Image
          src="/logo-full.png"
          alt="Orbit Works"
          width={1000}
          height={204}
          priority={priority}
          sizes={isBar ? '190px' : '220px'}
          className={cn('w-auto', isBar ? 'h-6' : 'h-9')}
        />
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-2 min-w-0', className)}>
      <Image
        src="/logo-mark.png"
        alt=""
        width={256}
        height={256}
        priority={priority}
        sizes="28px"
        className="size-7 shrink-0 object-contain"
        aria-hidden="true"
      />
      <span className="font-semibold text-sm truncate text-[var(--text-primary)]">
        Orbit Works
      </span>
    </span>
  );
}
