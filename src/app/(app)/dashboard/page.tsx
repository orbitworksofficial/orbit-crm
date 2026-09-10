import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { Card, CardHeader, PageHeader } from '@/components/ui/Card';
import { StatTile } from '@/components/charts/StatTile';
import { BarList } from '@/components/charts/BarList';
import { CampaignPanel } from '@/components/charts/CampaignPanel';
import { DateRangeFilter } from './DateRangeFilter';
import { getDashboardMetrics, getAttributionMetrics } from '@/lib/metrics';
import { resolveDateRange, parsePreset } from '@/lib/date-range';
import { formatCurrency, formatPercent } from '@/lib/utils';

export const metadata: Metadata = { title: 'Dashboard' };

// Metrics are read live from Postgres on every request (brief §05: "Every
// metric is calculated directly from the Supabase database in real time").
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; error?: string }>;
}) {
  const params = await searchParams;
  const profile = await requireProfile();
  const supabase = await createClient();

  const range = resolveDateRange(parsePreset(params.range), params.from, params.to);
  // Both metric sets are independent, so they share one round trip.
  const [metrics, attribution] = await Promise.all([
    getDashboardMetrics(supabase, range),
    getAttributionMetrics(supabase, range),
  ]);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${profile.full_name.split(' ')[0]}`}
        description={
          profile.role === 'admin'
            ? 'Company-wide performance.'
            : 'Performance across the leads and deals assigned to you.'
        }
      />

      {params.error === 'forbidden' && (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-[var(--warning-bg)] text-[var(--warning)] px-3 py-2 text-sm"
        >
          That area is restricted to administrators.
        </div>
      )}

      <DateRangeFilter current={params} />

      {/* --- Headline figures --- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-4">
        <StatTile
          label="Total leads"
          value={metrics.totalLeads.toLocaleString()}
          caption={range.label}
        />
        <StatTile
          label="Revenue closed"
          value={formatCurrency(metrics.revenue)}
          caption={`${metrics.wonDeals} deal${metrics.wonDeals === 1 ? '' : 's'} won`}
          accent="success"
        />
        <StatTile
          label="Conversion rate"
          value={formatPercent(metrics.wonLeads, metrics.totalLeads)}
          caption="Leads reaching a won status"
          accent="info"
        />
        <StatTile
          label="Open pipeline"
          value={formatCurrency(metrics.openPipelineValue)}
          caption={`${metrics.openDeals} open deal${metrics.openDeals === 1 ? '' : 's'}`}
        />
      </div>

      {/* --- Top source callout (brief §05) --- */}
      {metrics.topSource && (
        <Card className="mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="size-9 rounded-lg bg-[var(--info-bg)] flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <svg
                className="size-4 text-[var(--info)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-xs text-[var(--text-secondary)]">Top lead source</p>
              <p className="text-sm font-medium">
                {metrics.topSource.label}
                <span className="text-[var(--text-muted)] font-normal">
                  {' '}
                  · {metrics.topSource.count} of {metrics.totalLeads} leads
                </span>
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* --- Breakdowns --- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Leads by source" description="Where leads came from." />
          <BarList data={metrics.leadsBySource} tone="chart-1" />
        </Card>

        <Card>
          <CardHeader title="Leads by service" description="Most requested services." />
          <BarList
            data={metrics.leadsByService.slice(0, 8)}
            tone="chart-3"
            emptyMessage="No service tags in this period."
          />
        </Card>

        <Card>
          <CardHeader title="Leads by status" description="Where leads sit in the funnel." />
          <BarList data={metrics.leadsByStatus} tone="chart-4" />
        </Card>
      </div>

      {/* --- Marketing attribution --- */}
      <div className="mt-4">
        <CampaignPanel metrics={attribution} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 mt-4">
        <Card>
          <CardHeader title="Quick actions" />
          <div className="flex flex-wrap gap-2">
            <Link
              href="/contacts/new"
              className="text-sm text-[var(--primary)] hover:underline font-medium"
            >
              Add a contact
            </Link>
            <span className="text-[var(--text-muted)]">·</span>
            <Link
              href="/deals/new"
              className="text-sm text-[var(--primary)] hover:underline font-medium"
            >
              Create a deal
            </Link>
            {profile.role === 'admin' && (
              <>
                <span className="text-[var(--text-muted)]">·</span>
                <Link
                  href="/invoices/new"
                  className="text-sm text-[var(--primary)] hover:underline font-medium"
                >
                  Raise an invoice
                </Link>
              </>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
