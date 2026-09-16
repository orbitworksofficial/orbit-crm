import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { PageHeader, EmptyState, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LiveIndicator } from '@/components/realtime/LiveIndicator';
import { KanbanBoard, type BoardDeal } from './KanbanBoard';
import { formatCurrency } from '@/lib/utils';
import type { PipelineStage } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Pipeline' };

// The board reflects live deal movement, so it is never cached.
export const dynamic = 'force-dynamic';

/**
 * Visual Kanban pipeline (Phase 2).
 *
 * Complements the Deals table rather than replacing it: the table is better for
 * filtering and sorting, the board for seeing where work actually sits. Both
 * read the same rows.
 *
 * RLS applies as everywhere else, so a sales user sees only their own deals on
 * the board.
 */
export default async function PipelinePage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [stagesResult, dealsResult] = await Promise.all([
    supabase
      .from('pipeline_stages')
      .select('*')
      .eq('is_active', true)
      .order('position')
      .returns<PipelineStage[]>(),
    supabase
      .from('deals')
      .select(
        `id, title, value, currency, stage_id, board_position, expected_close_date,
         contact:contacts!deals_contact_id_fkey(id, full_name, company_name),
         assignee:profiles!deals_assigned_to_fkey(id, full_name)`,
      )
      .order('board_position', { nullsFirst: false })
      .returns<BoardDeal[]>(),
  ]);

  const stages = stagesResult.data ?? [];
  const deals = dealsResult.data ?? [];

  const openValue = deals
    .filter((d) => {
      const stage = stages.find((s) => s.id === d.stage_id);
      return stage?.maps_to_status === 'open';
    })
    .reduce((sum, d) => sum + Number(d.value), 0);

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={
          profile.role === 'admin'
            ? 'Drag deals between stages to update them.'
            : 'Your deals. Drag between stages to update them.'
        }
        action={
          <>
            <LiveIndicator tables={['deals']} className="mr-1" />
            <Link href="/deals/new">
              <Button>New deal</Button>
            </Link>
          </>
        }
      />

      {stages.length === 0 ? (
        <EmptyState
          title="No pipeline stages configured"
          description="An administrator can add stages in Settings."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 mb-4">
            <Card>
              <p className="text-xs text-[var(--text-muted)]">Deals on the board</p>
              <p className="text-xl font-semibold tabular mt-1">{deals.length}</p>
            </Card>
            <Card>
              <p className="text-xs text-[var(--text-muted)]">Open pipeline value</p>
              <p className="text-xl font-semibold tabular mt-1 text-[var(--info)]">
                {formatCurrency(openValue)}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-[var(--text-muted)]">Stages</p>
              <p className="text-xl font-semibold tabular mt-1">{stages.length}</p>
            </Card>
          </div>

          <KanbanBoard stages={stages} deals={deals} />
        </>
      )}
    </>
  );
}
