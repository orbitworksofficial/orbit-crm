import 'server-only';

import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { PortalUser } from '@/lib/supabase/database.types';

/**
 * Session helpers for the client portal.
 *
 * Deliberately separate from `lib/auth.ts`. A portal visitor is not a member of
 * the organization, and mixing the two would mean every future change to staff
 * auth silently applies to clients as well.
 *
 * As with staff auth, these guard the UI. The real boundary is Row Level
 * Security: a portal session simply cannot read internal tables, so a page that
 * forgot to call `requirePortalUser()` would still return nothing.
 */

export const getPortalUser = cache(async (): Promise<PortalUser | null> => {
  const supabase = await createClient();

  // Reads the verified JWT from the cookie without a network call; middleware
  // has already revalidated it for this request.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userId = session?.user?.id;
  if (!userId) return null;

  const { data } = await supabase
    .from('portal_users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  // A revoked client may still hold a valid token; treat them as signed out.
  if (!data || !data.is_active) return null;

  return data;
});

/** Portal user for the current session, redirecting to the portal login. */
export async function requirePortalUser(): Promise<PortalUser> {
  const portalUser = await getPortalUser();
  if (!portalUser) redirect('/portal/login');
  return portalUser;
}

/**
 * True when the signed-in account is a portal client rather than staff.
 *
 * Used by the staff layout to bounce a client who lands on an internal URL —
 * they would see nothing anyway, but an empty CRM is more confusing than a
 * redirect to where they belong.
 */
export async function isPortalSession(): Promise<boolean> {
  return (await getPortalUser()) !== null;
}
