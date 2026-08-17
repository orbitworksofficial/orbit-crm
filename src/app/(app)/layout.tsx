import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { requireProfile } from '@/lib/auth';
import { signOut } from '../(auth)/actions';

/**
 * Layout for all authenticated routes.
 *
 * `requireProfile()` redirects to /login when there is no active session, so
 * every page in this group can assume a signed-in user.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await requireProfile();

  return (
    <AppShell profile={profile} signOutAction={signOut}>
      {children}
    </AppShell>
  );
}
