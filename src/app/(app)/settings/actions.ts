'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth';
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
