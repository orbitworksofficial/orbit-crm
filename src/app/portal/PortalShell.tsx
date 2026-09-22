'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { cn } from '@/lib/utils';

/**
 * Client portal shell.
 *
 * Deliberately simpler than the staff AppShell: three links across the top
 * rather than a sidebar. A client visits occasionally to check one thing, so
 * the navigation should be obvious at a glance rather than comprehensive.
 */

const LINKS = [
  { href: '/portal', label: 'Overview' },
  { href: '/portal/invoices', label: 'Invoices' },
  { href: '/portal/projects', label: 'Projects' },
];

export function PortalShell({
  clientName,
  signOutAction,
  children,
}: {
  clientName: string;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <Link href="/portal" className="shrink-0">
            <Logo size="sm" />
          </Link>

          <nav className="flex items-center gap-1" aria-label="Portal navigation">
            {LINKS.map((link) => {
              const isActive =
                link.href === '/portal'
                  ? pathname === link.href
                  : pathname.startsWith(link.href);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'px-3 min-h-9 inline-flex items-center rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-[var(--surface-sunken)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]',
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2 min-h-9 transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main key={pathname} className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        {children}
      </main>

      <footer className="border-t border-[var(--border-subtle)] py-4">
        <p className="max-w-5xl mx-auto px-4 text-xs text-[var(--text-muted)]">
          Signed in as {clientName}
        </p>
      </footer>
    </div>
  );
}
