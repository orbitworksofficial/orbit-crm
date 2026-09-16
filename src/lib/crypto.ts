import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * Encryption for credentials stored in the database.
 *
 * Ad-platform tokens are written to `ad_credentials`, which means anyone who
 * reaches the database reads them — a backup, an export, the service-role key,
 * or a compromise. Encrypting here rather than in Postgres keeps the key
 * outside the database entirely, so a leaked dump is useless on its own.
 *
 * AES-256-GCM: authenticated, so tampering is detected rather than silently
 * decrypting to garbage. Each value gets a fresh random IV, so encrypting the
 * same token twice produces different ciphertext and an observer cannot tell
 * that two organizations configured the same account.
 *
 * Stored format: `v1.<iv>.<authTag>.<ciphertext>`, all base64url. The version
 * prefix means the scheme can change later without a migration guessing game.
 */

const VERSION = 'v1';

/**
 * Derives the 32-byte key from the configured secret.
 *
 * SHA-256 of the passphrase rather than using it raw, so the secret can be any
 * length — a Vercel env var pasted by hand is not guaranteed to be exactly 32
 * bytes. This is not password hashing: the input is already high-entropy, so a
 * slow KDF would buy nothing.
 */
function getKey(): Buffer {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY;

  if (!secret || secret.length < 32) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY is missing or too short. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"\n' +
        'and set it in your environment. Without it, integration credentials cannot be stored.',
    );
  }

  return createHash('sha256').update(secret).digest();
}

/** True when encryption is configured, so the UI can explain rather than throw. */
export function isEncryptionConfigured(): boolean {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY;
  return Boolean(secret && secret.length >= 32);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12); // 96 bits, the standard nonce size for GCM
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Reverses `encryptSecret`.
 *
 * Throws on a malformed or tampered value rather than returning something
 * plausible — a corrupted token should fail loudly at the point of use, not
 * silently produce a confusing API error later.
 */
export function decryptSecret(stored: string): string {
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Stored credential is malformed or uses an unknown format.');
  }

  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Last four characters of a secret, for display.
 *
 * Enough to confirm which token is configured without revealing it. Stored
 * alongside the ciphertext so listing credentials never needs to decrypt.
 */
export function secretHint(plaintext: string): string {
  return plaintext.length <= 4 ? '••••' : `••••${plaintext.slice(-4)}`;
}
