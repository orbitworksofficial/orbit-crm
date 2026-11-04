import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { Card, CardHeader, PageHeader, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatTile } from '@/components/charts/StatTile';
import {
  TableWrapper,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '@/components/ui/Table';
import { DateRangeFilter } from '../dashboard/DateRangeFilter';
import { resolveDateRange, parsePreset } from '@/lib/date-range';
import { getCampaignBreakdown, getSpendSeries } from '@/lib/metrics';
import { SpendChart } from '@/components/charts/SpendChart';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Campaigns' };
export const dynamic = 'force-dynamic';

/**
 * Ad campaign performance.
 *
 * Built entirely from synced data — no campaign is registered anywhere, so one
 * created this morning appears as soon as the sync has run. That matters
 * because campaigns here are started and stopped constantly; a page that
 * needed configuring per campaign would be out of date within a week.
 */
export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  await requireProfile();
  const supabase = await createClient();

  const range = resolveDateRange(parsePreset(params.range), params.from, params.to);
  const [campaigns, spendSeries] = await Promise.all([
    getCampaignBreakdown(supabase, range),
    getSpendSeries(supabase, range),
  ]);

  // When spend was last pulled. Shown because a stale figure that looks
  // current is worse than an obviously missing one.
  const { data: synced } = await supabase
    .from('ad_credentials')
    .select('last_synced_at')
    .eq('platform', 'meta')
    .maybeSingle();

  const totals = campaigns.reduce(
    (acc, c) => ({
      spend: acc.spend + c.spend,
      leads: acc.leads + (c.crmLeads || c.platformLeads),
      won: acc.won + c.won,
      revenue: acc.revenue + c.revenue,
    }),
    { spend: 0, leads: 0, won: 0, revenue: 0 },
  );

  const blendedCpl = totals.spend > 0 && totals.leads > 0 ? totals.spend / totals.leads : null;

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="What each ad campaign cost and what it produced."
      />

      <DateRangeFilter current={params} />

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaign data yet"
          description="Campaigns appear here once ad spend or leads have been synced from Meta. Run a sync from Settings, or wait for the nightly one."
          action={
            <Link href="/settings">
              <Button variant="secondary">Open settings</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-4">
            <StatTile label="Ad spend" value={formatCurrency(totals.spend)} />
            <StatTile label="Leads" value={totals.leads} accent="info" />
            <StatTile
              label="Cost per lead"
              value={blendedCpl === null ? '—' : formatCurrency(blendedCpl)}
            />
            <StatTile
              label="Revenue closed"
              value={formatCurrency(totals.revenue)}
              accent="success"
            />
          </div>

          <Card className="mb-4">
            <CardHeader
              title="Spend, reach and leads"
              description="Each measure on its own scale — they are not comparable to each other."
            />
            <SpendChart points={spendSeries} />
          </Card>

          <Card>
            <CardHeader
              title="By campaign"
              description={
                synced?.last_synced_at
                  ? `Ad spend as of ${formatDateTime(synced.last_synced_at)}`
                  : 'Ad spend has not been synced yet.'
              }
            />

            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Campaign</TH>
                    <TH align="right">Spend</TH>
                    <TH align="right">Impressions</TH>
                    <TH align="right">Clicks</TH>
                    <TH align="right">Leads</TH>
                    <TH align="right">Cost/lead</TH>
                    <TH align="right">Won</TH>
                    <TH align="right">Revenue</TH>
                    <TH align="right">Return</TH>
                  </TR>
                </THead>
                <TBody>
                  {campaigns.map((c) => (
                    <TR key={c.campaignId}>
                      <TD>
                        <p className="font-medium text-[var(--text-primary)]">{c.name}</p>
                        {c.firstSeen && (
                          <p className="text-xs text-[var(--text-muted)]">
                            {formatDate(c.firstSeen)} – {formatDate(c.lastSeen)}
                          </p>
                        )}
                      </TD>
                      <TD align="right" className="tabular text-[var(--text-secondary)]">
                        {c.spend > 0 ? formatCurrency(c.spend) : '—'}
                      </TD>
                      <TD align="right" className="tabular text-[var(--text-secondary)]">
                        {c.impressions.toLocaleString()}
                      </TD>
                      <TD align="right" className="tabular text-[var(--text-secondary)]">
                        {c.clicks.toLocaleString()}
                      </TD>
                      <TD align="right" className="tabular">
                        {/* The CRM's own count, with Meta's beside it when they
                            disagree — a gap usually means an import was missed. */}
                        <Link
                          href={`/contacts?q=${encodeURIComponent(c.key ?? '')}`}
                          className="text-[var(--primary)] hover:underline"
                        >
                          {c.crmLeads}
                        </Link>
                        {c.platformLeads > c.crmLeads && (
                          <span
                            className="text-[var(--text-muted)]"
                            title={`Meta counted ${c.platformLeads}`}
                          >
                            {' '}/ {c.platformLeads}
                          </span>
                        )}
                      </TD>
                      <TD align="right" className="tabular text-[var(--text-secondary)]">
                        {c.costPerLead === null ? '—' : formatCurrency(c.costPerLead)}
                      </TD>
                      <TD align="right" className="tabular text-[var(--text-secondary)]">
                        {c.won || '—'}
                      </TD>
                      <TD align="right" className="tabular text-[var(--text-secondary)]">
                        {c.revenue > 0 ? formatCurrency(c.revenue) : '—'}
                      </TD>
                      <TD align="right" className="tabular">
                        {c.roas === null ? (
                          <span className="text-[var(--text-muted)]">—</span>
                        ) : (
                          <span
                            className={
                              c.roas >= 1
                                ? 'text-[var(--success)]'
                                : 'text-[var(--text-secondary)]'
                            }
                          >
                            {c.roas.toFixed(2)}×
                          </span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>

            <p className="text-xs text-[var(--text-muted)] mt-3 pt-3 border-t border-[var(--border-subtle)]">
              Campaigns appear automatically as they are synced — nothing is configured here.
              Where two lead counts are shown, the first is the CRM&apos;s and the second is
              Meta&apos;s; a gap means some leads have not been imported.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
