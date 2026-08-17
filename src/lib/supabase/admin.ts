import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { env } from '@/lib/env';

/**
 * Service-role Supabase client. **Bypasses Row Level Security entirely.**
 *
 * The `server-only` import above makes bundling this into client code a build
 * error, so the service key can never reach the browser.
 *
 * Legitimate uses in Phase 1 are limited to:
 *   - the public lead intake route (`/api/leads`), which has no session and
 *     performs its own explicit organization scoping;
 *   - admin user invitation, which requires the Auth admin API.
 *
 * Any other use is almost certainly a mistake — reach for `createClient()` from
 * `./server` instead, so RLS stays in force.
 */
export function createAdminClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured. It is required for the public lead intake route and user invitations.',
    );
  }

  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
