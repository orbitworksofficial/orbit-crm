'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatDateTime, cn } from '@/lib/utils';
import {
  connectPlatform,
  disconnectPlatform,
  testConnection,
  type ActionState,
  type CredentialSummary,
} from './integrations/actions';
import type { AdPlatform } from '@/lib/supabase/database.types';

/**
 * Ad platform connections (Settings).
 *
 * Credentials live here rather than in environment variables because tokens
 * expire and need rotating, and because Phase 2 multi-tenancy means each
 * customer connects their own ad accounts — which one value per deployment
 * cannot express.
 *
 * No token ever reaches this component: the server returns only a four-
 * character hint, so there is nothing sensitive in the page source or in any
 * React payload.
 */

interface PlatformSpec {
  platform: AdPlatform;
  name: string;
  accountLabel: string;
  accountPlaceholder: string;
  tokenLabel: string;
  needsRefreshToken: boolean;
  /** Where to obtain the credential, so nobody has to go hunting. */
  help: string;
  helpUrl: string;
}

const PLATFORMS: PlatformSpec[] = [
  {
    platform: 'meta',
    name: 'Meta Ads',
    accountLabel: 'Ad Account ID',
    accountPlaceholder: 'act_1234567890',
    tokenLabel: 'System User access token',
    needsRefreshToken: false,
    help: 'Business Settings → System Users → Generate token, with the ads_read permission.',
    helpUrl: 'https://business.facebook.com/settings/system-users',
  },
  {
    platform: 'google',
    name: 'Google Ads',
    accountLabel: 'Customer ID',
    accountPlaceholder: '123-456-7890',
    tokenLabel: 'OAuth access token',
    needsRefreshToken: true,
    help: 'Google Cloud Console → OAuth credentials, plus a developer token from the Ads API Center.',
    helpUrl: 'https://developers.google.com/google-ads/api/docs/first-call/dev-token',
  },
  {
    platform: 'linkedin',
    name: 'LinkedIn Ads',
    accountLabel: 'Ad Account ID',
    accountPlaceholder: '512345678',
    tokenLabel: 'OAuth access token',
    needsRefreshToken: true,
    help: 'LinkedIn Developers → your app → Marketing Developer Platform access.',
    helpUrl: 'https://www.linkedin.com/developers/apps',
  },
];

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {label}
    </Button>
  );
}

function PlatformCard({
  spec,
  credential,
  encryptionReady,
}: {
  spec: PlatformSpec;
  credential: CredentialSummary | undefined;
  encryptionReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previousState, formData) => {
      const result = await connectPlatform(previousState, formData);
      if (!result.error) setOpen(false);
      return result;
    },
    {},
  );

  const connected = Boolean(credential);

  return (
    <div className="border border-[var(--border-subtle)] rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{spec.name}</h3>
            {connected ? (
              <Badge tone="success">Connected</Badge>
            ) : (
              <Badge tone="neutral">Not connected</Badge>
            )}
          </div>

          {credential ? (
            <div className="text-xs text-[var(--text-muted)] mt-1 flex flex-col gap-0.5">
              <span>
                Account {credential.accountId} · token {credential.tokenHint}
              </span>
              <span>
                {credential.lastSyncedAt
                  ? `Last synced ${formatDateTime(credential.lastSyncedAt)}`
                  : 'Not yet synced'}
              </span>
              {credential.lastError && (
                <span className="text-[var(--danger)]">{credential.lastError}</span>
              )}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)] mt-1">{spec.help}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {connected && (
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  setTestResult(await testConnection(spec.platform));
                })
              }
            >
              Test
            </Button>
          )}
          <Button
            size="sm"
            variant={connected ? 'ghost' : 'secondary'}
            onClick={() => setOpen((v) => !v)}
            disabled={!encryptionReady}
          >
            {open ? 'Cancel' : connected ? 'Replace' : 'Connect'}
          </Button>
          {connected && (
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => {
                if (!window.confirm(`Disconnect ${spec.name}?`)) return;
                startTransition(async () => {
                  await disconnectPlatform(spec.platform);
                  setTestResult(null);
                });
              }}
            >
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {testResult && (
        <p
          role="status"
          className={cn(
            'text-xs mt-2',
            testResult.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]',
          )}
        >
          {testResult.message}
        </p>
      )}

      {open && (
        <form action={formAction} className="flex flex-col gap-3 mt-4 pt-4 border-t border-[var(--border-subtle)]">
          <input type="hidden" name="platform" value={spec.platform} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={spec.accountLabel}
              name="account_id"
              placeholder={spec.accountPlaceholder}
              defaultValue={credential?.accountId ?? ''}
              required
            />
            <Input
              label={spec.tokenLabel}
              name="access_token"
              type="password"
              autoComplete="off"
              placeholder="Paste the token"
              required
            />
          </div>

          {spec.needsRefreshToken && (
            <Input
              label="Refresh token"
              name="refresh_token"
              type="password"
              autoComplete="off"
              hint="Used to renew the access token automatically when it expires."
            />
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <SubmitButton label={connected ? 'Replace credentials' : 'Connect'} />
            <a
              href={spec.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--primary)] hover:underline"
            >
              Where do I find this?
            </a>
          </div>

          {state.error && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {state.error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

export function IntegrationsSection({
  credentials,
  encryptionReady,
}: {
  credentials: CredentialSummary[];
  encryptionReady: boolean;
}) {
  const byPlatform = new Map(credentials.map((c) => [c.platform, c]));

  return (
    <Card>
      <CardHeader
        title="Ad platform integrations"
        description="Connect ad accounts to pull spend into the CRM."
      />

      {!encryptionReady && (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-[var(--warning-bg)] text-[var(--warning)] px-3 py-2 text-xs"
        >
          <strong>CREDENTIALS_ENCRYPTION_KEY is not set on the server.</strong> Credentials
          are encrypted before they are stored, so connecting is disabled until that key
          exists. Add it to your environment variables and redeploy.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {PLATFORMS.map((spec) => (
          <PlatformCard
            key={spec.platform}
            spec={spec}
            credential={byPlatform.get(spec.platform)}
            encryptionReady={encryptionReady}
          />
        ))}
      </div>

      <p className="text-xs text-[var(--text-muted)] mt-4 pt-3 border-t border-[var(--border-subtle)]">
        Tokens are encrypted before they reach the database, with a key held in the server
        environment — a leaked database backup cannot be used to spend your ad budget. Once
        a platform is connected, daily spend syncs into the campaign performance panel on the
        dashboard.
      </p>
    </Card>
  );
}
