import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadMetaCredential, recordSyncResult } from './credentials';
import {
  fetchInsights,
  fetchPageAccessToken,
  fetchPageLeadForms,
  fetchFormLeads,
} from './client';
import { ingestMetaLead } from './ingest';
import { campaignKey } from './types';

/**
 * One pass over everything Meta currently holds.
 *
 * Nothing here is configured. Insights are pulled account-wide and lead forms
 * are discovered from the Page, so a campaign or form created this morning is
 * included in the next run without anyone touching Settings — which is the
 * whole point, since campaigns here are started and stopped constantly.
 *
 * Shared by the hourly scheduler and the Settings button, so the two cannot
 * drift apart.
 */

/** Wide enough to be the repair path as well: a webhook delivery that failed
 *  days ago is recovered by a later run rather than lost. */
const DEFAULT_DAYS = 30;

/** Per-form ceiling, so one busy form cannot starve the rest of a run. */
const MAX_FORMS = 25;

export interface SyncResult {
  ok: boolean;
  spendRows: number;
  leadsCreated: number;
  leadsAlreadyHad: number;
  message: string;
}

export async function syncAllMetaData(days = DEFAULT_DAYS): Promise<SyncResult> {
  const supabase = createAdminClient();

  // Written as a loop over organizations so multi-tenancy does not need this
  // rewritten later.
  const { data: orgs } = await supabase
    .from('ad_credentials')
    .select('organization_id')
    .eq('platform', 'meta')
    .eq('is_active', true);

  if (!orgs || orgs.length === 0) {
    return {
      ok: true,
      spendRows: 0,
      leadsCreated: 0,
      leadsAlreadyHad: 0,
      message: 'Meta is not connected.',
    };
  }

  let spendRows = 0;
  let leadsCreated = 0;
  let leadsAlreadyHad = 0;
  const problems: string[] = [];

  for (const { organization_id: organizationId } of orgs) {
    const credential = await loadMetaCredential(supabase, organizationId);
    if (!credential?.adsToken) {
      problems.push('No Meta ads token is set.');
      continue;
    }

    const until = new Date();
    const since = new Date(until.getTime() - days * 86_400_000);
    const asDate = (d: Date) => d.toISOString().slice(0, 10);

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
            // The same derivation the webhook uses for contacts.utm_campaign.
            // The ROAS join works only because both sides pass through it.
            utm_campaign: campaignKey(row.campaignName),
            spend: row.spend,
            impressions: row.impressions,
            clicks: row.clicks,
            platform_leads: row.leads,
            synced_at: new Date().toISOString(),
          })),
          { onConflict: 'organization_id,platform,spend_date,grain_key' },
        );

        if (error) problems.push(`Spend: ${error.message}`);
        else spendRows += rows.length;
      }
    } catch (cause) {
      problems.push(`Spend: ${cause instanceof Error ? cause.message : 'unknown error'}`);
    }

    /* --- Leads, from every form the Page has --- */
    const pageId = credential.config.page_id;
    if (!pageId) {
      problems.push('No Page ID is set, so lead forms cannot be found.');
    } else {
      try {
        const pageToken = await fetchPageAccessToken(pageId, credential.adsToken);
        if (!pageToken) {
          problems.push('The system user does not administer that Page.');
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
                if (outcome.status === 'created') leadsCreated += 1;
                else if (outcome.status === 'duplicate') leadsAlreadyHad += 1;
                else problems.push(`Lead ${lead.id}: ${outcome.error ?? 'failed'}`);
              }
            } catch (cause) {
              const reason = cause instanceof Error ? cause.message : 'unknown error';
              problems.push(`Form ${form.name ?? form.id}: ${reason}`);
            }
          }
        }
      } catch (cause) {
        problems.push(`Leads: ${cause instanceof Error ? cause.message : 'unknown error'}`);
      }
    }

    // Surfaced on the Settings card, so a schedule that quietly stopped working
    // is visible rather than only in a log nobody reads.
    await recordSyncResult(
      supabase,
      organizationId,
      problems.length === 0
        ? { ok: true }
        : { ok: false, error: problems.slice(0, 3).join('; ') },
    );
  }

  const summary = `${spendRows} spend rows, ${leadsCreated} new leads, ${leadsAlreadyHad} already had`;

  return {
    ok: problems.length === 0,
    spendRows,
    leadsCreated,
    leadsAlreadyHad,
    message:
      problems.length === 0 ? summary : `${summary} — ${problems.slice(0, 2).join('; ')}`,
  };
}
