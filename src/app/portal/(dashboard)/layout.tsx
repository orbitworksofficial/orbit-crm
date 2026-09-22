import type { ReactNode } from 'react';
import { PortalShell } from '../PortalShell';
import { portalSignOut } from '../actions';
import { requirePortalUser } from '@/lib/portal-auth';

/**
 * Layout for authenticated portal routes.
 *
 * A route group rather than a path check: /portal/login sits outside it, so the
 * login page needs no session while everything here is guarded, and the client
 * still gets the short /portal URL.
 */
export default async function PortalDashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const portalUser = await requirePortalUser();

  return (
    <PortalShell clientName={portalUser.full_name} signOutAction={portalSignOut}>
      {children}
    </PortalShell>
  );
}
