'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth';

/**
 * Staff-side management of client portal access (Phase 2: "Client Portal").
 *
 * Admin only. Granting someone outside the company a login is a decision with
 * consequences, and RLS enforces the same restriction independently.
 *
 * Every account created here carries `account_type: 'portal'` in user metadata.
 * That marker is what stops `handle_new_auth_user` creating a staff profile —
 * without it, inviting a client would hand them full CRM access. A database
 * trigger enforces the same invariant as a backstop.
 */

export interface ActionState {
  error?: string;
  success?: string;
}

/** Shown in the staff UI. Never includes anything the client cannot see. */
export interface PortalAccessSummary {
  id: string;
  contactId: string;
  contactName: string | null;
  companyName: string | null;
  email: string;
  fullName: string;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be 72 characters or fewer')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v), {
    message: 'Password must include both upper and lower case letters',
  })
  .refine((v) => /\d/.test(v), { message: 'Password must include at least one number' });

const grantSchema = z.object({
  contact_id: z.string().uuid('Select a client'),
  email: z.string().trim().email('Enter a valid email address'),
  full_name: z.string().trim().min(1, 'Enter their name').max(200),
  password: passwordField,
});

export async function grantPortalAccess(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  const parsed = grantSchema.safeParse({
    contact_id: formData.get('contact_id') ?? '',
    email: formData.get('email') ?? '',
    full_name: formData.get('full_name') ?? '',
    password: formData.get('password') ?? '',
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();

  // Confirm the contact is in the caller's organization before touching Auth.
  // The admin client below bypasses RLS, so this check is the boundary.
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, full_name')
    .eq('id', parsed.data.contact_id)
    .maybeSingle();

  if (!contact) return { error: 'That client is not in your organization.' };

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error: 'Portal access requires SUPABASE_SERVICE_ROLE_KEY to be configured on the server.',
    };
  }

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      // The marker that keeps this account out of `profiles`.
      account_type: 'portal',
      full_name: parsed.data.full_name,
      organization_id: profile.organization_id,
    },
  });

  if (authError || !created?.user) {
    if (authError && /already|exists|registered/i.test(authError.message)) {
      return { error: 'An account with that email address already exists.' };
    }
    return { error: `Could not create the login: ${authError?.message ?? 'unknown error'}` };
  }

  const { error: rowError } = await supabase.from('portal_users').insert({
    id: created.user.id,
    organization_id: profile.organization_id,
    contact_id: parsed.data.contact_id,
    email: parsed.data.email,
    full_name: parsed.data.full_name,
    invited_by: profile.id,
  });

  if (rowError) {
    // Remove the orphaned auth account: one with no portal_users row can sign
    // in but has no contact, so every query returns nothing — a confusing
    // half-state rather than a clean failure.
    await admin.auth.admin.deleteUser(created.user.id);

    if (rowError.code === '23505') {
      return { error: 'That client already has portal access.' };
    }
    return { error: `Could not grant access: ${rowError.message}` };
  }

  revalidatePath('/settings');
  return {
    success: `${contact.full_name} can now sign in at /portal with ${parsed.data.email}.`,
  };
}

/**
 * Suspends or restores portal access.
 *
 * Deactivating rather than deleting: `portal_contact_id()` returns NULL for an
 * inactive user, so every portal policy fails closed immediately, while the
 * record of who had access survives.
 */
export async function setPortalAccessActive(portalUserId: string, isActive: boolean) {
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase
    .from('portal_users')
    .update({ is_active: isActive })
    .eq('id', portalUserId);

  if (error) throw new Error(`Could not update access: ${error.message}`);

  revalidatePath('/settings');
}

/** Sets a new password for a client who has lost theirs. */
export async function resetPortalPassword(
  portalUserId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  const parsed = passwordField.safeParse(formData.get('password') ?? '');
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();

  // Confirm the target belongs to this organization before using the admin key.
  const { data: target } = await supabase
    .from('portal_users')
    .select('id, full_name')
    .eq('id', portalUserId)
    .maybeSingle();

  if (!target) return { error: 'That portal user is not in your organization.' };

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { error: 'Resetting passwords requires SUPABASE_SERVICE_ROLE_KEY on the server.' };
  }

  const { error } = await admin.auth.admin.updateUserById(portalUserId, {
    password: parsed.data,
  });

  if (error) return { error: `Could not update the password: ${error.message}` };

  void profile;
  revalidatePath('/settings');
  return { success: `Password updated for ${target.full_name}.` };
}

/**
 * Removes portal access entirely, including the login.
 *
 * Unlike deactivation this is irreversible, so it is offered separately.
 */
export async function revokePortalAccess(portalUserId: string) {
  await requireAdmin();

  const supabase = await createClient();
  const { data: target } = await supabase
    .from('portal_users')
    .select('id')
    .eq('id', portalUserId)
    .maybeSingle();

  if (!target) throw new Error('That portal user is not in your organization.');

  // Row first: if the auth delete fails, the client can no longer reach
  // anything, which is the safer half-state.
  await supabase.from('portal_users').delete().eq('id', portalUserId);

  try {
    const admin = createAdminClient();
    await admin.auth.admin.deleteUser(portalUserId);
  } catch {
    // The login is already powerless without its portal_users row.
  }

  revalidatePath('/settings');
}
