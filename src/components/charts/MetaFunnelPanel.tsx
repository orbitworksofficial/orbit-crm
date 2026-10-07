import { Card, CardHeader } from '@/components/ui/Card';
import { FunnelChart } from '@/components/charts/FunnelChart';
import { formatCurrency } from '@/lib/utils';
import type { MetaFunnelMetrics } from '@/lib/metrics';

/**
 * The Meta Lead Ads funnel, impressions through to won business.
 *
 * Separate from CampaignPanel because this is one platform's own path, where
 * the stages are genuinely ordered and comparable. Cross-platform spend and
 * ROAS stay in CampaignPanel, since a Meta-only return figure invites a
 * comparison against nothing.
 *
 * The footer reports Meta's lead count next to the CRM's rather than choosing
 * between them. They count different things — Meta counts form submissions,
 * the CRM counts contacts that survived deduplication — so a gap is
 * informative: it usually means a webhook delivery was missed, which the
 * Backfill button in Settings repairs.
 */
export function MetaFunnelPanel({ metrics }: { metrics: MetaFunnelMetrics }) {
  if (!metrics.hasData) return null;

  // Meta's own lead count is the funnel's lead stage: it belongs to the same
  // measurement chain as impressions and clicks. The CRM's count is reported
  // separately below rather than mixed into the same series.
  const stages = [
    { label: 'Impressions', count: metrics.impressions },
    { label: 'Clicks', count: metrics.clicks },
    { label: 'Leads', count: metrics.platformLeads || metrics.crmLeads },
    { label: 'Won', count: metrics.won },
  ];

  const costPerLead =
    metrics.spend > 0 && metrics.crmLeads > 0 ? metrics.spend / metrics.crmLeads : null;

  const missing = metrics.platformLeads - metrics.crmLeads;

  return (
    <Card>
      <CardHeader
        title="Meta Lead Ads funnel"
        description="From ad impression to closed business."
      />

      <FunnelChart stages={stages} />

      <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
        {metrics.spend > 0 && (
          <span>
            <span className="text-[var(--text-secondary)] font-medium tabular">
              {formatCurrency(metrics.spend)}
            </span>{' '}
            spent
          </span>
        )}
        {costPerLead !== null && (
          <span>
            <span className="text-[var(--text-secondary)] font-medium tabular">
              {formatCurrency(costPerLead)}
            </span>{' '}
            per lead
          </span>
        )}
        <span>
          <span className="text-[var(--text-secondary)] font-medium tabular">
            {metrics.crmLeads}
          </span>{' '}
          in the CRM
        </span>
        {/* Only flagged when Meta counted more than arrived. The reverse means
            leads were backfilled from outside this period, which is fine. */}
        {missing > 0 && (
          <span className="ml-auto text-[var(--warning)]">
            Meta counted {missing} more lead{missing === 1 ? '' : 's'} than reached the CRM —
            try &ldquo;Backfill leads&rdquo; in Settings.
          </span>
        )}
      </div>
    </Card>
  );
}
