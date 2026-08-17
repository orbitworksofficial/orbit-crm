'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SidebarNav } from './Sidebar';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { cn, getInitials } from '@/lib/utils';
import type { Profile } from '@/lib/supabase/database.types';

/**
 * Authenticated application shell: fixed sidebar on desktop, slide-over drawer
 * on mobile (brief: the team must be able to work from phones).
 */
export function AppShell({
  profile,
  signOutAction,
  children,
}: {
  profile: Profile;
  /** Server action bound by the layout; rendered inside a form. */
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2 px-1" onClick={() => setDrawerOpen(false)}>
      <span
        className="size-7 rounded-lg bg-[var(--primary)] flex items-center justify-center text-[var(--primary-foreground)] text-[11px] font-bold shrink-0"
        aria-hidden="true"
      >
        OW
      </span>
      <span className="font-semibold text-sm truncate">Orbit Works</span>
    </Link>
  );

  const userBlock = (
    <div className="border-t border-[var(--border-subtle)] pt-3 mt-3">
      <div className="flex items-center gap-2.5 px-1 mb-2">
        <span
          className="size-8 rounded-full bg-[var(--surface-sunken)] border border-[var(--border-subtle)] flex items-center justify-center text-xs font-semibold text-[var(--text-secondary)] shrink-0"
          aria-hidden="true"
        >
          {getInitials(profile.full_name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{profile.full_name}</p>
          <p className="text-xs text-[var(--text-muted)] capitalize">{profile.role}</p>
        </div>
      </div>
      <form action={signOutAction}>
        <button
          type="submit"
          className="w-full flex items-center gap-3 rounded-lg px-3 min-h-10 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] transition-colors"
        >
          <svg
            className="size-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          Sign out
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-dvh flex">
      {/* --- Desktop sidebar --- */}
      <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 fixed inset-y-0">
        <div className="h-12 flex items-center">{brand}</div>
        <div className="flex-1 overflow-y-auto py-2">
          <SidebarNav role={profile.role} />
        </div>
        {userBlock}
      </aside>

      {/* --- Mobile drawer --- */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation menu"
          />
          <aside className="absolute inset-y-0 left-0 w-64 bg-[var(--surface-raised)] border-r border-[var(--border-subtle)] p-3 flex flex-col shadow-xl">
            <div className="h-12 flex items-center justify-between">
              {brand}
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="size-9 inline-flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
                aria-label="Close navigation menu"
              >
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              <SidebarNav role={profile.role} onNavigate={() => setDrawerOpen(false)} />
            </div>
            {userBlock}
          </aside>
        </div>
      )}

      {/* --- Main column --- */}
      <div className={cn('flex-1 min-w-0 flex flex-col', 'lg:ml-60')}>
        <header className="h-12 shrink-0 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] flex items-center justify-between px-3 sticky top-0 z-30">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="lg:hidden size-9 inline-flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
            >
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
              </svg>
            </button>
            <span className="lg:hidden font-semibold text-sm">Orbit Works</span>
          </div>
          <ThemeToggle />
        </header>

        {/* key forces a fresh scroll position and remount per route. */}
        <main key={pathname} className="flex-1 p-4 sm:p-6 max-w-[1400px] w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
