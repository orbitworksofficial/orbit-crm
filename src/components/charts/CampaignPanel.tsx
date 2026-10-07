import { Card, CardHeader } from '@/components/ui/Card';
import { formatCurrency, formatDateTime, formatPercent, cn } from '@/lib/utils';
import type { AttributionMetrics, CampaignRow } from '@/lib/metrics';

/**
 * Marketing attribution panel (dashboard).
 *
 * Shows which channels and campaigns produce leads and revenue, and — once an
 * ad platform is connected — what they cost and what they returned.
 *
 * Form: channels and campaigns are *nominal* categories — Google is not
 * "more" than Facebook — so every bar wears the same hue rather than one colour
 * per channel. Colouring them individually would spend the identity channel
 * re-encoding what the bar length already shows. Leads and revenue are two
 * different measures, so they get one hue each and never share an axis.
 *
 * Spend, CPL and ROAS go in a table rather than more bars. CPL and ROAS are
 * ratios, not magnitudes, so a bar's length would imply a comparison that does
 * not hold — and five bar charts side by side cannot be read anyway.
 */

/** One row: label, a proportional bar, and its value direct-labelled. */
function MetricBar({
  label,
  sublabel,
  value,
  max,
  tone,
  formatted,
}: {
  label: string;
  sublabel?: string;
  value: number;
  max: number;
  tone: 'chart-1' | 'chart-4';
  formatted: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-[var(--text-secondary)] truncate">
          {label}
          {sublabel && (
            <span className="text-[var(--text-muted)]"> · {sublabel}</span>
          )}
        </span>
        {/* Direct label. Also the relief channel for the green mark, which sits
            below 3:1 against a light surface. */}
        <span className="text-[var(--text-primary)] font-medium tabular shrink-0">
          {formatted}
        </span>
      </div>
      <div className="h-2 rounded-full bg-[var(--chart-track)] overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.max(pct, value > 0 ? 2 : 0)}%`,
            backgroundColor: `var(--${tone})`,
          }}
          aria-hidden="true"
        />
      </div>
    </li>
  );
}

export function CampaignPanel({ metrics }: { metrics: AttributionMetrics }) {
  // Nothing tagged yet: explain how to make the panel work rather than showing
  // an empty chart.
  if (!metrics.hasData) {
    return (
      <Card>
        <CardHeader
          title="Campaign performance"
          description="Which ads and channels are producing leads."
        />
        <div className="text-sm text-[var(--text-secondary)] flex flex-col gap-2">
          <p>No campaign-tagged leads yet in this period.</p>
          <p className="text-xs text-[var(--text-muted)]">
            Add UTM parameters to the ad links pointing at your website — for
            example{' '}
            <code className="text-[var(--text-secondary)]">
              ?utm_source=facebook&amp;utm_campaign=spring-2026
            </code>
            . The contact form passes them through, and this panel fills in
            automatically.
          </p>
        </div>
      </Card>
    );
  }

  const maxChannelLeads = Math.max(...metrics.byChannel.map((r) => r.leads), 1);
  const topCampaigns = metrics.byCampaign.slice(0, 6);
  const maxCampaignRevenue = Math.max(...topCampaigns.map((r) => r.revenue), 1);
  const anyRevenue = topCampaigns.some((row) => row.revenue > 0);

  const totalTracked = metrics.byChannel.reduce((sum, row) => sum + row.leads, 0);
  const totalRevenue = metrics.byChannel.reduce((sum, row) => sum + row.revenue, 0);

  // Only campaigns with matched spend: a row of em dashes teaches nothing, and
  // an unmatched campaign is a join problem to fix in Settings, not a finding.
  const spendRows = metrics.byCampaign
    .filter((row) => row.spend !== null)
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
    .slice(0, 8);

  return (
    <Card>
      <CardHeader
        title="Campaign performance"
        description="Leads and closed revenue by marketing channel."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* --- Channels, by lead volume --- */}
        <section>
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2.5 flex items-center gap-1.5">
            {/* Legend: identity comes from the swatch, never from coloured text. */}
            <span
              className="size-2 rounded-full bg-[var(--chart-1)]"
              aria-hidden="true"
            />
            Leads by channel
          </h3>
          <ul className="flex flex-col gap-2.5">
            {metrics.byChannel.map((row) => (
              <MetricBar
                key={row.label}
                label={row.label}
                sublabel={
                  row.won > 0 ? `${formatPercent(row.won, row.leads)} won` : undefined
                }
                value={row.leads}
                max={maxChannelLeads}
                tone="chart-1"
                formatted={String(row.leads)}
              />
            ))}
          </ul>
        </section>

        {/* --- Campaigns, by revenue --- */}
        <section>
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2.5 flex items-center gap-1.5">
            <span
              className="size-2 rounded-full bg-[var(--chart-4)]"
              aria-hidden="true"
            />
            {anyRevenue ? 'Revenue by campaign' : 'Leads by campaign'}
          </h3>
          <ul className="flex flex-col gap-2.5">
            {topCampaigns.map((row) => (
              <MetricBar
                key={row.label}
                label={row.label}
                sublabel={`${row.leads} lead${row.leads === 1 ? '' : 's'}`}
                // Until something closes, revenue bars would all be zero-width;
                // fall back to lead volume so the chart still says something.
                value={anyRevenue ? row.revenue : row.leads}
                max={anyRevenue ? maxCampaignRevenue : Math.max(...topCampaigns.map((r) => r.leads), 1)}
                tone="chart-4"
                formatted={anyRevenue ? formatCurrency(row.revenue) : String(row.leads)}
              />
            ))}
          </ul>
        </section>
      </div>

      {/* --- Return on spend --- */}
      {metrics.hasSpend && (
        <section className="mt-6 pt-4 border-t border-[var(--border-subtle)]">
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2.5">
            Cost and return by campaign
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[var(--text-muted)] text-left">
                  <th scope="col" className="font-medium pb-1.5 pr-3">Campaign</th>
                  <th scope="col" className="font-medium pb-1.5 px-2 text-right">Leads</th>
                  <th scope="col" className="font-medium pb-1.5 px-2 text-right">Spend</th>
                  <th scope="col" className="font-medium pb-1.5 px-2 text-right">Cost/lead</th>
                  <th scope="col" className="font-medium pb-1.5 pl-2 text-right">Return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {spendRows.map((row) => (
                  <tr key={row.label}>
                    <td className="py-1.5 pr-3 text-[var(--text-primary)]">{row.label}</td>
                    <td className="py-1.5 px-2 text-right tabular text-[var(--text-secondary)]">
                      {row.leads}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular text-[var(--text-secondary)]">
                      {formatCurrency(row.spend ?? 0)}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular text-[var(--text-secondary)]">
                      {/* An em dash, not a zero: no leads means cost per lead
                          is undefined, not free. */}
                      {row.cpl === null ? '—' : formatCurrency(row.cpl)}
                    </td>
                    <td className="py-1.5 pl-2 text-right tabular">
                      {row.roas === null ? (
                        <span className="text-[var(--text-muted)]">—</span>
                      ) : (
                        <span
                          className={
                            row.roas >= 1
                              ? 'text-[var(--success)]'
                              : 'text-[var(--text-secondary)]'
                          }
                        >
                          {row.roas.toFixed(2)}×
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-2">
            Return is closed revenue divided by spend, attributed to the campaign that
            produced the lead. Campaigns with no spend data are not listed.
          </p>
        </section>
      )}

      <div
        className={cn(
          'mt-5 pt-3 border-t border-[var(--border-subtle)]',
          'flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]',
        )}
      >
        <span>
          <span className="text-[var(--text-secondary)] font-medium tabular">
            {totalTracked}
          </span>{' '}
          tracked leads
        </span>
        {totalRevenue > 0 && (
          <span>
            <span className="text-[var(--text-secondary)] font-medium tabular">
              {formatCurrency(totalRevenue)}
            </span>{' '}
            attributed revenue
          </span>
        )}
        {metrics.untracked > 0 && (
          <span>
            <span className="text-[var(--text-secondary)] font-medium tabular">
              {metrics.untracked}
            </span>{' '}
            untagged
          </span>
        )}
        {metrics.hasSpend && (
          <span>
            <span className="text-[var(--text-secondary)] font-medium tabular">
              {formatCurrency(metrics.totalSpend)}
            </span>{' '}
            ad spend
          </span>
        )}
        {/* Syncing is manual, so the figures carry their own age. An
            unlabelled ROAS computed from stale spend is worse than none. */}
        <span className="ml-auto">
          {metrics.hasSpend
            ? metrics.spendSyncedAt
              ? `Ad spend as of ${formatDateTime(metrics.spendSyncedAt)}`
              : 'Ad spend has not been synced yet.'
            : 'Connect an ad platform in Settings to see spend and ROAS.'}
        </span>
      </div>
    </Card>
  );
}

export type { CampaignRow };
