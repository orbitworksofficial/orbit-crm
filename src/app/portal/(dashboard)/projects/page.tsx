import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { requirePortalUser } from '@/lib/portal-auth';
import { PageHeader, EmptyState, Card } from '@/components/ui/Card';
import { DealStatusBadge } from '@/components/ui/Badge';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Deal } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Your projects' };

export const dynamic = 'force-dynamic';

/**
 * Project status for the client.
 *
 * Shows the deal title, value, and coarse status — open, won, lost. It
 * deliberately does NOT show the Kanban stage: "Negotiation" or "Proposal Sent"
 * is internal sales language, and a client reading their own project described
 * that way is at best confusing and at worst damaging.
 */
export default async function PortalProjectsPage() {
  await requirePortalUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from('deals')
    .select('*')
    .order('created_at', { ascending: false })
    .returns<Deal[]>();

  const deals = data ?? [];
  const active = deals.filter((d) => d.status === 'open');
  const completed = deals.filter((d) => d.status === 'won');

  return (
    <>
      <PageHeader title="Projects" description="What we are working on together." />

      {deals.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Projects appear here once work is agreed."
        />
      ) : (
        <div className="flex flex-col gap-5">
          {active.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">
                In progress
              </h2>
              <div className="flex flex-col gap-3">
                {active.map((deal) => (
                  <Card key={deal.id}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{deal.title}</p>
                        {deal.expected_close_date && (
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Expected completion {formatDate(deal.expected_close_date)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-medium tabular">
                          {formatCurrency(deal.value, deal.currency)}
                        </span>
                        <DealStatusBadge status={deal.status} />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {completed.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">
                Completed
              </h2>
              <div className="flex flex-col gap-3">
                {completed.map((deal) => (
                  <Card key={deal.id}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{deal.title}</p>
                        {deal.closed_at && (
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Completed {formatDate(deal.closed_at)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-medium tabular">
                          {formatCurrency(deal.value, deal.currency)}
                        </span>
                        <DealStatusBadge status={deal.status} />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
