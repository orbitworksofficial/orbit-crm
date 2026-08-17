import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { Card, CardHeader, PageHeader } from '@/components/ui/Card';
import { StatTile } from '@/components/charts/StatTile';
import { BarList } from '@/components/charts/BarList';
import { DateRangeFilter } from '../dashboard/DateRangeFilter';
import { ExportButton } from './ExportButton';
import { TableWrapper, Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { getDashboardMetrics } from '@/lib/metrics';
import { resolveDateRange, parsePreset } from '@/lib/date-range';
import { formatCurrency, formatPercent } from '@/lib/utils';

export const metadata: Metadata = { title: 'Reports' };

export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const profile = await requireProfile();
  const supabase = await createClient();

  const range = resolveDateRange(parsePreset(params.range), params.from, params.to);
  const metrics = await getDashboardMetrics(supabase, range);

  // --- Revenue report: invoiced vs paid (brief §07) -------------------------
  // Admin-only data; RLS returns nothing for sales users, so the section is
  // simply hidden for them rather than erroring.
  let invoiceRows: { total: number; status: string }[] = [];
  if (profile.role === 'admin') {
    let invoiceQuery = supabase.from('invoices_with_status').select('total, status, issue_date');
    if (range.from) invoiceQuery = invoiceQuery.gte('issue_date', range.from.slice(0, 10));
    if (range.to) invoiceQuery = invoiceQuery.lt('issue_date', range.to.slice(0, 10));
    const { data } = await invoiceQuery.returns<{ total: number; status: string }[]>();
    invoiceRows = data ?? [];
  }

  const totalInvoiced = invoiceRows
    .filter((row) => row.status !== 'void')
    .reduce((sum, row) => sum + Number(row.total), 0);
  const totalPaid = invoiceRows
    .filter((row) => row.status === 'paid')
    .reduce((sum, row) => sum + Number(row.total), 0);
  const outstanding = totalInvoiced - totalPaid;

  // --- Conversion funnel: leads → deals → won ------------------------------
  let dealsQuery = supabase.from('deals').select('id, status, value, created_at');
  if (range.from) dealsQuery = dealsQuery.gte('created_at', range.from);
  if (range.to) dealsQuery = dealsQuery.lt('created_at', range.to);
  const { data: dealRows } = await dealsQuery;

  const dealsCreated = dealRows?.length ?? 0;
  const dealsWon = dealRows?.filter((deal) => deal.status === 'won').length ?? 0;
  const dealsLost = dealRows?.filter((deal) => deal.status === 'lost').length ?? 0;

  const exportParams = new URLSearchParams();
  if (params.range) exportParams.set('range', params.range);
  if (params.from) exportParams.set('from', params.from);
  if (params.to) exportParams.set('to', params.to);
  const exportQuery = exportParams.toString();

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${range.label} · every figure calculated live from the database.`}
      />

      <DateRangeFilter current={params} />

      {/* --- Monthly lead report --- */}
      <Card className="mb-4">
        <CardHeader
          title="Lead report"
          description="Total leads, broken down by source, service, and status."
          action={
            <ExportButton
              href={`/reports/export/leads${exportQuery ? `?${exportQuery}` : ''}`}
              label="Export CSV"
            />
          }
        />

        <div className="grid gap-3 sm:grid-cols-3 mb-4">
          <StatTile label="Total leads" value={metrics.totalLeads.toLocaleString()} />
          <StatTile
            label="Won"
            value={metrics.wonLeads.toLocaleString()}
            accent="success"
          />
          <StatTile
            label="Conversion rate"
            value={formatPercent(metrics.wonLeads, metrics.totalLeads)}
            accent="info"
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <div>
            <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2.5">By source</h3>
            <BarList data={metrics.leadsBySource} tone="chart-1" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2.5">By service</h3>
            <BarList data={metrics.leadsByService} tone="chart-3" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2.5">By status</h3>
            <BarList data={metrics.leadsByStatus} tone="chart-4" />
          </div>
        </div>
      </Card>

      {/* --- Conversion report --- */}
      <Card className="mb-4">
        <CardHeader
          title="Conversion report"
          description="Where leads drop off between first contact and a won deal."
        />
        <TableWrapper>
          <Table>
            <THead>
              <TR>
                <TH>Stage</TH>
                <TH align="right">Count</TH>
                <TH align="right">% of leads</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>Leads created</TD>
                <TD align="right">{metrics.totalLeads}</TD>
                <TD align="right">100%</TD>
              </TR>
              <TR>
                <TD>Deals created</TD>
                <TD align="right">{dealsCreated}</TD>
                <TD align="right">{formatPercent(dealsCreated, metrics.totalLeads)}</TD>
              </TR>
              <TR>
                <TD>Deals won</TD>
                <TD align="right" className="text-[var(--success)]">
                  {dealsWon}
                </TD>
                <TD align="right">{formatPercent(dealsWon, metrics.totalLeads)}</TD>
              </TR>
              <TR>
                <TD>Deals lost</TD>
                <TD align="right" className="text-[var(--danger)]">
                  {dealsLost}
                </TD>
                <TD align="right">{formatPercent(dealsLost, metrics.totalLeads)}</TD>
              </TR>
            </TBody>
          </Table>
        </TableWrapper>
      </Card>

      {/* --- Revenue report (admin only) --- */}
      {profile.role === 'admin' && (
        <Card className="mb-4">
          <CardHeader
            title="Revenue report"
            description="Invoiced versus paid, and what remains outstanding."
            action={
              <ExportButton
                href={`/reports/export/revenue${exportQuery ? `?${exportQuery}` : ''}`}
                label="Export CSV"
              />
            }
          />
          <div className="grid gap-3 sm:grid-cols-4">
            <StatTile
              label="Deal revenue (won)"
              value={formatCurrency(metrics.revenue)}
              caption="From won deals"
              accent="success"
            />
            <StatTile label="Total invoiced" value={formatCurrency(totalInvoiced)} />
            <StatTile
              label="Total paid"
              value={formatCurrency(totalPaid)}
              accent="success"
            />
            <StatTile
              label="Outstanding"
              value={formatCurrency(outstanding)}
              caption="Invoiced but unpaid"
              accent={outstanding > 0 ? 'warning' : 'default'}
            />
          </div>
        </Card>
      )}

      {/* --- Service report --- */}
      <Card>
        <CardHeader
          title="Service report"
          description="Which services attract the most interest."
          action={
            <ExportButton
              href={`/reports/export/services${exportQuery ? `?${exportQuery}` : ''}`}
              label="Export CSV"
            />
          }
        />
        <BarList
          data={metrics.leadsByService}
          tone="chart-3"
          emptyMessage="No services were tagged on leads in this period."
        />
      </Card>
    </>
  );
}
