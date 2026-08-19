import type { Metadata } from 'next';
import { requireProfile } from '@/lib/auth';
import { PageHeader, Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ProfileForm } from './ProfileForm';
import { PasswordForm } from './PasswordForm';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = { title: 'Account' };

/**
 * The signed-in user's own account (brief §01, §09).
 *
 * Available to every role. Settings remains admin-only, so this is where a
 * sales user changes their own name and password.
 */
export default async function AccountPage() {
  const profile = await requireProfile();

  return (
    <>
      <PageHeader
        title="Your account"
        description="Update your details and password."
      />

      <div className="flex flex-col gap-4 max-w-2xl">
        <Card>
          <CardHeader title="Your details" />
          <dl className="grid gap-3 sm:grid-cols-2 mb-5 text-sm">
            <div>
              <dt className="text-xs text-[var(--text-muted)]">Email</dt>
              <dd className="mt-0.5">{profile.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-muted)]">Role</dt>
              <dd className="mt-0.5">
                <Badge tone={profile.role === 'admin' ? 'accent' : 'neutral'}>
                  {profile.role === 'admin' ? 'Admin' : 'Sales'}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-muted)]">Member since</dt>
              <dd className="mt-0.5">{formatDate(profile.created_at)}</dd>
            </div>
          </dl>

          <div className="border-t border-[var(--border-subtle)] pt-4">
            <ProfileForm fullName={profile.full_name} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Change password"
            description="You will stay signed in on this device."
          />
          <PasswordForm />
        </Card>
      </div>
    </>
  );
}
