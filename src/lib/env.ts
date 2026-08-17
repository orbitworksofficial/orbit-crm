import { z } from 'zod';

/**
 * Validated environment configuration.
 *
 * Parsed once at module load so a misconfigured deployment fails immediately
 * with a readable message, rather than surfacing as a confusing runtime error
 * deep inside a Supabase call.
 *
 * Note: `process.env.X` must be referenced literally (not via a dynamic key)
 * for Next.js to inline NEXT_PUBLIC_* values into the client bundle.
 */

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
});

const serverSchema = clientSchema.extend({
  /** Bypasses RLS — server-side only. See lib/supabase/admin.ts. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  /**
   * Shared secret the website contact form must present to POST /api/leads.
   * Optional so local development works without it, but the route refuses all
   * requests when it is unset, so production must configure it.
   */
  LEAD_INTAKE_SECRET: z.string().min(16).optional(),

  /** Inactivity timeout in minutes before the user is signed out. */
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(60),
});

const isServer = typeof window === 'undefined';

function parseEnv() {
  const source = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LEAD_INTAKE_SECRET: process.env.LEAD_INTAKE_SECRET,
    SESSION_IDLE_TIMEOUT_MINUTES: process.env.SESSION_IDLE_TIMEOUT_MINUTES,
  };

  const schema = isServer ? serverSchema : clientSchema;
  const result = schema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env.local and fill in the values.`,
    );
  }

  return result.data as z.infer<typeof serverSchema>;
}

export const env = parseEnv();
