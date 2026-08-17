import 'server-only';

import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/supabase/database.types';

/**
 * Server-side session and role helpers.
 *
 * These guard the UI. The actual security boundary is Row Level Security in
 * Postgres — a page that forgot to call `requireAdmin()` would still be unable
 * to read data the user is not entitled to.
 */

/**
 * Current user's profile, or null when signed out.
 *
 * Wrapped in React `cache` so multiple calls within one render pass hit the
 * database once.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  // A deactivated user may still hold a valid token; treat them as signed out.
  if (!profile || !profile.is_active) return null;

  return profile;
});

/** Profile of the signed-in user, redirecting to /login when absent. */
export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  return profile;
}

/** As `requireProfile`, but additionally requires the admin role. */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== 'admin') redirect('/dashboard?error=forbidden');
  return profile;
}

/** True when the signed-in user is an admin. For conditional rendering. */
export async function isAdmin(): Promise<boolean> {
  const profile = await getCurrentProfile();
  return profile?.role === 'admin';
}
