'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers, cookies } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * Authentication server actions.
 *
 * All credential handling is delegated to Supabase Auth — no password hashing
 * or token logic lives in this codebase (brief §01).
 */

export interface AuthActionState {
  error?: string;
  success?: string;
}

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  next: z.string().optional(),
});

export async function signIn(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Deliberately generic: distinguishing "no such user" from "wrong password"
    // would let an attacker enumerate valid accounts.
    return { error: 'Incorrect email or password.' };
  }

  // Start the inactivity clock fresh. Without this a stale `ow_last_seen` from a
  // previous session survives login, and the middleware immediately reads it as
  // an idle timeout — signing the user straight back out with "You were signed
  // out due to inactivity."
  (await cookies()).set('ow_last_seen', String(Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });

  // Only relative paths are honoured, so ?next= cannot be used as an open redirect.
  const next =
    parsed.data.next && parsed.data.next.startsWith('/') && !parsed.data.next.startsWith('//')
      ? parsed.data.next
      : '/dashboard';

  revalidatePath('/', 'layout');
  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Clear the activity marker alongside the session. Leaving it behind makes
  // the next sign-in look like a resumed idle session.
  (await cookies()).delete('ow_last_seen');

  revalidatePath('/', 'layout');
  redirect('/login');
}

const forgotPasswordSchema = z.object({
  email: z.string().email('Enter a valid email address'),
});

export async function requestPasswordReset(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const origin = (await headers()).get('origin') ?? '';

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  // Always report success, whether or not the address exists, so this endpoint
  // cannot be used to discover registered emails.
  return {
    success: 'If an account exists for that address, a reset link is on its way.',
  };
}

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export async function resetPassword(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();

  // Requires the recovery session established by the emailed link.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'This reset link has expired. Please request a new one.' };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
