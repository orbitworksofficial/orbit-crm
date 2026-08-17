import type { ReactNode } from 'react';
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
          <div className="mb-8 text-center">
            <div className="inline-flex items-center gap-2 mb-2">
              <span
                className="size-7 rounded-lg bg-[var(--primary)] flex items-center justify-center text-[var(--primary-foreground)] text-xs font-bold"
                aria-hidden="true"
              >
                OW
              </span>
              <span className="text-lg font-semibold">Orbit Works</span>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">Customer Relationship Manager</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
