import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { Card } from '@/components/ui/Card';

export const metadata: Metadata = { title: 'Reset password' };

export default function ForgotPasswordPage() {
  return (
    <Card>
      <h1 className="text-base font-semibold mb-1">Reset your password</h1>
      <p className="text-sm text-[var(--text-secondary)] mb-5">
        We&apos;ll email you a link to set a new password.
      </p>

      <ForgotPasswordForm />

      <p className="mt-4 text-center text-xs text-[var(--text-secondary)]">
        <Link href="/login" className="text-[var(--primary)] hover:underline font-medium">
          Back to sign in
        </Link>
      </p>
    </Card>
  );
}
