import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from './LoginForm';
import { Card } from '@/components/ui/Card';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;

  return (
    <Card>
      {reason === 'timeout' && (
        <div
          role="status"
          className="mb-4 rounded-lg bg-[var(--warning-bg)] text-[var(--warning)] px-3 py-2 text-xs"
        >
          You were signed out due to inactivity.
        </div>
      )}

      <h1 className="text-base font-semibold mb-1">Sign in</h1>
      <p className="text-sm text-[var(--text-secondary)] mb-5">
        Enter your credentials to access the CRM.
      </p>

      <LoginForm next={next} />

      <p className="mt-4 text-center text-xs text-[var(--text-secondary)]">
        <Link
          href="/forgot-password"
          className="text-[var(--primary)] hover:underline font-medium"
        >
          Forgot your password?
        </Link>
      </p>
    </Card>
  );
}
