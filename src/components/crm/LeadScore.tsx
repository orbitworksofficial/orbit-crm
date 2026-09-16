import { cn } from '@/lib/utils';
import type { LeadScore } from '@/lib/supabase/database.types';

/**
 * Lead score display (Phase 2: "Lead Scoring").
 *
 * The score is a weighted rule set, not a learned model — see the migration for
 * why. That has one consequence for the UI: because the reasoning is knowable,
 * it should be shown. A number nobody can interrogate gets ignored or, worse,
 * trusted when it should not be.
 *
 * Bands rather than a raw number alone: "82" means little on its own, but
 * "Hot" against a scale is immediately actionable.
 */

export type ScoreBand = 'hot' | 'warm' | 'cool' | 'cold' | 'closed';

export function bandOf(score: number, isClosed = false): ScoreBand {
  if (isClosed) return 'closed';
  if (score >= 75) return 'hot';
  if (score >= 55) return 'warm';
  if (score >= 35) return 'cool';
  return 'cold';
}

const BAND_LABEL: Record<ScoreBand, string> = {
  hot: 'Hot',
  warm: 'Warm',
  cool: 'Cool',
  cold: 'Cold',
  closed: 'Closed',
};

// Status-style colours: this encodes a state, not a series identity, so it uses
// the semantic scale rather than the categorical chart hues.
const BAND_COLOR: Record<ScoreBand, string> = {
  hot: 'var(--danger)',
  warm: 'var(--warning)',
  cool: 'var(--info)',
  cold: 'var(--text-muted)',
  closed: 'var(--text-muted)',
};

/** Compact score for a table cell. */
export function ScorePill({
  score,
  isClosed = false,
  className,
}: {
  score: number;
  isClosed?: boolean;
  className?: string;
}) {
  const band = bandOf(score, isClosed);

  if (band === 'closed') {
    return <span className={cn('text-xs text-[var(--text-muted)]', className)}>—</span>;
  }

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {/* A short bar makes relative scores scannable down a column in a way a
          bare number is not. */}
      <span className="w-8 h-1.5 rounded-full bg-[var(--chart-track)] overflow-hidden shrink-0">
        <span
          className="block h-full rounded-full"
          style={{ width: `${score}%`, backgroundColor: BAND_COLOR[band] }}
        />
      </span>
      <span className="text-xs font-medium tabular text-[var(--text-primary)]">{score}</span>
    </span>
  );
}

/**
 * Full breakdown for the contact detail page.
 *
 * Lists every contributing factor with its points, so the reasoning can be
 * checked and argued with. If a score looks wrong, this is where you find out
 * why — and whether the weights need tuning.
 */
export function ScoreBreakdown({
  score,
  maxima,
}: {
  score: LeadScore;
  /** Configured weights, so each row can read "18 of 30". */
  maxima: {
    source: number;
    engagement: number;
    service: number;
    recency: number;
    completeness: number;
  };
}) {
  const isClosed = Boolean(score.is_won || score.is_lost);
  const band = bandOf(score.score, isClosed);

  const factors = [
    {
      label: 'Lead source',
      value: score.score_source,
      max: maxima.source,
      hint: 'Referrals and inbound enquiries convert better than cold outreach.',
    },
    {
      label: 'Engagement',
      value: score.score_engagement,
      max: maxima.engagement,
      hint: 'Notes recorded, deals opened, and how far through the pipeline they are.',
    },
    {
      label: 'Service interest',
      value: score.score_service,
      max: maxima.service,
      hint: 'A lead who named what they want is further along.',
    },
    {
      label: 'Recency',
      value: score.score_recency,
      max: maxima.recency,
      hint: 'Full marks within a week, fading to nothing after 60 days.',
    },
    {
      label: 'Contact details',
      value: score.score_completeness,
      max: maxima.completeness,
      hint: 'Email, phone, company, and industry all present.',
    },
  ];

  if (isClosed) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        This lead is {score.is_won ? 'won' : 'lost'}, so it is not scored — the score answers
        &ldquo;who should I call next&rdquo;, and a closed lead is not an answer.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span
          className="text-3xl font-semibold tabular"
          style={{ color: BAND_COLOR[band] }}
        >
          {score.score}
        </span>
        <span className="text-sm text-[var(--text-secondary)]">
          / 100 · {BAND_LABEL[band]}
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {factors.map((factor) => (
          <li key={factor.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-[var(--text-secondary)]">{factor.label}</span>
              <span className="tabular text-[var(--text-primary)]">
                {factor.value}
                <span className="text-[var(--text-muted)]"> / {factor.max}</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--chart-track)] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${factor.max > 0 ? (factor.value / factor.max) * 100 : 0}%`,
                  backgroundColor: 'var(--chart-1)',
                }}
                aria-hidden="true"
              />
            </div>
            <p className="text-xs text-[var(--text-muted)]">{factor.hint}</p>
          </li>
        ))}
      </ul>

      <p className="text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border-subtle)]">
        Scored from weighted rules, not a trained model — there is not yet enough
        outcome history to learn from. The weights are tunable, and can be fitted to
        real results once a few hundred leads have closed.
      </p>
    </div>
  );
}
