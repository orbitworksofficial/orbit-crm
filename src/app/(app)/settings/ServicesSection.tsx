'use client';

import { useActionState, useTransition, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, cn } from '@/lib/utils';
import {
  createService,
  updateService,
  toggleServiceActive,
  type ActionState,
} from './actions';
import type { Service } from '@/lib/supabase/database.types';

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      Add service
    </Button>
  );
}

/**
 * Service catalogue management (brief §04, §09).
 *
 * Services are archived rather than deleted, so historical invoice line items
 * and lead tags keep resolving.
 */
export function ServicesSection({ services }: { services: Service[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createService, {});
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  const activeCount = services.filter((service) => service.is_active).length;

  return (
    <Card>
      <CardHeader
        title="Service catalogue"
        description={`${activeCount} active of ${services.length}. Used for lead tags and invoice line items.`}
      />

      <ul className="flex flex-col divide-y divide-[var(--border-subtle)] mb-4">
        {services.map((service) => (
          <li key={service.id} className="py-2.5 first:pt-0">
            {editingId === service.id ? (
              <form
                action={(formData) => {
                  startTransition(async () => {
                    await updateService(service.id, formData);
                    setEditingId(null);
                  });
                }}
                className="flex items-end gap-2 flex-wrap"
              >
                <Input
                  name="name"
                  defaultValue={service.name}
                  aria-label="Service name"
                  className="flex-1 min-w-[160px]"
                  required
                />
                <Input
                  name="default_rate"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={service.default_rate ?? ''}
                  placeholder="Rate"
                  aria-label="Default rate"
                  className="w-32"
                />
                <Button type="submit" size="sm" loading={isPending}>
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      !service.is_active && 'text-[var(--text-muted)] line-through',
                    )}
                  >
                    {service.name}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {service.default_rate != null
                      ? formatCurrency(service.default_rate)
                      : 'No default rate'}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!service.is_active && <Badge tone="neutral">Archived</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(service.id)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        await toggleServiceActive(service.id, !service.is_active);
                      })
                    }
                  >
                    {service.is_active ? 'Archive' : 'Restore'}
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
          label="New service"
          name="name"
          placeholder="Service name"
          required
          className="flex-1 min-w-[180px]"
        />
        <Input
          label="Default rate"
          name="default_rate"
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          className="w-32"
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
