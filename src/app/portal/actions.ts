'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * Client portal authentication.
 *
 * Separate from the staff actions in `(auth)/actions.ts`: a portal visitor is
 * not a member of the organization, and sharing sign-in code would mean any
 * future change to staff auth silently applies to clients too.
 */

export interface PortalAuthState {
  error?: string;
}

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export async function portalSignIn(
  _prevState: PortalAuthState,
  formData: FormData,
): Promise<PortalAuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    // Deliberately generic: distinguishing "no such account" from "wrong
    // password" would let anyone test which of your clients have portal access.
    return { error: 'Incorrect email or password.' };
  }

  // A staff member signing in here would land in the portal with no portal_users
  // row and see nothing. Send them to their own login instead of a blank page.
  const { data: portalUser } = await supabase
    .from('portal_users')
    .select('id, is_active')
    .eq('id', data.user.id)
    .maybeSingle();

  if (!portalUser) {
    await supabase.auth.signOut();
    return { error: 'That account does not have portal access. Staff should sign in at /login.' };
  }

  if (!portalUser.is_active) {
    await supabase.auth.signOut();
    return { error: 'Your access has been suspended. Please contact us.' };
  }

  // Start the inactivity clock fresh; a stale marker from a previous visit
  // would otherwise read as an idle timeout on the next request.
  (await cookies()).set('ow_last_seen', String(Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });

  await supabase
    .from('portal_users')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', data.user.id);

  revalidatePath('/', 'layout');
  redirect('/portal');
}

export async function portalSignOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete('ow_last_seen');
  revalidatePath('/', 'layout');
  redirect('/portal/login');
}
