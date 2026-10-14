'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { CopyField } from '@/components/ui/CopyField';
import {
  disconnectEngine,
  saveEngineSettings,
  testEngineConnection,
  type EngineSummary,
  type EngineTestResult,
} from './integrations/email-engine-actions';
import type { ActionState } from './integrations/actions';

/**
 * Email Engine connection (Settings).
 *
 * The Engine sends the automated outreach that turns a new lead into a booked
 * call. Which lead sources it applies to is set per source in the lead sources
 * section, not here — this card is only the connection.
 */

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      Save
    </Button>
  );
}

export function EmailEngineCard({
  engine,
  callbackUrl,
  outreachSources,
  encryptionReady,
}: {
  engine: EngineSummary | null;
  callbackUrl: string;
  /** Sources currently set to trigger outreach, so the effect is visible here
   *  rather than only in another section. */
  outreachSources: string[];
  encryptionReady: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveEngineSettings, {});
  const [isPending, startTransition] = useTransition();
  const [test, setTest] = useState<EngineTestResult | null>(null);

  const connected = Boolean(engine);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Email Engine</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Sends automated outreach to new leads and reports back when they book or
            unsubscribe.
          </p>
        </div>
        <Badge tone={connected ? 'success' : 'neutral'}>
          {connected ? 'Connected' : 'Not connected'}
        </Badge>
      </div>

      {engine?.lastError && (
        <p role="alert" className="text-xs text-[var(--danger)] mt-2">
          {engine.lastError}
        </p>
      )}

      {!encryptionReady && (
        <div
          role="alert"
          className="mt-3 rounded-lg bg-[var(--warning-bg)] text-[var(--warning)] px-3 py-2 text-xs"
        >
          <strong>CREDENTIALS_ENCRYPTION_KEY is not set on the server.</strong> The shared
          secret is encrypted before it is stored, so saving is disabled until that key
          exists.
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-3 mt-4">
        <Input
          label="Email Engine URL"
          name="base_url"
          required
          placeholder="https://api.orb-itworks.com"
          defaultValue={engine?.baseUrl ?? ''}
          hint="The base URL only — the CRM appends the webhook path itself."
        />
        <Input
          label="Shared secret"
          name="secret"
          type="password"
          autoComplete="off"
          placeholder={
            engine ? `Stored (${engine.secretHint}) — leave blank to keep` : 'CRM_WEBHOOK_SECRET'
          }
          hint="Must match CRM_WEBHOOK_SECRET in the Engine's environment. Used in both directions."
        />

        <div className="flex items-center gap-2">
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

      {connected && (
        <div className="mt-5 pt-4 border-t border-[var(--border-subtle)] flex flex-col gap-3">
          <CopyField
            label="Callback URL"
            value={callbackUrl}
            hint="Set this as CRM_CALLBACK_URL in the Engine, so it can report back."
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={isPending}
              onClick={() =>
                startTransition(async () => {
                  setTest(await testEngineConnection());
                })
              }
            >
              Test connection
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={isPending}
              onClick={() => {
                if (
                  !globalThis.confirm(
                    'Disconnect the Email Engine?\n\nNew leads will stop receiving automated outreach.',
                  )
                ) {
                  return;
                }
                startTransition(async () => {
                  await disconnectEngine();
                  setTest(null);
                });
              }}
            >
              Disconnect
            </Button>
          </div>

          {test && (
            <div className="flex flex-col gap-1.5">
              {test.checks.map((check) => (
                <p key={check.label} className="text-xs">
                  <span className={check.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
                    {check.ok ? '✓' : '✕'} {check.label}
                  </span>
                  <span className="text-[var(--text-muted)]"> — {check.detail}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)] mt-4 pt-3 border-t border-[var(--border-subtle)]">
        {outreachSources.length > 0 ? (
          <>
            Leads from <strong>{outreachSources.join(', ')}</strong> are sent for outreach.
            Change which sources qualify in the lead sources section above.
          </>
        ) : (
          <>
            No lead source is set to trigger outreach, so nothing will be sent. Enable it per
            source in the lead sources section above.
          </>
        )}
      </p>
    </Card>
  );
}
