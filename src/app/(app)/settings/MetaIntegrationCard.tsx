'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { CopyField } from '@/components/ui/CopyField';
import { formatDateTime } from '@/lib/utils';
import {
  backfillMetaLeads,
  regenerateMetaWebhookToken,
  saveMetaIntegration,
  syncMetaInsights,
  testMetaConnection,
  type MetaCredentialSummary,
  type MetaSyncWindow,
  type MetaTestResult,
} from './integrations/meta-actions';
import type { ActionState } from './integrations/actions';

/**
 * Meta integration settings.
 *
 * Its own card rather than another entry in the generic platform list, because
 * Meta needs things no generic field list expresses: a token the CRM generates
 * for the user to copy out, a derived callback URL, and separate sync and
 * backfill actions. The sections are ordered to match the order the work has to
 * be done in Meta's own UI.
 *
 * No stored secret reaches this component — only four-character hints and
 * booleans. The verify token is the exception, and it is not a bearer
 * credential: it only lets Meta's verification request succeed, and the user
 * cannot paste it into Meta without seeing it.
 */

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      Save Meta settings
    </Button>
  );
}

function SectionHeading({ step, title, note }: { step: number; title: string; note?: string }) {
  return (
    <div className="flex flex-col gap-0.5 mt-5 pt-4 border-t border-[var(--border-subtle)] first:mt-0 first:pt-0 first:border-0">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
        <span className="text-[var(--text-muted)] font-normal">{step}.</span> {title}
      </h3>
      {note ? <p className="text-xs text-[var(--text-muted)]">{note}</p> : null}
    </div>
  );
}

export function MetaIntegrationCard({
  credential,
  webhookUrl,
  encryptionReady,
}: {
  credential: MetaCredentialSummary | null;
  webhookUrl: string;
  encryptionReady: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveMetaIntegration, {});
  const [isPending, startTransition] = useTransition();
  const [testResult, setTestResult] = useState<MetaTestResult | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [window_, setWindow] = useState<MetaSyncWindow>(7);

  const connected = Boolean(credential);
  const verifyToken = freshToken ?? credential?.webhookVerifyToken ?? null;

  function run(work: () => Promise<string>) {
    setActionResult(null);
    setTestResult(null);
    startTransition(async () => {
      setActionResult(await work());
    });
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Meta (Facebook &amp; Instagram)</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {connected
              ? `Ad account ${credential?.accountId}`
              : 'Lead Ads, ad spend reporting, and lead-quality feedback.'}
          </p>
        </div>
        <Badge tone={connected ? 'success' : 'neutral'}>
          {connected ? 'Connected' : 'Not connected'}
        </Badge>
      </div>

      {connected && (
        <p className="text-xs text-[var(--text-muted)] mt-2">
          {credential?.lastSyncedAt
            ? `Spend last synced ${formatDateTime(credential.lastSyncedAt)}`
            : 'Spend has not been synced yet.'}
        </p>
      )}

      {credential?.lastError && (
        <p role="alert" className="text-xs text-[var(--danger)] mt-2">
          {credential.lastError}
        </p>
      )}

      {!encryptionReady && (
        <div
          role="alert"
          className="mt-3 rounded-lg bg-[var(--warning-bg)] text-[var(--warning)] px-3 py-2 text-xs"
        >
          <strong>CREDENTIALS_ENCRYPTION_KEY is not set on the server.</strong> Tokens are
          encrypted before they are stored, so saving is disabled until that key exists.
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      <form action={formAction} className="flex flex-col gap-3">
        <SectionHeading
          step={1}
          title="Ad account"
          note="Needed for spend reporting and for fetching leads."
        />

        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            label="Ad Account ID"
            name="account_id"
            required
            placeholder="act_1234567890"
            defaultValue={credential?.accountId ?? ''}
            hint="Ads Manager → Account Overview."
          />
          <Input
            label="Ads access token"
            name="access_token"
            type="password"
            autoComplete="off"
            placeholder={
              credential?.hasAdsToken
                ? `Stored (${credential.adsTokenHint}) — leave blank to keep`
                : 'System User token'
            }
            hint="Business Settings → System Users → Generate token."
          />
          <Input
            label="Page ID"
            name="page_id"
            placeholder="1234567890"
            defaultValue={credential?.pageId ?? ''}
            hint="The Page whose lead forms you want. Identifies incoming leads."
          />
          <Input
            label="App ID"
            name="app_id"
            placeholder="1234567890"
            defaultValue={credential?.appId ?? ''}
            hint="App Dashboard → Settings → Basic."
          />
        </div>

        <SectionHeading
          step={2}
          title="Lead delivery"
          note="Meta posts each new lead to this URL. Paste both values into App Dashboard → Webhooks → Page → leadgen."
        />

        <CopyField
          label="Callback URL"
          value={webhookUrl}
          hint="Must be reachable over HTTPS — Meta will not verify a localhost URL."
        />

        {verifyToken ? (
          <CopyField
            label="Verify token"
            value={verifyToken}
            hint="Paste this into Meta's webhook setup, then click Verify and Save there."
          />
        ) : (
          <p className="text-xs text-[var(--text-muted)]">
            No verify token yet. Save the ad account details, then generate one.
          </p>
        )}

        <Input
          label="App Secret"
          name="app_secret"
          type="password"
          autoComplete="off"
          placeholder={
            credential?.hasAppSecret ? 'Stored — leave blank to keep' : 'App Dashboard → Settings → Basic'
          }
          hint="Used to verify that a lead really came from Meta. Leads are rejected without it."
        />

        <SectionHeading
          step={3}
          title="Lead-quality feedback"
          note="Sends Meta a signal when a lead is won or lost, so it targets people like your good leads. Needs no App Review."
        />

        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            label="Pixel / Dataset ID"
            name="pixel_id"
            placeholder="1234567890"
            defaultValue={credential?.pixelId ?? ''}
            hint="Events Manager → Data Sources."
          />
          <Input
            label="Conversions API token"
            name="capi_token"
            type="password"
            autoComplete="off"
            placeholder={
              credential?.hasCapiToken
                ? `Stored (${credential.capiTokenHint}) — leave blank to keep`
                : 'Events Manager → Settings → Generate access token'
            }
            hint="A different token from the ads one above."
          />
        </div>

        <div className="flex items-center gap-2 mt-2">
          <SaveButton />
          {state.error && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {state.error}
            </p>
          )}
          {state.success && (
            <p role="status" className="text-xs text-[var(--success)]">
              {state.success}
            </p>
          )}
        </div>
      </form>

      {/* ---------------------------------------------------------------- */}
      {connected && (
        <>
          <SectionHeading step={4} title="Actions" />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={isPending}
              onClick={() => {
                setActionResult(null);
                startTransition(async () => {
                  setTestResult(await testMetaConnection());
                });
              }}
            >
              Test connection
            </Button>

            <div className="flex items-center gap-1.5">
              <select
                value={window_}
                onChange={(event) => setWindow(Number(event.target.value) as MetaSyncWindow)}
                aria-label="Days of history"
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
              >
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={isPending}
                onClick={() =>
                  run(async () => (await syncMetaInsights(window_)).message)
                }
              >
                Sync spend
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={isPending}
                onClick={() => run(async () => (await backfillMetaLeads(window_)).message)}
              >
                Backfill leads
              </Button>
            </div>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={isPending}
              onClick={() => {
                // Regenerating breaks delivery until the webhook is verified
                // again in Meta, which is not obvious from the button alone.
                if (
                  !globalThis.confirm(
                    'Generate a new verify token?\n\nMeta will stop delivering leads until you paste the new token into its webhook settings and verify again.',
                  )
                ) {
                  return;
                }
                run(async () => {
                  const result = await regenerateMetaWebhookToken();
                  if (result.ok && result.token) {
                    setFreshToken(result.token);
                    return 'New verify token generated. Copy it into Meta and verify again.';
                  }
                  return result.error ?? 'Could not generate a token.';
                });
              }}
            >
              {verifyToken ? 'Regenerate token' : 'Generate verify token'}
            </Button>
          </div>

          <p className="text-xs text-[var(--text-muted)] mt-2">
            Leads arrive on their own once the webhook is verified. <strong>Backfill leads</strong>{' '}
            re-checks Meta for anything a delivery missed — worth running if a lead you expected
            never appeared, since Meta deletes lead data after 90 days.
          </p>

          {actionResult && (
            <p role="status" className="text-xs text-[var(--text-secondary)] mt-2">
              {actionResult}
            </p>
          )}

          {testResult && (
            <div className="mt-3 flex flex-col gap-1.5">
              {testResult.checks.map((check) => (
                <p key={check.label} className="text-xs">
                  <span className={check.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
                    {check.ok ? '✓' : '✕'} {check.label}
                  </span>
                  <span className="text-[var(--text-muted)]"> — {check.detail}</span>
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
