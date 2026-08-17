import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Routes reachable without a session. Everything else requires auth. */
const PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password', '/auth/callback'];

/**
 * Runs on every matched request to:
 *   1. refresh the Supabase session cookie (Server Components cannot write
 *      cookies, so this is the only place the token gets rotated);
 *   2. redirect unauthenticated users to /login;
 *   3. enforce the inactivity timeout from the brief (§01 Session handling).
 *
 * Note: this is a routing guard, not the security boundary. Row Level Security
 * is what actually protects the data — a bypass here would still return nothing.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates the token against Supabase. Do not substitute
  // getSession() here — it trusts the cookie without verification.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  if (!user && !isPublicRoute) {
    const redirectUrl = new URL('/login', request.url);
    // Preserve the destination so login can return the user where they meant
    // to go. Only the path is kept, to avoid an open-redirect via ?next=.
    if (pathname !== '/') {
      redirectUrl.searchParams.set('next', pathname);
    }
    return NextResponse.redirect(redirectUrl);
  }

  if (user) {
    // --- Inactivity timeout (brief §01) -------------------------------------
    // Tracked in a first-party cookie rather than server state so it works on
    // Vercel's stateless functions. The cookie is httpOnly, so page scripts
    // cannot forge activity.
    const idleTimeoutMinutes = Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES ?? 60);
    const lastSeenRaw = request.cookies.get('ow_last_seen')?.value;
    const now = Date.now();

    if (lastSeenRaw) {
      const idleMs = now - Number(lastSeenRaw);
      if (Number.isFinite(idleMs) && idleMs > idleTimeoutMinutes * 60_000) {
        await supabase.auth.signOut();
        const redirectUrl = new URL('/login', request.url);
        redirectUrl.searchParams.set('reason', 'timeout');
        const timeoutResponse = NextResponse.redirect(redirectUrl);
        timeoutResponse.cookies.delete('ow_last_seen');
        return timeoutResponse;
      }
    }

    response.cookies.set('ow_last_seen', String(now), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });

    // Signed-in users have no reason to see the login page.
    if (pathname === '/login') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     *   - /api/leads      public website form intake (own auth via shared secret)
     *   - _next/static    build assets
     *   - _next/image     image optimiser
     *   - favicon / images
     */
    '/((?!api/leads|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
