import type { Metadata } from 'next';
import { ResetPasswordForm } from './ResetPasswordForm';
import { Card } from '@/components/ui/Card';

export const metadata: Metadata = { title: 'Set new password' };

/**
 * Reached via the emailed recovery link, which passes through /auth/callback to
 * establish a recovery session first.
 */
export default function ResetPasswordPage() {
  return (
    <Card>
      <h1 className="text-base font-semibold mb-1">Set a new password</h1>
      <p className="text-sm text-[var(--text-secondary)] mb-5">
        Choose a password of at least 8 characters.
      </p>

      <ResetPasswordForm />
    </Card>
  );
}
