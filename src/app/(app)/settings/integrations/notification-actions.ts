'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import { encryptSecret, secretHint, isEncryptionConfigured } from '@/lib/crypto';
import type { AdCredential } from '@/lib/supabase/database.types';
import type { ActionState } from './actions';

/**
 * Lead notification settings.
 *
 * Two independent parts: who gets told, and the credentials used to tell them.
 * Kept separate because the recipient list changes often and the API key
 * almost never does.
 */

export interface NotifySummary {
  fromAddress: string;
  keyHint: string;
  isActive: boolean;
  lastError: string | null;
}

export interface RecipientSummary {
  id: string;
  email: string;
  label: string | null;
  isActive: boolean;
}

const connectSchema = z.object({
  from_address: z
    .string()
    .trim()
    .min(1, 'Enter the sending address')
    .email('That is not a valid email address'),
  // Blank keeps the stored key, so changing the From address does not mean
  // re-pasting it.
  api_key: z.string().trim(),
});

const recipientSchema = z.object({
  email: z.string().trim().min(1, 'Enter an email address').email('That is not a valid email address'),
  label: z
    .string()
    .trim()
    .max(80)
    .transform((v) => (v === '' ? null : v))
    .nullable(),
});

export async function saveNotificationSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  if (!isEncryptionConfigured()) {
    return {
      error:
        'CREDENTIALS_ENCRYPTION_KEY is not set on the server. The API key cannot be stored safely until it is.',
    };
  }

  const parsed = connectSchema.safeParse({
    from_address: formData.get('from_address') ?? '',
    api_key: formData.get('api_key') ?? '',
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('ad_credentials')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('platform', 'resend')
    .maybeSingle();

  if (!existing && parsed.data.api_key === '') {
    return { error: 'Enter your Resend API key.' };
  }

  // The CRM's own address, for the "open in the CRM" link in the email.
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost:3000';
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';

  const patch: Partial<AdCredential> = {
    account_id: parsed.data.from_address,
    config: { crm_url: `${protocol}://${host}` },
    is_active: true,
    last_error: null,
  };

  if (parsed.data.api_key !== '') {
    patch.access_token = encryptSecret(parsed.data.api_key);
    patch.token_hint = secretHint(parsed.data.api_key);
  }

  const { error } = existing
    ? await supabase.from('ad_credentials').update(patch).eq('id', existing.id)
    : await supabase.from('ad_credentials').insert({
        organization_id: profile.organization_id,
        platform: 'resend',
        created_by: profile.id,
        ...patch,
      });

  if (error) return { error: `Could not save the settings: ${error.message}` };

  revalidatePath('/settings');
  return { success: 'Notification settings saved.' };
}

export async function addRecipient(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  const parsed = recipientSchema.safeParse({
    email: formData.get('email') ?? '',
    label: formData.get('label') ?? '',
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.from('notification_recipients').insert({
    organization_id: profile.organization_id,
    // Lowercased so the same person cannot be added twice under a different
    // capitalisation and then receive everything in duplicate.
    email: parsed.data.email.toLowerCase(),
    label: parsed.data.label,
    created_by: profile.id,
  });

  if (error) {
    if (error.code === '23505') return { error: 'That address is already on the list.' };
    return { error: error.message };
  }

  revalidatePath('/settings');
  return { success: `${parsed.data.email} will be notified of new leads.` };
}

export async function removeRecipient(recipientId: string): Promise<void> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from('notification_recipients')
    .delete()
    .eq('id', recipientId)
    .eq('organization_id', profile.organization_id);

  if (error) throw new Error(`Could not remove the recipient: ${error.message}`);
  revalidatePath('/settings');
}

export async function toggleRecipient(recipientId: string, isActive: boolean): Promise<void> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  await supabase
    .from('notification_recipients')
    .update({ is_active: isActive })
    .eq('id', recipientId)
    .eq('organization_id', profile.organization_id);

  revalidatePath('/settings');
}

/** Whether a source's new leads raise an alert. Separate from outreach: that
 *  emails the lead, this emails us. */
export async function toggleSourceNotify(sourceId: string, notify: boolean): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  await supabase.from('lead_sources').update({ notify_on_lead: notify }).eq('id', sourceId);
  revalidatePath('/settings');
}

/**
 * Sends a real alert to the configured recipients.
 *
 * A live send rather than a credential check: the failures that matter here
 * are an unverified sending domain or a rejected address, and neither shows up
 * until something is actually posted to Resend.
 */
export async function sendTestNotification(): Promise<{ ok: boolean; message: string }> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const [{ data: cred }, { data: recipients }] = await Promise.all([
    supabase
      .from('ad_credentials')
      .select('account_id, access_token')
      .eq('organization_id', profile.organization_id)
      .eq('platform', 'resend')
      .maybeSingle(),
    supabase
      .from('notification_recipients')
      .select('email')
      .eq('organization_id', profile.organization_id)
      .eq('is_active', true),
  ]);

  if (!cred?.access_token) return { ok: false, message: 'Not connected yet.' };

  const addresses = (recipients ?? []).map((r) => r.email);
  if (addresses.length === 0) return { ok: false, message: 'Add at least one recipient first.' };

  const { decryptSecret } = await import('@/lib/crypto');
  let apiKey: string;
  try {
    apiKey = decryptSecret(cred.access_token);
  } catch {
    return {
      ok: false,
      message: 'The stored key could not be decrypted — re-enter it.',
    };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: cred.account_id,
        to: addresses,
        subject: 'Test — Orbit Works CRM lead alerts',
        text: 'This is a test. New leads will arrive here with the contact details and a link to the CRM.',
      }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });

    const body = (await res.json().catch(() => null)) as { message?: string } | null;

    return res.ok
      ? { ok: true, message: `Sent to ${addresses.join(', ')}. Check the inbox.` }
      : { ok: false, message: body?.message ?? `Resend returned ${res.status}.` };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'unknown error';
    return { ok: false, message: `Could not reach Resend: ${reason}` };
  }
}
