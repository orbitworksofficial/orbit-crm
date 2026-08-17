import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { DealStatus, InvoiceDisplayStatus } from '@/lib/supabase/database.types';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--neutral-bg)] text-[var(--neutral)]',
  info: 'bg-[var(--info-bg)] text-[var(--info)]',
  success: 'bg-[var(--success-bg)] text-[var(--success)]',
  warning: 'bg-[var(--warning-bg)] text-[var(--warning)]',
  danger: 'bg-[var(--danger-bg)] text-[var(--danger)]',
  accent: 'bg-[var(--info-bg)] text-[var(--accent-blue)]',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Maps a lead status slug to a badge tone.
 *
 * Falls back to the is_won/is_lost flags rather than matching names, so admins
 * can add or rename statuses in Settings without breaking the colour coding.
 */
export function leadStatusTone(status: {
  slug?: string;
  is_won?: boolean;
  is_lost?: boolean;
} | null): BadgeTone {
  if (!status) return 'neutral';
  if (status.is_won) return 'success';
  if (status.is_lost) return 'danger';

  switch (status.slug) {
    case 'new':
      return 'info';
    case 'contacted':
    case 'in_discussion':
      return 'accent';
    case 'proposal_sent':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function DealStatusBadge({ status }: { status: DealStatus }) {
  const tone: BadgeTone =
    status === 'won' ? 'success' : status === 'lost' ? 'danger' : 'info';
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <Badge tone={tone}>{label}</Badge>;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceDisplayStatus }) {
  const TONE_BY_STATUS: Record<InvoiceDisplayStatus, BadgeTone> = {
    draft: 'neutral',
    sent: 'info',
    paid: 'success',
    overdue: 'danger',
    void: 'neutral',
  };
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <Badge tone={TONE_BY_STATUS[status]}>{label}</Badge>;
}
