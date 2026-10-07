import 'server-only';
import {
  META_GRAPH_BASE,
  type MetaInsightsRow,
  type MetaLead,
} from './types';

/**
 * Thin typed wrapper over the Meta Graph API.
 *
 * Deliberately not a generated SDK: three endpoints are needed, and Meta's
 * official SDK is large, loosely typed, and pins its own Graph version. This
 * keeps the version pin and the error handling where they can be read.
 */

/** Pagination ceiling. A wide date range at ad grain can page indefinitely;
 *  stopping is better than a request that never returns. */
const MAX_PAGES = 20;

/** Graph calls are fast when healthy and hang when not. */
const REQUEST_TIMEOUT_MS = 20_000;

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    readonly subcode: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }

  /**
   * True when the token is expired, revoked, or had its permissions removed.
   *
   * Worth distinguishing because the remedy is different: the user has to
   * reconnect, and telling them "reconnect Meta" is far more useful than
   * showing them Meta's own wording.
   */
  get isAuthError(): boolean {
    return this.status === 401 || this.code === 190 || this.code === 102;
  }

  /** True when a required permission has not been granted — the expected state
   *  until App Review completes. */
  get isPermissionError(): boolean {
    return this.code === 200 || this.code === 3 || this.status === 403;
  }
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
}

async function graph<T>(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<T> {
  const url = new URL(`${META_GRAPH_BASE}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await fetch(url, {
      // The token goes in the header rather than the query string so it cannot
      // end up in an access log or an error report.
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'unknown error';
    throw new MetaApiError(0, null, null, `Could not reach Meta: ${reason}`);
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    // Meta occasionally returns an HTML error page; the status still tells us
    // what happened, so fall through with a null body.
  }

  if (!response.ok) {
    const err = (body as GraphErrorBody | null)?.error;
    throw new MetaApiError(
      response.status,
      err?.code ?? null,
      err?.error_subcode ?? null,
      err?.message ?? `Meta returned ${response.status}.`,
    );
  }

  return body as T;
}

/** GET /{leadgen_id} — the second call the webhook has to make, since the
 *  delivery itself carries no answers. */
export async function fetchLead(leadgenId: string, token: string): Promise<MetaLead> {
  return graph<MetaLead>(
    leadgenId,
    {
      fields:
        'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data',
    },
    token,
  );
}

/** GET /{form_id}/leads — used by the backfill to recover leads a webhook
 *  delivery dropped. */
export async function fetchFormLeads(
  formId: string,
  token: string,
  sinceUnix: number,
): Promise<MetaLead[]> {
  const collected: MetaLead[] = [];
  let next: string | null = null;
  let page = 0;

  do {
    const result: { data?: MetaLead[]; paging?: { next?: string } } = next
      ? await fetchAbsolute(next, token)
      : await graph(
          `${formId}/leads`,
          {
            fields:
              'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data',
            filtering: JSON.stringify([
              { field: 'time_created', operator: 'GREATER_THAN', value: sinceUnix },
            ]),
            limit: '100',
          },
          token,
        );

    collected.push(...(result.data ?? []));
    next = result.paging?.next ?? null;
    page += 1;
  } while (next && page < MAX_PAGES);

  return collected;
}

/** Follows a paging.next URL, which already carries its own query string. */
async function fetchAbsolute<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  const body = (await response.json()) as T & GraphErrorBody;
  if (!response.ok) {
    throw new MetaApiError(
      response.status,
      body.error?.code ?? null,
      body.error?.error_subcode ?? null,
      body.error?.message ?? `Meta returned ${response.status}.`,
    );
  }
  return body;
}

interface RawInsightsRow {
  date_start: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
}

/**
 * GET /act_{id}/insights at ad grain, one row per day.
 *
 * time_increment=1 is what makes the rows daily; without it Meta returns a
 * single aggregate for the whole range, which cannot be stored per-day or
 * re-synced without double counting.
 */
export async function fetchInsights(
  accountId: string,
  token: string,
  range: { since: string; until: string },
): Promise<MetaInsightsRow[]> {
  const account = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const collected: MetaInsightsRow[] = [];
  let next: string | null = null;
  let page = 0;

  do {
    const result: { data?: RawInsightsRow[]; paging?: { next?: string } } = next
      ? await fetchAbsolute(next, token)
      : await graph(
          `${account}/insights`,
          {
            level: 'ad',
            time_increment: '1',
            time_range: JSON.stringify(range),
            fields:
              'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,actions',
            limit: '200',
          },
          token,
        );

    for (const row of result.data ?? []) {
      collected.push({
        date: row.date_start,
        campaignId: row.campaign_id ?? '',
        campaignName: row.campaign_name ?? '',
        adsetId: row.adset_id ?? null,
        adsetName: row.adset_name ?? null,
        adId: row.ad_id ?? null,
        adName: row.ad_name ?? null,
        spend: Number(row.spend ?? 0),
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        // Leads are not a top-level field: they arrive inside `actions`, where
        // the action_type depends on how the campaign was set up. Both forms
        // mean a lead.
        leads: sumActions(row.actions, ['lead', 'onsite_conversion.lead_grouped']),
      });
    }

    next = result.paging?.next ?? null;
    page += 1;
  } while (next && page < MAX_PAGES);

  return collected;
}

function sumActions(
  actions: { action_type: string; value: string }[] | undefined,
  types: string[],
): number {
  if (!actions) return 0;
  return actions
    .filter((a) => types.includes(a.action_type))
    .reduce((total, a) => total + Number(a.value ?? 0), 0);
}

export interface ConversionEventInput {
  pixelId: string;
  capiToken: string;
  eventName: string;
  /** Unix seconds. Must be Meta's lead creation time, not now. */
  eventTime: number;
  /** Meta keeps only the first copy per (event_id, event_name), so this makes
   *  a retry safe. */
  eventId: string;
  /** Meta's 15-17 digit lead id. The whole basis of the attribution. */
  leadId: string;
  /** From Events Manager > Test Events. Routes the event to the test view
   *  instead of production. */
  testEventCode?: string;
}

/**
 * POST /{pixel_id}/events — lead-quality feedback.
 *
 * Sends a quality signal only, never a monetary value: a deal usually closes
 * after the lead's status changes, and Meta discards a duplicate event_id, so
 * there is no path to correct a figure sent early.
 */
export async function sendConversionEvent(
  input: ConversionEventInput,
): Promise<{ httpStatus: number; body: unknown }> {
  const url = new URL(`${META_GRAPH_BASE}/${input.pixelId}/events`);

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: input.eventName,
        event_time: input.eventTime,
        event_id: input.eventId,
        // 'system_generated' is the correct source for a CRM-originated event:
        // no browser and no person was involved at the moment it fired.
        action_source: 'system_generated',
        // Identifies which ad to credit. Not hashed — unlike email or phone,
        // the lead id is Meta's own identifier.
        user_data: { lead_id: input.leadId },
      },
    ],
  };
  if (input.testEventCode) payload.test_event_code = input.testEventCode;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.capiToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'unknown error';
    throw new MetaApiError(0, null, null, `Could not reach Meta: ${reason}`);
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }

  return { httpStatus: response.status, body };
}

/** GET /act_{id}?fields=name — the cheapest call that proves the ads token
 *  works and names the account it reaches. */
export async function fetchAdAccountName(
  accountId: string,
  token: string,
): Promise<string> {
  const account = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const result = await graph<{ name?: string }>(account, { fields: 'name' }, token);
  return result.name ?? account;
}

/** GET /{pixel_id}?fields=name — proves the Conversions API token works. */
export async function fetchPixelName(pixelId: string, token: string): Promise<string> {
  const result = await graph<{ name?: string }>(pixelId, { fields: 'name' }, token);
  return result.name ?? pixelId;
}
