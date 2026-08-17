'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';

/**
 * Supabase client for Client Components.
 *
 * Used for interactive auth calls (sign in / out / password reset) and for
 * Realtime subscriptions. All data access remains RLS-constrained.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
