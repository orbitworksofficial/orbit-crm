import { slugify } from '@/lib/utils';

/**
 * Shapes and shared derivations for the Meta integration.
 *
 * No 'server-only' here: the Settings UI needs MetaConfig to render the fields
 * it collects, so this module has to be importable from a client component.
 * Anything that touches a token or the network lives in client.ts instead.
 */

/**
 * Pinned rather than floating. Meta's Graph API makes breaking changes between
 * versions and deprecates old ones on a schedule, so an unpinned call would
 * change behaviour underneath us without a deploy. Bumping this is a deliberate
 * act with a changelog to read first.
 */
export const META_API_VERSION = 'v23.0';

export const META_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

/** The non-secret identifiers stored in ad_credentials.config. */
export interface MetaConfig {
  /** Dataset/Pixel id — the Conversions API posts events to it. */
  pixel_id?: string;
  /** The Facebook Page whose lead forms we receive. Identifies the credential
   *  on inbound webhooks, which carry no other usable key. */
  page_id?: string;
  app_id?: string;
}

/**
 * The webhook POST body.
 *
 * Carries no lead data at all — only pointers. Fetching the answers needs a
 * second Graph call with the ads token, which is why a webhook alone is not
 * enough to import a lead.
 */
export interface LeadgenWebhookBody {
  object: string;
  entry: {
    id: string;
    time: number;
    changes: {
      field: string;
      value: {
        leadgen_id: string;
        page_id: string;
        form_id: string;
        ad_id?: string;
        adgroup_id?: string;
        created_time: number;
      };
    }[];
  }[];
}

/** Response from GET /{leadgen_id}. */
export interface MetaLead {
  id: string;
  created_time: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  /**
   * The dynamic part. `name` is whatever the advertiser typed into the form
   * builder, so it cannot be mapped to columns at compile time.
   */
  field_data: { name: string; values: string[] }[];
}

/** A lead after mapping onto CRM columns. */
export interface NormalizedLead {
  fullName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  city: string | null;
  country: string | null;
  /** Answers with no column of their own, keyed by the advertiser's own label. */
  customFields: Record<string, string>;
  /** The answers rendered as readable text, for the opening note. */
  message: string | null;
}

export interface MetaInsightsRow {
  date: string;
  campaignId: string;
  campaignName: string;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
}

/**
 * The join key between a contact and the spend that produced it.
 *
 * Lead Ads never produce a click-through, so a Meta lead has no UTM parameters
 * of its own — the webhook derives utm_campaign from the campaign name, and the
 * insights sync derives ad_spend.utm_campaign from the same name. The join only
 * works because both sides pass through this one function, so it must stay the
 * single implementation.
 *
 * It is a weak key: renaming a campaign in Meta splits its history in two.
 * contacts.meta_ad_id -> ad_spend.ad_id is the stable alternative and both
 * columns exist; this is the first pass, not the last word.
 */
export function campaignKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = slugify(name);
  return key === '' ? null : key;
}
