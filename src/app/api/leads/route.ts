import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';

/**
 * Public lead intake (brief §02 "Auto-create from web", technical spec
 * "Form integration").
 *
 * This is the only unauthenticated write path in the application, so it is
 * defended in depth:
 *
 *   1. Shared secret — the website must send `x-orbit-lead-secret`. Compared in
 *      constant time so the value cannot be recovered by timing.
 *   2. Fails closed — if LEAD_INTAKE_SECRET is unset, every request is rejected
 *      rather than the route silently becoming an open endpoint.
 *   3. Rate limiting — per-IP token bucket to blunt spam floods.
 *   4. Strict validation — unknown fields are dropped, not persisted.
 *   5. Uses the service-role client, since there is no session; the
 *      organization is resolved server-side and never taken from the payload.
 *
 * Excluded from `middleware.ts` matching, so no session redirect applies.
 */

// Node runtime: timingSafeEqual is a Node built-in, unavailable on Edge.
export const runtime = 'nodejs';

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */
/**
 * In-memory fixed-window counter.
 *
 * Adequate for Phase 1: a single Vercel region with modest traffic. It resets
 * on cold start and is per-instance, so it is a spam dampener rather than a
 * strict guarantee. If abuse becomes a real problem, move this to Postgres or
 * Upstash without changing the route's shape.
 */
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });

    // Opportunistically evict expired buckets so the map cannot grow unbounded
    // across a long-lived instance.
    if (rateLimitBuckets.size > 5000) {
      for (const [bucketKey, value] of rateLimitBuckets) {
        if (now > value.resetAt) rateLimitBuckets.delete(bucketKey);
      }
    }
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

/** Constant-time string comparison that tolerates differing lengths. */
function secretMatches(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/* -------------------------------------------------------------------------- */
/* Payload                                                                    */
/* -------------------------------------------------------------------------- */

const optionalString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const leadSchema = z.object({
  full_name: z.string().trim().min(1, 'full_name is required').max(200),
  email: z.string().trim().email('A valid email is required').max(320).optional(),
  whatsapp_number: optionalString(50),
  company_name: optionalString(200),
  industry: optionalString(120),
  city: optionalString(120),
  country: optionalString(120),

  /** Lead source slug, e.g. "website_form". Falls back to website_form. */
  source: optionalString(60),

  /** Free-text message from the form; stored as the first note. */
  message: optionalString(5000),

  /** Service slugs the lead expressed interest in. */
  services: z.array(z.string().trim().max(80)).max(20).optional(),

  // Phase 2 attribution — captured now so the data exists when ad integration
  // arrives.
  utm_source: optionalString(120),
  utm_medium: optionalString(120),
  utm_campaign: optionalString(200),
  external_ref: optionalString(200),
});

export async function POST(request: NextRequest) {
  // --- 1. Authenticate the caller -------------------------------------------
  if (!env.LEAD_INTAKE_SECRET) {
    console.error('[api/leads] LEAD_INTAKE_SECRET is not configured; rejecting request.');
    return NextResponse.json({ error: 'Lead intake is not configured.' }, { status: 503 });
  }

  const providedSecret = request.headers.get('x-orbit-lead-secret') ?? '';
  if (!secretMatches(providedSecret, env.LEAD_INTAKE_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // --- 2. Rate limit --------------------------------------------------------
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  if (isRateLimited(clientIp)) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  // --- 3. Parse and validate ------------------------------------------------
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const parsed = leadSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const { source, message, services, ...contactFields } = parsed.data;

  // --- 4. Write ------------------------------------------------------------
  const supabase = createAdminClient();

  // Phase 1 has a single organization. When multi-tenancy lands, this resolves
  // from the API key presented by the caller instead.
  const { data: organization, error: orgError } = await supabase
    .from('organizations')
    .select('id')
    .order('created_at')
    .limit(1)
    .maybeSingle();

  if (orgError || !organization) {
    console.error('[api/leads] No organization found:', orgError);
    return NextResponse.json({ error: 'CRM is not initialised.' }, { status: 500 });
  }

  const organizationId = organization.id;

  // Resolve the source and default status by slug so renaming a display label
  // in Settings never breaks the website form.
  const [{ data: leadSource }, { data: defaultStatus }] = await Promise.all([
    supabase
      .from('lead_sources')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('slug', source ?? 'website_form')
      .maybeSingle(),
    supabase
      .from('lead_statuses')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('slug', 'new')
      .maybeSingle(),
  ]);

  const { data: contact, error: insertError } = await supabase
    .from('contacts')
    .insert({
      ...contactFields,
      organization_id: organizationId,
      lead_source_id: leadSource?.id ?? null,
      lead_status_id: defaultStatus?.id ?? null,
      // Deliberately unassigned: an admin triages inbound leads. Unassigned
      // contacts are visible to admins only, per the contacts RLS policy.
      assigned_to: null,
    })
    .select('id')
    .single();

  if (insertError || !contact) {
    console.error('[api/leads] Insert failed:', insertError);
    return NextResponse.json({ error: 'Could not record the lead.' }, { status: 500 });
  }

  // Attach the form message as the opening note. author_id is null because no
  // CRM user wrote it; the UI renders that as "Unknown user".
  if (message) {
    await supabase.from('notes').insert({
      contact_id: contact.id,
      organization_id: organizationId,
      body: `Website enquiry:\n\n${message}`,
      author_id: null,
    });
  }

  // Map service slugs to ids, ignoring any the catalogue does not recognise.
  if (services && services.length > 0) {
    const { data: matched } = await supabase
      .from('services')
      .select('id')
      .eq('organization_id', organizationId)
      .in('slug', services);

    if (matched && matched.length > 0) {
      await supabase
        .from('contact_services')
        .insert(matched.map((service) => ({ contact_id: contact.id, service_id: service.id })));
    }
  }

  await supabase.from('activity_log').insert({
    organization_id: organizationId,
    contact_id: contact.id,
    event_type: 'contact.created',
    description: 'Lead captured from the website contact form',
    metadata: { source: source ?? 'website_form' },
    actor_id: null,
  });

  // 201 with the id so the website can correlate its own submission record.
  return NextResponse.json({ success: true, contact_id: contact.id }, { status: 201 });
}

/** Explicit 405 so a mistakenly-GET'd endpoint gives a clear answer. */
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. POST a JSON lead payload to this endpoint.' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
