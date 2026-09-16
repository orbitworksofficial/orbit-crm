'use client';

import { useState, useOptimistic, startTransition } from 'react';
import Link from 'next/link';
import { moveDealToStage } from '../deals/actions';
import { formatCurrency, formatDate, getInitials, cn } from '@/lib/utils';
import type { PipelineStage, StageColor } from '@/lib/supabase/database.types';

/**
 * Drag-and-drop deal board (Phase 2: "Visual Kanban Pipeline").
 *
 * Built on native HTML5 drag-and-drop rather than a library: the board needs
 * drag, drop, and a drop indicator, which the platform provides directly. A
 * drag-and-drop library would add ~40KB for behaviour already in the browser.
 *
 * Moves apply optimistically — the card lands where you dropped it immediately,
 * and the server reconciles behind it. A board where cards visibly snap back
 * for a moment before settling feels broken even when it is working.
 *
 * Colour here is *state*, not series identity: each column wears the token its
 * stage declares, so "Closed Won" is green in both themes and a renamed stage
 * keeps its meaning.
 */

export interface BoardDeal {
  id: string;
  title: string;
  value: number;
  currency: string;
  stage_id: string | null;
  board_position: number | null;
  expected_close_date: string | null;
  contact: { id: string; full_name: string; company_name: string | null } | null;
  assignee: { id: string; full_name: string } | null;
}

const COLUMN_ACCENT: Record<StageColor, string> = {
  blue: 'var(--chart-1)',
  pink: 'var(--accent-pink)',
  amber: 'var(--chart-3)',
  green: 'var(--chart-4)',
  neutral: 'var(--text-muted)',
};

function DealCard({
  deal,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  deal: BoardDeal;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <article
      draggable
      onDragStart={(event) => {
        // Firefox will not start a drag without data set on the transfer.
        event.dataTransfer.setData('text/plain', deal.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3',
        'cursor-grab active:cursor-grabbing transition-shadow',
        'hover:border-[var(--border-strong)] hover:shadow-sm',
        isDragging && 'opacity-40',
      )}
    >
      <Link
        href={`/deals/${deal.id}`}
        className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--primary)] transition-colors line-clamp-2"
        // The card is draggable; the link inside must not start its own drag.
        draggable={false}
      >
        {deal.title}
      </Link>

      {deal.contact && (
        <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
          {deal.contact.company_name ?? deal.contact.full_name}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 mt-2.5">
        <span className="text-sm font-semibold tabular text-[var(--text-primary)]">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {deal.assignee && (
          <span
            className="size-6 rounded-full bg-[var(--surface-sunken)] border border-[var(--border-subtle)] flex items-center justify-center text-[10px] font-semibold text-[var(--text-secondary)] shrink-0"
            title={deal.assignee.full_name}
          >
            {getInitials(deal.assignee.full_name)}
          </span>
        )}
      </div>

      {deal.expected_close_date && (
        <p className="text-xs text-[var(--text-muted)] mt-1.5">
          Expected {formatDate(deal.expected_close_date)}
        </p>
      )}
    </article>
  );
}

export function KanbanBoard({
  stages,
  deals,
}: {
  stages: PipelineStage[];
  deals: BoardDeal[];
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Optimistic moves keep the card under the cursor where the user dropped it
  // while the server round trip completes.
  const [optimisticDeals, applyMove] = useOptimistic(
    deals,
    (current: BoardDeal[], move: { dealId: string; stageId: string }) =>
      current.map((d) =>
        d.id === move.dealId ? { ...d, stage_id: move.stageId } : d,
      ),
  );

  const byStage = (stageId: string) =>
    optimisticDeals
      .filter((d) => d.stage_id === stageId)
      .sort((a, b) => (a.board_position ?? 0) - (b.board_position ?? 0));

  function handleDrop(stageId: string) {
    const dealId = dragging;
    setDragging(null);
    setDropTarget(null);
    if (!dealId) return;

    const deal = optimisticDeals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === stageId) return;

    const column = byStage(stageId);
    const last = column[column.length - 1];

    startTransition(async () => {
      applyMove({ dealId, stageId });
      await moveDealToStage(dealId, stageId, last?.board_position ?? null, null);
    });
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
      {stages.map((stage) => {
        const column = byStage(stage.id);
        const columnValue = column.reduce((sum, d) => sum + Number(d.value), 0);
        const isTarget = dropTarget === stage.id;

        return (
          <section
            key={stage.id}
            onDragOver={(event) => {
              // Required for the element to be a valid drop target.
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (dropTarget !== stage.id) setDropTarget(stage.id);
            }}
            onDragLeave={(event) => {
              // Ignore bubbling from children, or the highlight flickers.
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDropTarget((current) => (current === stage.id ? null : current));
              }
            }}
            onDrop={() => handleDrop(stage.id)}
            className={cn(
              'flex flex-col shrink-0 w-[260px] rounded-xl transition-colors',
              'bg-[var(--surface-sunken)] border',
              isTarget
                ? 'border-[var(--primary)] bg-[var(--surface-overlay)]'
                : 'border-transparent',
            )}
            aria-label={`${stage.name} column`}
          >
            <header className="px-3 pt-3 pb-2 sticky top-0">
              <div className="flex items-center gap-2">
                {/* Colour marks the stage; the name carries the identity. */}
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ backgroundColor: COLUMN_ACCENT[stage.color] }}
                  aria-hidden="true"
                />
                <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                  {stage.name}
                </h2>
                <span className="text-xs text-[var(--text-muted)] tabular ml-auto">
                  {column.length}
                </span>
              </div>
              {columnValue > 0 && (
                <p className="text-xs text-[var(--text-secondary)] tabular mt-0.5 pl-4">
                  {formatCurrency(columnValue)}
                </p>
              )}
            </header>

            <div className="flex flex-col gap-2 p-2 min-h-[120px]">
              {column.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] text-center py-6">
                  {isTarget ? 'Drop here' : 'No deals'}
                </p>
              ) : (
                column.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    isDragging={dragging === deal.id}
                    onDragStart={() => setDragging(deal.id)}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropTarget(null);
                    }}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
