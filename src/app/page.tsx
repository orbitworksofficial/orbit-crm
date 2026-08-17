import { redirect } from 'next/navigation';

/**
 * The CRM has no marketing landing page — the root is just an entry point.
 * Middleware sends unauthenticated visitors to /login before this runs.
 */
export default function RootPage() {
  redirect('/dashboard');
}
