'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

/**
 * A read-only value with a copy button.
 *
 * For values the CRM generates and the user has to paste somewhere else — the
 * Meta webhook callback URL and its verify token. Those are long, exact, and
 * unforgiving of a transcription error, so selecting them by hand is a real
 * source of failed setups.
 */
export function CopyField({
  label,
  value,
  hint,
  mono = true,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied over plain HTTP and in some embedded
      // browsers. The input is selectable, so the value is still reachable —
      // silently leaving the button unchanged is better than an alert.
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-[var(--text-secondary)]">{label}</label>
      <div className="flex items-stretch gap-2">
        <input
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className={`flex-1 min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--text-primary)] ${
            mono ? 'font-mono' : ''
          }`}
        />
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {hint ? <p className="text-xs text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}
