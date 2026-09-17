import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { PageHeader, EmptyState, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TableWrapper, Table, THead, TBody, TR, TH } from '@/components/ui/Table';
import { SubscriptionRow, type SubscriptionRowData } from './SubscriptionRow';
import { formatCurrency } from '@/lib/utils';
import type { Subscription } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Retainers' };

// Due dates are relative to today, so this page is never cached.
export const dynamic = 'force-dynamic';

/** Normalises any cycle to a monthly figure, so totals are comparable. */
function monthlyValue(amount: number, cycle: string): number {
  if (cycle === 'quarterly') return amount / 3;
  if (cycle === 'annual') return amount / 12;
  return amount;
}

/**
 * Recurring retainers (Phase 2: "Subscription Tracking").
 *
 * Tracks the agreement and when it is next due. Raising the invoice stays a
 * deliberate act — the Invoice button creates a DRAFT, pre-filled from the
 * retainer's services, and nothing reaches a client unreviewed.
 */
export default async function SubscriptionsPage() {
  await requireProfile();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .order('next_billing_date')
    .returns<Subscription[]>();

  const subscriptions = data ?? [];

  const contactIds = [...new Set(subscriptions.map((s) => s.contact_id))];
  const { data: contacts } = contactIds.length
    ? await supabase.from('contacts').select('id, full_name, company_name').in('id', contactIds)
    : { data: [] };
  const contactsById = new Map((contacts ?? []).map((c) => [c.id, c]));

  const rows: SubscriptionRowData[] = subscriptions.map((s) => {
    const contact = contactsById.get(s.contact_id);
    return {
      id: s.id,
      name: s.name,
      amount: s.amount,
      currency: s.currency,
      cycle: s.cycle,
      status: s.status,
      nextBillingDate: s.next_billing_date,
      contactId: s.contact_id,
      contactName: contact?.full_name ?? null,
      companyName: contact?.company_name ?? null,
    };
  });

  const active = subscriptions.filter((s) => s.status === 'active');
  // Monthly recurring revenue: the figure that actually describes a retainer
  // book, rather than a sum of differently-sized cycles.
  const mrr = active.reduce((sum, s) => sum + monthlyValue(Number(s.amount), s.cycle), 0);

  const today = new Date().toISOString().slice(0, 10);
  const dueSoon = active.filter((s) => s.next_billing_date <= today).length;

  return (
    <>
      <PageHeader
        title="Retainers"
        description="Recurring clients, billing cycles, and renewal dates."
        action={
          <Link href="/subscriptions/new">
            <Button>New retainer</Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Active retainers</p>
          <p className="text-xl font-semibold tabular mt-1">{active.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Monthly recurring</p>
          <p className="text-xl font-semibold tabular mt-1 text-[var(--success)]">
            {formatCurrency(mrr)}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Due now</p>
          <p
            className={`text-xl font-semibold tabular mt-1 ${
              dueSoon > 0 ? 'text-[var(--warning)]' : ''
            }`}
          >
            {dueSoon}
          </p>
        </Card>
      </div>

      {error ? (
        <EmptyState title="Could not load retainers" description={error.message} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No retainers yet"
          description="Track recurring clients so billing dates never slip."
          action={
            <Link href="/subscriptions/new">
              <Button>New retainer</Button>
            </Link>
          }
        />
      ) : (
        <TableWrapper>
          <Table>
            <THead>
              <TR>
                <TH>Retainer</TH>
                <TH>Client</TH>
                <TH>Status</TH>
                <TH>Next billing</TH>
                <TH align="right">Amount</TH>
                <TH align="right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <SubscriptionRow key={row.id} row={row} />
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      )}
    </>
  );
}
