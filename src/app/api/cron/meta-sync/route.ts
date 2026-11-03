import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadMetaCredential, recordSyncResult } from '@/lib/meta/credentials';
import {
  fetchInsights,
  fetchPageAccessToken,
  fetchPageLeadForms,
  fetchFormLeads,
} from '@/lib/meta/client';
import { ingestMetaLead } from '@/lib/meta/ingest';
import { campaignKey } from '@/lib/meta/types';

/**
 * Scheduled Meta sync.
 *
 * Everything was manual: spend and leads were separate buttons, and a campaign
 * created after setup appeared in neither until someone remembered to press
 * them. Spend went three weeks stale that way while a new campaign was running.
 *
 * Nothing here is configured. Insights are pulled account-wide and lead forms
 * are discovered from the Page, so a campaign or form created this morning is
 * picked up by tonight's run with no one touching Settings.
 *
 * Runs as a Vercel cron, which calls it with CRON_SECRET as a bearer token.
 * Excluded from the middleware matcher — a cron carries no session.
 */

export const runtime = 'nodejs';

/** A wide window, because this is also the repair path: a webhook delivery
 *  that failed days ago is recovered by the next run rather than lost. */
const SYNC_DAYS = 30;

/** Pagination ceiling per form, so one busy form cannot starve the rest. */
const MAX_FORMS = 25;

function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  // Fail closed. Without a secret this would be an open endpoint that anyone
  // could use to exhaust the Meta API rate limit.
  if (!secret) return false;

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : header;

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const supabase = createAdminClient();

  // Every organization with Meta connected. Written as a loop now so
  // multi-tenancy does not need this rewritten.
  const { data: orgs } = await supabase
    .from('ad_credentials')
    .select('organization_id')
    .eq('platform', 'meta')
    .eq('is_active', true);

  if (!orgs || orgs.length === 0) {
    return NextResponse.json({ ok: true, message: 'No Meta connection to sync.' });
  }

  const report: Record<string, unknown>[] = [];

  for (const { organization_id: organizationId } of orgs) {
    const credential = await loadMetaCredential(supabase, organizationId);
    if (!credential?.adsToken) {
      report.push({ organizationId, skipped: 'no ads token' });
      continue;
    }

    const until = new Date();
    const since = new Date(until.getTime() - SYNC_DAYS * 86_400_000);
    const asDate = (d: Date) => d.toISOString().slice(0, 10);

    let spendRows = 0;
    let created = 0;
    let duplicates = 0;
    const problems: string[] = [];

    /* --- Spend, account-wide so new campaigns need no registering --- */
    try {
      const rows = await fetchInsights(credential.accountId, credential.adsToken, {
        since: asDate(since),
        until: asDate(until),
      });

      if (rows.length > 0) {
        const { error } = await supabase.from('ad_spend').upsert(
          rows.map((row) => ({
            organization_id: organizationId,
            platform: 'meta' as const,
            spend_date: row.date,
            campaign_id: row.campaignId,
            campaign_name: row.campaignName,
            adset_id: row.adsetId,
            adset_name: row.adsetName,
            ad_id: row.adId,
            ad_name: row.adName,
            // Same derivation the webhook uses for contacts.utm_campaign; the
            // ROAS join depends on both sides matching.
            utm_campaign: campaignKey(row.campaignName),
            spend: row.spend,
            impressions: row.impressions,
            clicks: row.clicks,
            platform_leads: row.leads,
            synced_at: new Date().toISOString(),
          })),
          { onConflict: 'organization_id,platform,spend_date,grain_key' },
        );

        if (error) problems.push(`spend: ${error.message}`);
        else spendRows = rows.length;
      }
    } catch (cause) {
      problems.push(`spend: ${cause instanceof Error ? cause.message : 'unknown error'}`);
    }

    /* --- Leads, from every form the Page has --- */
    const pageId = credential.config.page_id;
    if (pageId) {
      try {
        const pageToken = await fetchPageAccessToken(pageId, credential.adsToken);
        if (!pageToken) {
          problems.push('leads: the system user does not administer that Page');
        } else {
          const forms = (await fetchPageLeadForms(pageId, pageToken)).slice(0, MAX_FORMS);
          const sinceUnix = Math.floor(since.getTime() / 1000);

          for (const form of forms) {
            try {
              const leads = await fetchFormLeads(form.id, pageToken, sinceUnix);
              for (const lead of leads) {
                const outcome = await ingestMetaLead(
                  supabase,
                  credential,
                  lead,
                  form.name ?? null,
                );
                if (outcome.status === 'created') created += 1;
                else if (outcome.status === 'duplicate') duplicates += 1;
                else problems.push(`lead ${lead.id}: ${outcome.error ?? 'failed'}`);
              }
            } catch (cause) {
              const reason = cause instanceof Error ? cause.message : 'unknown error';
              problems.push(`form ${form.name ?? form.id}: ${reason}`);
            }
          }
        }
      } catch (cause) {
        problems.push(`leads: ${cause instanceof Error ? cause.message : 'unknown error'}`);
      }
    }

    // Surfaced on the Settings card, so a run that quietly stopped working is
    // visible rather than only in a log nobody reads.
    await recordSyncResult(
      supabase,
      organizationId,
      problems.length === 0
        ? { ok: true }
        : { ok: false, error: `Scheduled sync: ${problems.slice(0, 3).join('; ')}` },
    );

    report.push({ organizationId, spendRows, created, duplicates, problems: problems.length });
  }

  return NextResponse.json({ ok: true, report });
}
