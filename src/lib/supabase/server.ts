import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './database.types';
import { env } from '@/lib/env';

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 *
 * Requests made through this client carry the caller's session, so every query
 * is subject to Row Level Security. This is the client that should be used for
 * essentially all application data access.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session on every request, so ignoring
            // this is safe — see src/middleware.ts.
          }
        },
      },
    },
  );
}
