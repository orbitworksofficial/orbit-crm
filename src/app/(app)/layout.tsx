import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '../(auth)/actions';

/**
 * Layout for all authenticated routes.
 *
 * `requireProfile()` redirects to /login when there is no active session, so
 * every page in this group can assume a signed-in user.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await requireProfile();
  const supabase = await createClient();

  // Anything due today or earlier, for the sidebar badge. Counted through the
  // same RLS-scoped view the Tasks page reads, so the number always matches
  // what the user will actually find there.
  const today = new Date().toISOString().slice(0, 10);
  const { count } = await supabase
    .from('pending_reminders')
    .select('id', { count: 'exact', head: true })
    .not('due_date', 'is', null)
    .lte('due_date', today);

  return (
    <AppShell profile={profile} signOutAction={signOut} badges={{ tasks: count ?? 0 }}>
      {children}
    </AppShell>
  );
}
