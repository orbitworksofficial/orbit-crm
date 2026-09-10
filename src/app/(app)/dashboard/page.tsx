import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { Card, CardHeader, PageHeader } from '@/components/ui/Card';
import { StatTile } from '@/components/charts/StatTile';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { TrendChart } from '@/components/charts/TrendChart';
import { FunnelChart } from '@/components/charts/FunnelChart';
import { CampaignPanel } from '@/components/charts/CampaignPanel';
import { DateRangeFilter } from './DateRangeFilter';
import { getDashboardMetrics, getAttributionMetrics, getTimeSeries } from '@/lib/metrics';
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
  const [metrics, attribution, series] = await Promise.all([
    getDashboardMetrics(supabase, range),
    getAttributionMetrics(supabase, range),
    getTimeSeries(supabase, range),
  ]);

  // Funnel stages, ordered by how far through the pipeline they sit. Built from
  // the status breakdown rather than hardcoded names, so renaming a status in
  // Settings cannot break the chart. Won and lost are terminal and identified
  // by their flags.
  const stageOrder = ['new', 'contacted', 'in discussion', 'proposal sent'];

  const funnelStages = [
    { label: 'All leads', count: metrics.totalLeads },
    ...stageOrder
      .map((name) => {
        const match = metrics.leadsByStatus.find((s) => s.label.toLowerCase() === name);
        return match ? { label: match.label, count: match.count } : null;
      })
      .filter((s): s is { label: string; count: number } => s !== null && s.count > 0),
    { label: 'Won', count: metrics.wonLeads },
  ];

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

      {/* A period with no leads renders a page of zeroes and empty charts, which
          reads as a broken dashboard rather than an empty one. Say so plainly,
          and offer the widest range as a way out. */}
      {metrics.totalLeads === 0 && (
        <Card className="mb-4">
          <div className="flex items-start gap-3 flex-wrap">
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
                <circle cx="12" cy="12" r="9" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">No leads in this period</p>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                The charts below are empty because no contacts were created in{' '}
                {range.label.toLowerCase()}. Widen the date range to see earlier
                activity.
              </p>
              <Link
                href="/dashboard?range=all_time"
                className="inline-block mt-2 text-sm text-[var(--primary)] hover:underline font-medium"
              >
                Show all time
              </Link>
            </div>
          </div>
        </Card>
      )}

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

      {/* --- Trend over time --- */}
      <Card className="mb-4">
        <CardHeader
          title="Revenue and leads over time"
          description="Closed revenue and new leads across the selected period."
        />
        <TrendChart points={series.points} bucket={series.bucket} />
      </Card>

      {/* --- Funnel + source --- */}
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <Card>
          <CardHeader title="Pipeline funnel" description="Where leads drop off." />
          <FunnelChart stages={funnelStages} />
        </Card>

        <Card>
          <CardHeader title="Leads by source" description="Where leads came from." />
          <ColumnChart data={metrics.leadsBySource} tone="chart-1" />
        </Card>
      </div>

      {/* --- Breakdowns --- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Leads by service" description="Most requested services." />
          <ColumnChart
            data={metrics.leadsByService.slice(0, 8)}
            tone="chart-3"
            emptyMessage="No service tags in this period."
          />
        </Card>

        <Card>
          <CardHeader title="Leads by status" description="Current stage of each lead." />
          <ColumnChart data={metrics.leadsByStatus} tone="chart-4" />
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
