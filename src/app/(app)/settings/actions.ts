'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, createVerificationClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin, requireProfile } from '@/lib/auth';
import { slugify } from '@/lib/utils';

/**
 * Settings server actions (brief §09). All admin-only.
 */

export interface ActionState {
  error?: string;
  success?: string;
}

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable();

/* -------------------------------------------------------------------------- */
/* Company profile                                                             */
/* -------------------------------------------------------------------------- */

const companySchema = z.object({
  name: z.string().trim().min(1, 'Company name is required').max(200),
  website_url: optionalText,
  contact_email: optionalText,
});

export async function updateCompanyProfile(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  const parsed = companySchema.safeParse({
    name: formData.get('name') ?? '',
    website_url: formData.get('website_url') ?? '',
    contact_email: formData.get('contact_email') ?? '',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('organizations')
    .update(parsed.data)
    .eq('id', profile.organization_id);

  if (error) return { error: error.message };

  revalidatePath('/settings');
  return { success: 'Company profile saved.' };
}

/**
 * Uploads a company logo to Supabase Storage for use in the invoice PDF header.
 */
export async function uploadLogo(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose an image to upload.' };
  }

  if (file.size > 2 * 1024 * 1024) {
    return { error: 'The logo must be 2MB or smaller.' };
  }

  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
  if (!allowedTypes.includes(file.type)) {
    return { error: 'The logo must be a PNG, JPEG, WebP, or SVG file.' };
  }

  const supabase = await createClient();

  // Namespaced by organization so Phase 2 tenants cannot collide, and suffixed
  // with a timestamp to bust any CDN cache of the previous logo.
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png';
  const path = `${profile.organization_id}/logo-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('branding')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}` };
  }

  const { error: updateError } = await supabase
    .from('organizations')
    .update({ logo_path: path })
    .eq('id', profile.organization_id);

  if (updateError) return { error: updateError.message };

  revalidatePath('/settings');
  return { success: 'Logo uploaded.' };
}

/* -------------------------------------------------------------------------- */
/* Invoice settings                                                            */
/* -------------------------------------------------------------------------- */

const invoiceSettingsSchema = z.object({
  invoice_prefix: z.string().trim().min(1).max(10),
  default_currency: z.string().trim().length(3, 'Use a 3-letter currency code'),
  default_payment_terms_days: z.coerce.number().int().min(0).max(365),
  default_tax_rate: z.coerce.number().min(0).max(100),
});

export async function updateInvoiceSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  const parsed = invoiceSettingsSchema.safeParse({
    invoice_prefix: formData.get('invoice_prefix') ?? '',
    default_currency: formData.get('default_currency') ?? '',
    default_payment_terms_days: formData.get('default_payment_terms_days') ?? 30,
    default_tax_rate: formData.get('default_tax_rate') ?? 0,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('organizations')
    .update({
      ...parsed.data,
      default_currency: parsed.data.default_currency.toUpperCase(),
    })
    .eq('id', profile.organization_id);

  if (error) return { error: error.message };

  revalidatePath('/settings');
  return { success: 'Invoice settings saved.' };
}

/* -------------------------------------------------------------------------- */
/* Services                                                                    */
/* -------------------------------------------------------------------------- */

export async function createService(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Service name is required.' };

  const rateRaw = String(formData.get('default_rate') ?? '').trim();
  const defaultRate = rateRaw === '' ? null : Number(rateRaw);
  if (defaultRate !== null && (Number.isNaN(defaultRate) || defaultRate < 0)) {
    return { error: 'Enter a valid default rate.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('services').insert({
    name,
    slug: slugify(name),
    default_rate: defaultRate,
    organization_id: profile.organization_id,
    description: String(formData.get('description') ?? '').trim() || null,
  });

  if (error) {
    // 23505 is unique_violation on (organization_id, slug).
    if (error.code === '23505') {
      return { error: 'A service with that name already exists.' };
    }
    return { error: error.message };
  }

  revalidatePath('/settings');
  return { success: `"${name}" added.` };
}

export async function updateService(serviceId: string, formData: FormData) {
  await requireAdmin();

  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Service name is required.');

  const rateRaw = String(formData.get('default_rate') ?? '').trim();

  const supabase = await createClient();
  await supabase
    .from('services')
    .update({
      name,
      default_rate: rateRaw === '' ? null : Number(rateRaw),
    })
    .eq('id', serviceId);

  revalidatePath('/settings');
}

/**
 * Archives or restores a service.
 *
 * Services are never deleted: historical invoice line items and lead tags
 * reference them, and deletion would rewrite history.
 */
export async function toggleServiceActive(serviceId: string, isActive: boolean) {
  await requireAdmin();

  const supabase = await createClient();
  await supabase.from('services').update({ is_active: isActive }).eq('id', serviceId);

  revalidatePath('/settings');
}

/* -------------------------------------------------------------------------- */
/* Lead sources                                                                */
/* -------------------------------------------------------------------------- */

export async function createLeadSource(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Source name is required.' };

  const supabase = await createClient();
  const { error } = await supabase.from('lead_sources').insert({
    name,
    slug: slugify(name),
    organization_id: profile.organization_id,
  });

  if (error) {
    if (error.code === '23505') {
      return { error: 'A source with that name already exists.' };
    }
    return { error: error.message };
  }

  revalidatePath('/settings');
  return { success: `"${name}" added.` };
}

/**
 * Renames a lead source.
 *
 * The slug is deliberately left untouched: the website form posts by slug, so
 * changing it would silently break lead intake.
 */
export async function renameLeadSource(sourceId: string, formData: FormData) {
  await requireAdmin();

  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Source name is required.');

  const supabase = await createClient();
  await supabase.from('lead_sources').update({ name }).eq('id', sourceId);

  revalidatePath('/settings');
}

export async function toggleLeadSourceActive(sourceId: string, isActive: boolean) {
  await requireAdmin();

  const supabase = await createClient();
  await supabase.from('lead_sources').update({ is_active: isActive }).eq('id', sourceId);

  revalidatePath('/settings');
}

/* -------------------------------------------------------------------------- */
/* User management                                                             */
/* -------------------------------------------------------------------------- */

const inviteSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  full_name: z.string().trim().min(1, 'Full name is required').max(200),
  role: z.enum(['admin', 'sales']),
});

/**
 * Invites a team member by email (brief §09).
 *
 * Requires the Auth admin API, so it is one of the two legitimate uses of the
 * service-role client. The organization and role travel in user metadata, where
 * the `handle_new_auth_user` trigger reads them to create the profile row.
 */
export async function inviteUser(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  const parsed = inviteSchema.safeParse({
    email: formData.get('email') ?? '',
    full_name: formData.get('full_name') ?? '',
    role: formData.get('role') ?? 'sales',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error:
        'User invitations require SUPABASE_SERVICE_ROLE_KEY to be configured on the server.',
    };
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    data: {
      full_name: parsed.data.full_name,
      role: parsed.data.role,
      organization_id: profile.organization_id,
    },
  });

  if (error) {
    return { error: `Could not send the invitation: ${error.message}` };
  }

  revalidatePath('/settings');
  return { success: `Invitation sent to ${parsed.data.email}.` };
}

/**
 * Shared password rule.
 *
 * Eight characters is Supabase Auth's own floor. The mixed-case and digit
 * requirements are ours: an admin typing a password on someone's behalf tends
 * to reach for something short and obvious.
 */
const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be 72 characters or fewer')
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value), {
    message: 'Password must include both upper and lower case letters',
  })
  .refine((value) => /\d/.test(value), {
    message: 'Password must include at least one number',
  });

const createUserSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  full_name: z.string().trim().min(1, 'Full name is required').max(200),
  role: z.enum(['admin', 'sales']),
  password: passwordField,
});

/**
 * Creates a team member directly, with a password the admin sets (brief §09).
 *
 * The alternative flow, `inviteUser`, emails a link and lets the person choose
 * their own password. This one exists for the case where an admin is setting
 * someone up in person, or where email delivery is unreliable.
 *
 * `email_confirm: true` marks the address as verified, since an admin creating
 * the account is the verification. Without it the user cannot sign in until
 * they click a confirmation email that this flow never sends.
 */
export async function createUser(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  const parsed = createUserSchema.safeParse({
    email: formData.get('email') ?? '',
    full_name: formData.get('full_name') ?? '',
    role: formData.get('role') ?? 'sales',
    password: formData.get('password') ?? '',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error: 'Creating users requires SUPABASE_SERVICE_ROLE_KEY to be configured on the server.',
    };
  }

  const { error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.full_name,
      role: parsed.data.role,
      organization_id: profile.organization_id,
    },
  });

  if (error) {
    // Supabase reports a duplicate address in a few different shapes.
    if (/already|exists|registered/i.test(error.message)) {
      return { error: 'An account with that email address already exists.' };
    }
    return { error: `Could not create the user: ${error.message}` };
  }

  revalidatePath('/settings');
  return {
    success: `${parsed.data.full_name} can now sign in with ${parsed.data.email}.`,
  };
}

/**
 * Sets another user's password (admin only).
 *
 * Deliberately refuses the admin's own account: changing your own password
 * should go through `changeOwnPassword`, which demands the current one. Without
 * that split, an unattended logged-in session would be a full account takeover.
 */
export async function setUserPassword(
  userId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  if (userId === profile.id) {
    return {
      error: 'To change your own password, use the Account page — it asks for your current password.',
    };
  }

  const parsed = passwordField.safeParse(formData.get('password') ?? '');
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();

  // Confirm the target is in the caller's organization before touching Auth.
  // The admin client bypasses RLS, so this check is the boundary — without it,
  // a crafted user id could reach an account in another organization once
  // Phase 2 multi-tenancy lands.
  const { data: target } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('id', userId)
    .maybeSingle();

  if (!target) {
    return { error: 'That user is not part of your organization.' };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error: 'Resetting passwords requires SUPABASE_SERVICE_ROLE_KEY to be configured on the server.',
    };
  }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: parsed.data,
  });

  if (error) {
    return { error: `Could not update the password: ${error.message}` };
  }

  revalidatePath('/settings');
  return { success: `Password updated for ${target.full_name}.` };
}

const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Enter your current password'),
    password: passwordField,
    confirm_password: z.string(),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'The new passwords do not match',
    path: ['confirm_password'],
  })
  .refine((data) => data.password !== data.current_password, {
    message: 'The new password must be different from the current one',
    path: ['password'],
  });

/**
 * Changes the signed-in user's own password. Available to every role.
 *
 * The current password is re-verified by attempting a sign-in with it. Supabase
 * has no "confirm password" endpoint, and `updateUser` alone would let anyone
 * with access to an unlocked session silently take over the account.
 */
export async function changeOwnPassword(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();

  const parsed = changePasswordSchema.safeParse({
    current_password: formData.get('current_password') ?? '',
    password: formData.get('password') ?? '',
    confirm_password: formData.get('confirm_password') ?? '',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();

  // Verify the current password on a throwaway client. Using the request's own
  // client would rotate its session tokens as a side effect of the check.
  const verifier = createVerificationClient();
  const { error: verifyError } = await verifier.auth.signInWithPassword({
    email: profile.email,
    password: parsed.data.current_password,
  });

  if (verifyError) {
    return { error: 'That is not your current password.' };
  }
  await verifier.auth.signOut();

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return { error: `Could not update your password: ${error.message}` };
  }

  revalidatePath('/account');
  return { success: 'Your password has been updated.' };
}

const profileSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required').max(200),
});

/** Updates the signed-in user's own display name. Available to every role. */
export async function updateOwnProfile(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();

  const parsed = profileSchema.safeParse({ full_name: formData.get('full_name') ?? '' });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: parsed.data.full_name })
    .eq('id', profile.id);

  if (error) return { error: error.message };

  revalidatePath('/account');
  revalidatePath('/', 'layout');
  return { success: 'Your details have been saved.' };
}

/**
 * Changes a user's role.
 *
 * Delegates to the `set_user_role` database function, which re-checks that the
 * caller is an admin and refuses self-demotion. Keeping the rule in Postgres
 * means it holds no matter which client performs the update.
 */
export async function setUserRole(userId: string, role: 'admin' | 'sales') {
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_user_role', {
    p_user_id: userId,
    p_role: role,
  });

  if (error) throw new Error(error.message);

  revalidatePath('/settings');
}

/** Activates or deactivates a user. Deactivated users cannot sign in. */
export async function setUserActive(userId: string, isActive: boolean) {
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_user_active', {
    p_user_id: userId,
    p_is_active: isActive,
  });

  if (error) throw new Error(error.message);

  revalidatePath('/settings');
}
