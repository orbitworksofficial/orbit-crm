import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
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

/**
 * A session-less client used only to verify a password by attempting a sign-in.
 *
 * Supabase Auth has no "check this password" endpoint, so re-authenticating is
 * the only way to confirm someone knows their current password before letting
 * them change it. This must not be the request's own client: a successful
 * `signInWithPassword` rotates that client's session cookies as a side effect,
 * which would log the user out of their current session mid-request.
 *
 * Nothing here reads or writes application data, so RLS is not a consideration
 * — it never carries a session beyond the throwaway one it creates.
 */
export function createVerificationClient() {
  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
