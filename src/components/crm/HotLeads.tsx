import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui/Card';
import { ScorePill } from './LeadScore';
import { formatRelative } from '@/lib/utils';

/**
 * The highest-scoring open leads, for the dashboard.
 *
 * Answers the one question a dashboard should answer before any chart: who
 * should I call today. Closed leads are excluded by the scoring view itself,
 * so everything here is actionable by construction.
 */

export interface HotLead {
  id: string;
  fullName: string;
  companyName: string | null;
  statusName: string | null;
  score: number;
  createdAt: string;
}

export function HotLeads({ leads }: { leads: HotLead[] }) {
  return (
    <Card>
      <CardHeader
        title="Leads to chase"
        description="Highest-scoring open leads."
        action={
          <Link
            href="/contacts"
            className="text-xs text-[var(--primary)] hover:underline font-medium"
          >
            All contacts
          </Link>
        }
      />

      {leads.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          No open leads to score yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
          {leads.map((lead) => (
            <li key={lead.id} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/contacts/${lead.id}`}
                    className="text-sm font-medium hover:text-[var(--primary)] transition-colors"
                  >
                    {lead.fullName}
                  </Link>
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {lead.companyName ?? 'No company'}
                    {lead.statusName && ` · ${lead.statusName}`}
                    {' · '}
                    {formatRelative(lead.createdAt)}
                  </p>
                </div>
                <ScorePill score={lead.score} className="shrink-0" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
