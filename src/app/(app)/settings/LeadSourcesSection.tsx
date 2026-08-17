'use client';

import { useActionState, useTransition, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import {
  createLeadSource,
  renameLeadSource,
  toggleLeadSourceActive,
  type ActionState,
} from './actions';
import type { LeadSource } from '@/lib/supabase/database.types';

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      Add source
    </Button>
  );
}

/**
 * Lead source management (brief §09).
 *
 * The slug is shown read-only alongside each name: the website contact form
 * posts by slug, so renaming the display label is safe but the slug must not
 * change.
 */
export function LeadSourcesSection({ sources }: { sources: LeadSource[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createLeadSource, {});
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader
        title="Lead sources"
        description="Used across contacts and reports. The website form posts by slug, so slugs are fixed."
      />

      <ul className="flex flex-col divide-y divide-[var(--border-subtle)] mb-4">
        {sources.map((source) => (
          <li key={source.id} className="py-2.5 first:pt-0">
            {editingId === source.id ? (
              <form
                action={(formData) => {
                  startTransition(async () => {
                    await renameLeadSource(source.id, formData);
                    setEditingId(null);
                  });
                }}
                className="flex items-end gap-2 flex-wrap"
              >
                <Input
                  name="name"
                  defaultValue={source.name}
                  aria-label="Source name"
                  className="flex-1 min-w-[160px]"
                  required
                />
                <Button type="submit" size="sm" loading={isPending}>
                  Save
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      !source.is_active && 'text-[var(--text-muted)] line-through',
                    )}
                  >
                    {source.name}
                  </p>
                  <code className="text-xs text-[var(--text-muted)]">{source.slug}</code>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!source.is_active && <Badge tone="neutral">Hidden</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(source.id)}>
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        await toggleLeadSourceActive(source.id, !source.is_active);
                      })
                    }
                  >
                    {source.is_active ? 'Hide' : 'Show'}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <form
        action={formAction}
        className="flex items-end gap-2 flex-wrap border-t border-[var(--border-subtle)] pt-4"
      >
        <Input
          label="New lead source"
          name="name"
          placeholder="e.g. Trade Show"
          required
          className="flex-1 min-w-[180px]"
        />
        <AddButton />
      </form>

      {state.error && (
        <p role="alert" className="text-xs text-[var(--danger)] mt-2">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-xs text-[var(--success)] mt-2">
          {state.success}
        </p>
      )}
    </Card>
  );
}
