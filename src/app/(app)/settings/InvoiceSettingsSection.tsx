'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { updateInvoiceSettings, type ActionState } from './actions';
import type { Organization } from '@/lib/supabase/database.types';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      Save settings
    </Button>
  );
}

/** Invoice defaults (brief §09): prefix, currency, terms, and tax rate. */
export function InvoiceSettingsSection({ organization }: { organization: Organization }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateInvoiceSettings, {});

  return (
    <Card>
      <CardHeader
        title="Invoice settings"
        description="Defaults applied to every new invoice."
      />

      <form action={formAction} className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Invoice number prefix"
          name="invoice_prefix"
          defaultValue={organization.invoice_prefix}
          maxLength={10}
          required
          hint={`Next invoice: ${organization.invoice_prefix}-${String(
            organization.invoice_next_number,
          ).padStart(4, '0')}`}
        />
        <Input
          label="Default currency"
          name="default_currency"
          defaultValue={organization.default_currency}
          maxLength={3}
          required
          hint="Three-letter code, e.g. USD"
        />
        <Input
          label="Payment terms (days)"
          name="default_payment_terms_days"
          type="number"
          min="0"
          max="365"
          defaultValue={organization.default_payment_terms_days}
          hint="Sets the default due date, e.g. 30 for Net 30"
        />
        <Input
          label="Default tax rate (%)"
          name="default_tax_rate"
          type="number"
          min="0"
          max="100"
          step="0.01"
          defaultValue={organization.default_tax_rate}
        />

        <div className="sm:col-span-2 flex items-center gap-3">
          <SubmitButton />
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
    </Card>
  );
}
