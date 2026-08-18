import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * Orbit Works brand mark.
 *
 * The supplied artwork sets "Orbit" and the tagline in white, so it can only be
 * read on a dark ground. Rather than box the logo in a dark plate — which reads
 * as a mistake on a light page — two recoloured variants are generated from it,
 * identical except for the wordmark ink:
 *
 *   logo-full-light.png  wordmark in #0f172a, for light surfaces
 *   logo-full-dark.png   wordmark in #f1f5f9, for dark surfaces
 *
 * The orbital symbol and "Works" stay brand pink in both.
 *
 * Both are rendered, and CSS shows exactly one. That choice is deliberate: the
 * viewer's theme is only known in the browser, so picking a single file on the
 * server would flash the wrong one on load and could never respond to the theme
 * toggle. The hidden image costs nothing — the browser skips decoding it — and
 * the swap is instant.
 *
 * See docs/BRANDING.md for how the variants are regenerated.
 */

const SIZES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-6',
  md: 'h-7',
  lg: 'h-9',
};

export function Logo({
  size = 'md',
  className,
  priority = false,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Set where the logo is the largest element on the page (the login screen). */
  priority?: boolean;
}) {
  const common = {
    width: 1000,
    height: 204,
    priority,
    sizes: '240px',
  };

  return (
    <span className={cn('inline-flex items-center min-w-0', className)}>
      {/* Light-mode artwork: hidden once the dark theme applies. */}
      <Image
        {...common}
        src="/logo-full-light.png"
        alt="Orbit Works"
        className={cn('w-auto object-contain dark:hidden', SIZES[size])}
      />
      {/* Dark-mode artwork. aria-hidden and empty alt so screen readers hear
          the name once, not twice. */}
      <Image
        {...common}
        src="/logo-full-dark.png"
        alt=""
        aria-hidden="true"
        className={cn('w-auto object-contain hidden dark:block', SIZES[size])}
      />
    </span>
  );
}

/**
 * The orbital symbol alone, without the wordmark.
 *
 * Solid pink, so it needs no theme variant. Used where the full lockup will not
 * fit — and available for any future tight surface.
 */
export function LogoMark({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/logo-mark.png"
      alt="Orbit Works"
      width={256}
      height={256}
      priority={priority}
      sizes="32px"
      className={cn('object-contain', className)}
    />
  );
}
