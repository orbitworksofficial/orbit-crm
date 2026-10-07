import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptSecret } from '@/lib/crypto';
import type { Database } from '@/lib/supabase/database.types';
import type { MetaConfig } from './types';

/**
 * Loading and decrypting the Meta credential.
 *
 * Every function here returns plaintext secrets, so nothing in this module may
 * be called from a client component — hence 'server-only'. The Settings UI gets
 * a summary DTO built in the page instead.
 */

export interface MetaCredential {
  id: string;
  organizationId: string;
  accountId: string;
  /** Null when the ads token has not been set, which is the normal state until
   *  App Review completes — the Conversions API half works without it. */
  adsToken: string | null;
  appSecret: string | null;
  capiToken: string | null;
  config: MetaConfig;
  lastSyncedAt: string | null;
}

/** SHA-256 hex. See the webhook_verify_token_hash column comment for why the
 *  verify token is stored hashed as well as encrypted. */
export function verifyTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 32 bytes, base64url. Long enough that the unauthenticated webhook GET
 *  cannot be brute-forced. */
export function generateVerifyToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Decrypts one ciphertext column, treating failure as absence.
 *
 * A rotated CREDENTIALS_ENCRYPTION_KEY makes every stored secret unreadable.
 * Throwing here would take down the Settings page and the webhook together,
 * which is a worse outcome than reporting the credential as unset and letting
 * the user reconnect.
 */
function tryDecrypt(ciphertext: string | null, label: string): string | null {
  if (!ciphertext) return null;
  try {
    return decryptSecret(ciphertext);
  } catch (cause) {
    console.error(
      `[meta] Could not decrypt ${label}; CREDENTIALS_ENCRYPTION_KEY may have changed.`,
      cause,
    );
    return null;
  }
}

export async function loadMetaCredential(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<MetaCredential | null> {
  const { data, error } = await supabase
    .from('ad_credentials')
    .select(
      'id, organization_id, account_id, access_token, app_secret_encrypted, capi_token_encrypted, config, last_synced_at, is_active',
    )
    .eq('organization_id', organizationId)
    .eq('platform', 'meta')
    .maybeSingle();

  if (error || !data || !data.is_active) return null;

  // access_token is NOT NULL on the table, so "no ads token yet" is stored as
  // an empty string by the Settings action rather than as null.
  const adsToken = data.access_token ? tryDecrypt(data.access_token, 'the ads token') : null;

  return {
    id: data.id,
    organizationId: data.organization_id,
    accountId: data.account_id,
    adsToken,
    appSecret: tryDecrypt(data.app_secret_encrypted, 'the app secret'),
    capiToken: tryDecrypt(data.capi_token_encrypted, 'the Conversions API token'),
    config: (data.config ?? {}) as MetaConfig,
    lastSyncedAt: data.last_synced_at,
  };
}

/**
 * Resolves a credential from a webhook verify token alone.
 *
 * Meta's verification request is unauthenticated and carries no organization,
 * page or app identifier — only hub.verify_token — so the token's own value is
 * the only thing available to look up. Matching the indexed hash keeps that a
 * single equality scan; the alternative is decrypting every organization's
 * token on each attempt.
 *
 * Uses the service-role client because no session exists, and selects only the
 * organization id so a bug here cannot leak a secret.
 */
export async function findOrganizationByVerifyToken(
  token: string,
): Promise<string | null> {
  if (token === '') return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('ad_credentials')
    .select('organization_id')
    .eq('webhook_verify_token_hash', verifyTokenHash(token))
    .maybeSingle();

  if (error || !data) return null;
  return data.organization_id;
}

/**
 * Resolves the Meta credential for an inbound webhook delivery.
 *
 * The POST body's page_id is the only identifier it carries, so that is what
 * the credential is found by.
 */
export async function findCredentialByPageId(
  pageId: string,
): Promise<MetaCredential | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('ad_credentials')
    .select('organization_id')
    .eq('platform', 'meta')
    .eq('config->>page_id', pageId)
    .maybeSingle();

  if (error || !data) return null;
  return loadMetaCredential(supabase, data.organization_id);
}

/**
 * Records the outcome of a sync or an import on the credential row.
 *
 * last_error is what makes a silent failure visible: with webhook-only
 * delivery and no reconciliation job, an error that is never surfaced is an
 * error nobody will discover until a client asks where their lead went.
 */
export async function recordSyncResult(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  result: { ok: true } | { ok: false; error: string },
): Promise<void> {
  const patch = result.ok
    ? { last_synced_at: new Date().toISOString(), last_error: null }
    : { last_error: result.error.slice(0, 500) };

  const { error } = await supabase
    .from('ad_credentials')
    .update(patch)
    .eq('organization_id', organizationId)
    .eq('platform', 'meta');

  if (error) console.error('[meta] Could not record the sync result:', error);
}
