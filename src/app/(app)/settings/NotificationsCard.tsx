'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import {
  addRecipient,
  removeRecipient,
  saveNotificationSettings,
  sendTestNotification,
  toggleRecipient,
  toggleSourceNotify,
  type NotifySummary,
  type RecipientSummary,
} from './integrations/notification-actions';
import type { ActionState } from './integrations/actions';

/**
 * New-lead email alerts (Settings).
 *
 * The live refresh on the contacts page only helps whoever already has it
 * open; this is what reaches someone who is not looking. Which is why the
 * recipient list comes first in the card — the credentials matter less than
 * whether anybody is actually being told.
 */

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {label}
    </Button>
  );
}

export function NotificationsCard({
  settings,
  recipients,
  sources,
  encryptionReady,
}: {
  settings: NotifySummary | null;
  recipients: RecipientSummary[];
  sources: { id: string; name: string; notifyOnLead: boolean }[];
  encryptionReady: boolean;
}) {
  const [connectState, connectAction] = useActionState<ActionState, FormData>(
    saveNotificationSettings,
    {},
  );
  const [addState, addAction] = useActionState<ActionState, FormData>(addRecipient, {});
  const [isPending, startTransition] = useTransition();
  const [testResult, setTestResult] = useState<string | null>(null);

  const connected = Boolean(settings);
  const activeCount = recipients.filter((r) => r.isActive).length;

  return (
    <Card>
      <CardHeader
        title="New lead alerts"
        description="Email the team the moment a lead arrives, so one that lands overnight is not missed."
        action={
          <Badge tone={connected && activeCount > 0 ? 'success' : 'neutral'}>
            {!connected ? 'Not connected' : activeCount === 0 ? 'No recipients' : 'On'}
          </Badge>
        }
      />

      {!encryptionReady && (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-[var(--warning-bg)] text-[var(--warning)] px-3 py-2 text-xs"
        >
          <strong>CREDENTIALS_ENCRYPTION_KEY is not set on the server.</strong> The API key is
          encrypted before it is stored, so saving is disabled until that key exists.
        </div>
      )}

      {/* --- Recipients, first: the credentials matter less than whether
              anyone is actually being told. --- */}
      <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2">Who gets told</h3>

      {recipients.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] mb-3">
          Nobody yet — add an address below.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border-subtle)] mb-3">
          {recipients.map((r) => (
            <li key={r.id} className="py-2 first:pt-0 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p
                  className={cn(
                    'text-sm',
                    !r.isActive && 'text-[var(--text-muted)] line-through',
                  )}
                >
                  {r.email}
                </p>
                {r.label && <p className="text-xs text-[var(--text-muted)]">{r.label}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!r.isActive && <Badge tone="neutral">Paused</Badge>}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      await toggleRecipient(r.id, !r.isActive);
                    })
                  }
                >
                  {r.isActive ? 'Pause' : 'Resume'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    if (!globalThis.confirm(`Remove ${r.email} from lead alerts?`)) return;
                    startTransition(async () => {
                      await removeRecipient(r.id);
                    });
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={addAction} className="flex items-end gap-2 flex-wrap mb-1">
        <Input label="Email address" name="email" required placeholder="you@orb-itworks.com" />
        <Input label="Name (optional)" name="label" placeholder="Sales" />
        <SubmitButton label="Add" />
      </form>
      {addState.error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {addState.error}
        </p>
      )}
      {addState.success && (
        <p role="status" className="text-xs text-[var(--success)]">
          {addState.success}
        </p>
      )}

      {/* --- Per-source control --- */}
      <h3 className="text-xs font-semibold text-[var(--text-secondary)] mt-6 mb-2 pt-4 border-t border-[var(--border-subtle)]">
        Which sources raise an alert
      </h3>
      <div className="flex flex-wrap gap-1.5 mb-1">
        {sources.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await toggleSourceNotify(s.id, !s.notifyOnLead);
              })
            }
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs transition-colors',
              s.notifyOnLead
                ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-strong)]',
            )}
          >
            {s.name}
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Highlighted sources send an alert. Separate from automated outreach — that emails the
        lead, this emails you.
      </p>

      {/* --- Sending credentials, last --- */}
      <h3 className="text-xs font-semibold text-[var(--text-secondary)] mt-6 mb-2 pt-4 border-t border-[var(--border-subtle)]">
        Sending
      </h3>

      <form action={connectAction} className="flex flex-col gap-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            label="From address"
            name="from_address"
            required
            placeholder="outreach@orb-itworks.com"
            defaultValue={settings?.fromAddress ?? ''}
            hint="Must be on a domain verified in Resend."
          />
          <Input
            label="Resend API key"
            name="api_key"
            type="password"
            autoComplete="off"
            placeholder={
              settings ? `Stored (${settings.keyHint}) — leave blank to keep` : 're_...'
            }
            hint="resend.com → API Keys."
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <SubmitButton label="Save" />
          {connected && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={isPending}
              onClick={() =>
                startTransition(async () => {
                  const r = await sendTestNotification();
                  setTestResult(r.message);
                })
              }
            >
              Send a test
            </Button>
          )}
          {connectState.error && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {connectState.error}
            </p>
          )}
          {connectState.success && (
            <p role="status" className="text-xs text-[var(--success)]">
              {connectState.success}
            </p>
          )}
        </div>
      </form>

      {testResult && (
        <p role="status" className="text-xs text-[var(--text-secondary)] mt-2">
          {testResult}
        </p>
      )}

      {settings?.lastError && (
        <p role="alert" className="text-xs text-[var(--danger)] mt-2">
          {settings.lastError}
        </p>
      )}
    </Card>
  );
}
