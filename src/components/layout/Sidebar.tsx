'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/lib/supabase/database.types';

/**
 * Primary navigation.
 *
 * Items marked `adminOnly` are filtered out for sales users. This is a UI
 * affordance only — the pages themselves call `requireAdmin()` and RLS blocks
 * the underlying data regardless.
 */

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const iconProps = {
  className: 'size-4 shrink-0',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
  {
    href: '/contacts',
    label: 'Contacts',
    icon: (
      <svg {...iconProps}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: '/deals',
    label: 'Deals',
    icon: (
      <svg {...iconProps}>
        <path d="M20.6 8.4 12 3 3.4 8.4v7.2L12 21l8.6-5.4z" />
        <path d="M12 12v9M3.4 8.4 12 12l8.6-3.6" />
      </svg>
    ),
  },
  {
    href: '/pipeline',
    label: 'Pipeline',
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="4" width="5" height="16" rx="1" />
        <rect x="10" y="4" width="5" height="11" rx="1" />
        <rect x="17" y="4" width="4" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: '/invoices',
    label: 'Invoices',
    icon: (
      <svg {...iconProps}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M9 13h6M9 17h4" />
      </svg>
    ),
    adminOnly: true,
  },
  {
    href: '/reports',
    label: 'Reports',
    icon: (
      <svg {...iconProps}>
        <path d="M3 3v18h18" />
        <path d="M7 15l3-4 3 3 5-7" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    adminOnly: true,
  },
];

export function SidebarNav({
  role,
  onNavigate,
}: {
  role: UserRole;
  /** Called after a link is followed, so the mobile drawer can close itself. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main navigation">
      {items.map((item) => {
        // Match nested routes (/contacts/123) but keep /dashboard exact so it
        // isn't highlighted for every page.
        const isActive =
          item.href === '/dashboard'
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 min-h-10 text-sm font-medium transition-colors',
              isActive
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]',
            )}
          >
            {item.icon}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
