import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePortalUser } from '@/lib/portal-auth';
import { Card, CardHeader, PageHeader } from '@/components/ui/Card';
import { Badge, InvoiceStatusBadge, DealStatusBadge } from '@/components/ui/Badge';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { InvoiceWithStatus, Deal } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Your account' };

// Overdue status is derived from today's date, so never cache.
export const dynamic = 'force-dynamic';

/**
 * Portal overview (Phase 2: "Client Portal").
 *
 * Every query here runs under the client's own session, so RLS returns only
 * their records. There is no `.eq('contact_id', ...)` filter anywhere — adding
 * one would imply the security came from the query rather than the database,
 * and invite someone to remove it later.
 */
export default async function PortalOverviewPage() {
  const portalUser = await requirePortalUser();
  const supabase = await createClient();

  const [invoicesResult, dealsResult, orgResult] = await Promise.all([
    supabase
      .from('invoices_with_status')
      .select('*')
      .order('issue_date', { ascending: false })
      .returns<InvoiceWithStatus[]>(),
    supabase
      .from('deals')
      .select('*')
      .order('created_at', { ascending: false })
      .returns<Deal[]>(),
    supabase.from('organizations').select('name').maybeSingle(),
  ]);

  const invoices = invoicesResult.data ?? [];
  const deals = dealsResult.data ?? [];

  // Drafts are internal — a client should not see an invoice before it is sent.
  const visibleInvoices = invoices.filter((i) => i.status !== 'draft');
  const outstanding = visibleInvoices
    .filter((i) => i.display_status === 'sent' || i.display_status === 'overdue')
    .reduce((sum, i) => sum + Number(i.total), 0);
  const overdueCount = visibleInvoices.filter((i) => i.display_status === 'overdue').length;

  const activeProjects = deals.filter((d) => d.status === 'open');

  return (
    <>
      <PageHeader
        title={`Welcome, ${portalUser.full_name.split(' ')[0]}`}
        description={`Your invoices and projects with ${orgResult.data?.name ?? 'us'}.`}
      />

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Outstanding</p>
          <p
            className={`text-xl font-semibold tabular mt-1 ${
              outstanding > 0 ? 'text-[var(--warning)]' : ''
            }`}
          >
            {formatCurrency(outstanding)}
          </p>
          {overdueCount > 0 && (
            <p className="text-xs text-[var(--danger)] mt-0.5">
              {overdueCount} overdue
            </p>
          )}
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Active projects</p>
          <p className="text-xl font-semibold tabular mt-1">{activeProjects.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Invoices</p>
          <p className="text-xl font-semibold tabular mt-1">{visibleInvoices.length}</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent invoices"
            action={
              <Link
                href="/portal/invoices"
                className="text-xs text-[var(--primary)] hover:underline font-medium"
              >
                View all
              </Link>
            }
          />
          {visibleInvoices.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No invoices yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
              {visibleInvoices.slice(0, 5).map((invoice) => (
                <li key={invoice.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/portal/invoices/${invoice.id}`}
                        className="text-sm font-medium tabular hover:text-[var(--primary)] transition-colors"
                      >
                        {invoice.invoice_number}
                      </Link>
                      <p className="text-xs text-[var(--text-muted)]">
                        Due {formatDate(invoice.due_date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm tabular">
                        {formatCurrency(invoice.total, invoice.currency)}
                      </span>
                      <InvoiceStatusBadge status={invoice.display_status} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Your projects"
            action={
              <Link
                href="/portal/projects"
                className="text-xs text-[var(--primary)] hover:underline font-medium"
              >
                View all
              </Link>
            }
          />
          {deals.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No projects yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
              {deals.slice(0, 5).map((deal) => (
                <li key={deal.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{deal.title}</p>
                      {deal.expected_close_date && deal.status === 'open' && (
                        <p className="text-xs text-[var(--text-muted)]">
                          Expected {formatDate(deal.expected_close_date)}
                        </p>
                      )}
                    </div>
                    <DealStatusBadge status={deal.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Badge tone="info">Questions?</Badge>
          <p className="text-sm text-[var(--text-secondary)]">
            Reply to any email from us, or contact your account manager directly.
          </p>
        </div>
      </Card>
    </>
  );
}
