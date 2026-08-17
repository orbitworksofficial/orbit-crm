import type { ReactNode } from 'react';
import { Logo } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

/**
 * Centred, single-column shell for the unauthenticated routes
 * (login, forgot password, reset password).
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>
      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center gap-3">
            <Logo variant="full" priority />
            <p className="text-sm text-[var(--text-secondary)]">Customer Relationship Manager</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
