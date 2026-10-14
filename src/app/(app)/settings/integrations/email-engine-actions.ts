'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import { encryptSecret, secretHint, isEncryptionConfigured } from '@/lib/crypto';
import { checkEngineHealth } from '@/lib/email-engine/client';
import type { AdCredential } from '@/lib/supabase/database.types';
import type { ActionState } from './actions';

/**
 * Email Engine connection settings.
 *
 * Stored in the database and encrypted rather than held in the environment,
 * for the same reason as the ad credentials: the URL moves and the secret gets
 * rotated, and neither should need a deploy.
 */

export interface EngineSummary {
  baseUrl: string;
  secretHint: string;
  isActive: boolean;
  lastError: string | null;
  connectedAt: string;
  /** What to paste into the Engine's CRM_CALLBACK_URL. */
  callbackUrl: string;
}

export interface EngineTestResult {
  ok: boolean;
  checks: { label: string; ok: boolean; detail: string }[];
}

const schema = z.object({
  base_url: z
    .string()
    .trim()
    .min(1, 'Enter the Email Engine URL')
    .max(300)
    .url('That does not look like a URL')
    .refine(
      (v) => v.startsWith('https://') || v.startsWith('http://localhost'),
      'The URL must be https, since the secret travels in the request.',
    ),
  // Blank keeps the stored secret, so changing the URL does not mean
  // re-pasting it.
  secret: z.string().trim(),
});

/** Where the Engine should post its status callbacks. Derived from the request
 *  rather than configured, so it is right in every environment. */
export async function getEngineCallbackUrl(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost:3000';
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  return `${protocol}://${host}/api/email-engine/events`;
}

export async function saveEngineSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  if (!isEncryptionConfigured()) {
    return {
      error:
        'CREDENTIALS_ENCRYPTION_KEY is not set on the server. The shared secret cannot be stored safely until it is.',
    };
  }

  const parsed = schema.safeParse({
    base_url: formData.get('base_url') ?? '',
    secret: formData.get('secret') ?? '',
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('ad_credentials')
    .select('id, access_token')
    .eq('organization_id', profile.organization_id)
    .eq('platform', 'email_engine')
    .maybeSingle();

  if (!existing && parsed.data.secret === '') {
    return { error: 'Enter the shared secret the Email Engine expects.' };
  }

  // Trailing slashes would double up when the path is appended.
  const baseUrl = parsed.data.base_url.replace(/\/+$/, '');

  const patch: Partial<AdCredential> = {
    account_id: baseUrl,
    is_active: true,
    last_error: null,
  };

  if (parsed.data.secret !== '') {
    patch.access_token = encryptSecret(parsed.data.secret);
    patch.token_hint = secretHint(parsed.data.secret);
  }

  const { error } = existing
    ? await supabase.from('ad_credentials').update(patch).eq('id', existing.id)
    : await supabase.from('ad_credentials').insert({
        organization_id: profile.organization_id,
        platform: 'email_engine',
        created_by: profile.id,
        ...patch,
      });

  if (error) return { error: `Could not save the settings: ${error.message}` };

  revalidatePath('/settings');
  return { success: 'Email Engine settings saved.' };
}

export async function disconnectEngine(): Promise<void> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from('ad_credentials')
    .delete()
    .eq('organization_id', profile.organization_id)
    .eq('platform', 'email_engine');

  if (error) throw new Error(`Could not disconnect: ${error.message}`);
  revalidatePath('/settings');
}

/**
 * Checks the Engine is reachable and ready.
 *
 * The health endpoint reports the scheduler too, which matters: without it the
 * first email sends but no follow-up ever does — a failure that looks like
 * success until nobody replies.
 */
export async function testEngineConnection(): Promise<EngineTestResult> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const { data } = await supabase
    .from('ad_credentials')
    .select('account_id, access_token')
    .eq('organization_id', profile.organization_id)
    .eq('platform', 'email_engine')
    .maybeSingle();

  if (!data?.account_id) {
    return { ok: false, checks: [{ label: 'Connection', ok: false, detail: 'Not configured yet.' }] };
  }

  const checks: EngineTestResult['checks'] = [];
  const health = await checkEngineHealth(data.account_id);
  checks.push({ label: 'Email Engine', ...health });

  checks.push(
    data.access_token
      ? { label: 'Shared secret', ok: true, detail: 'Stored and encrypted.' }
      : { label: 'Shared secret', ok: false, detail: 'Not set — leads cannot be handed over.' },
  );

  return { ok: checks.every((c) => c.ok), checks };
}
