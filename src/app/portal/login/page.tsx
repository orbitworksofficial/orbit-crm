import type { Metadata } from 'next';
import { Card } from '@/components/ui/Card';
import { Logo } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { PortalLoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Client sign in' };

/**
 * Client portal sign-in.
 *
 * Its own page rather than a mode of the staff login: a client should never see
 * internal branding or be one mistaken click from an admin form, and the error
 * messages differ.
 */
export default function PortalLoginPage() {
  return (
    <div className="min-h-dvh flex flex-col">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center gap-3">
            <Logo size="lg" priority />
            <p className="text-sm text-[var(--text-secondary)]">Client Portal</p>
          </div>

          <Card>
            <h1 className="text-base font-semibold mb-1">Sign in</h1>
            <p className="text-sm text-[var(--text-secondary)] mb-5">
              View your invoices and project status.
            </p>

            <PortalLoginForm />
          </Card>

          <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
            Need access? Contact your account manager.
          </p>
        </div>
      </div>
    </div>
  );
}
