'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import { encryptSecret, secretHint, isEncryptionConfigured } from '@/lib/crypto';
import type { AdPlatform } from '@/lib/supabase/database.types';

/**
 * Ad platform integration settings (Phase 2 groundwork).
 *
 * Credentials are encrypted here before they touch the database, with a key
 * held in the environment. Nothing in this module ever returns a token — not
 * the ciphertext, not the plaintext — so a bug in a client component cannot
 * leak one into the browser.
 */

export interface ActionState {
  error?: string;
  success?: string;
}

/** What the UI is allowed to know about a stored credential. */
export interface CredentialSummary {
  platform: AdPlatform;
  accountId: string;
  tokenHint: string;
  isActive: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  connectedAt: string;
}

const PLATFORM_LABEL: Record<AdPlatform, string> = {
  meta: 'Meta Ads',
  google: 'Google Ads',
  linkedin: 'LinkedIn Ads',
};

const connectSchema = z.object({
  platform: z.enum(['meta', 'google', 'linkedin']),
  account_id: z.string().trim().min(1, 'Enter the ad account ID').max(120),
  access_token: z.string().trim().min(10, 'That access token looks too short'),
  refresh_token: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable(),
});

/**
 * Stores or replaces the credential for one platform.
 *
 * Upserts on (organization_id, platform): reconnecting replaces the token
 * rather than leaving a stale row behind.
 */
export async function connectPlatform(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();

  if (!isEncryptionConfigured()) {
    return {
      error:
        'CREDENTIALS_ENCRYPTION_KEY is not set on the server. Credentials cannot be stored safely until it is.',
    };
  }

  const parsed = connectSchema.safeParse({
    platform: formData.get('platform') ?? '',
    account_id: formData.get('account_id') ?? '',
    access_token: formData.get('access_token') ?? '',
    refresh_token: formData.get('refresh_token') ?? '',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();

  const { error } = await supabase.from('ad_credentials').upsert(
    {
      organization_id: profile.organization_id,
      platform: parsed.data.platform,
      access_token: encryptSecret(parsed.data.access_token),
      refresh_token: parsed.data.refresh_token
        ? encryptSecret(parsed.data.refresh_token)
        : null,
      account_id: parsed.data.account_id,
      token_hint: secretHint(parsed.data.access_token),
      is_active: true,
      // A fresh token invalidates whatever error the previous one produced.
      last_error: null,
      created_by: profile.id,
    },
    { onConflict: 'organization_id,platform' },
  );

  if (error) {
    return { error: `Could not save the credentials: ${error.message}` };
  }

  revalidatePath('/settings');
  return { success: `${PLATFORM_LABEL[parsed.data.platform]} connected.` };
}

export async function disconnectPlatform(platform: AdPlatform) {
  const profile = await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase
    .from('ad_credentials')
    .delete()
    .eq('organization_id', profile.organization_id)
    .eq('platform', platform);

  if (error) throw new Error(`Could not disconnect: ${error.message}`);

  revalidatePath('/settings');
}

/**
 * Checks that a stored credential still works.
 *
 * Until the platform API clients exist this verifies what it can — that the
 * credential is present and decrypts correctly with the current key — and says
 * plainly that a live call is not yet possible. Reporting "connected" without
 * having contacted anything would be worse than reporting nothing.
 */
export async function testConnection(
  platform: AdPlatform,
): Promise<{ ok: boolean; message: string }> {
  const profile = await requireAdmin();

  const supabase = await createClient();
  const { data: credential } = await supabase
    .from('ad_credentials')
    .select('access_token, account_id')
    .eq('organization_id', profile.organization_id)
    .eq('platform', platform)
    .maybeSingle();

  if (!credential) {
    return { ok: false, message: 'No credentials stored for this platform.' };
  }

  try {
    const { decryptSecret } = await import('@/lib/crypto');
    const token = decryptSecret(credential.access_token);
    if (!token) throw new Error('empty');
  } catch {
    return {
      ok: false,
      message:
        'The stored token could not be decrypted. This usually means CREDENTIALS_ENCRYPTION_KEY changed — reconnect the platform.',
    };
  }

  return {
    ok: true,
    message: `Credentials stored and readable for account ${credential.account_id}. A live API check runs once the ${PLATFORM_LABEL[platform]} sync is built.`,
  };
}
