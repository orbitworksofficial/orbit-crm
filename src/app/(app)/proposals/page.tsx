import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { PageHeader, EmptyState, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { TableWrapper, Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { formatDate, formatCurrency } from '@/lib/utils';
import type { ProposalWithStatus, ProposalDisplayStatus } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Proposals' };

// Expiry is derived from today's date, so this page must never be cached.
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<ProposalDisplayStatus, BadgeTone> = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  declined: 'neutral',
  expired: 'warning',
};

/**
 * Proposals list (Phase 2: "Proposals and Quotes").
 *
 * Reads `proposals_with_status`, so "expired" and the money totals are computed
 * in Postgres rather than re-derived here.
 */
export default async function ProposalsPage() {
  await requireProfile();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('proposals_with_status')
    .select('*')
    .order('issue_date', { ascending: false })
    .returns<ProposalWithStatus[]>();

  const proposals = data ?? [];

  // Contact names in one follow-up query — the view carries no relationship
  // metadata to embed through.
  const contactIds = [...new Set(proposals.map((p) => p.contact_id))];
  const { data: contacts } = contactIds.length
    ? await supabase.from('contacts').select('id, full_name, company_name').in('id', contactIds)
    : { data: [] };
  const contactsById = new Map((contacts ?? []).map((c) => [c.id, c]));

  const accepted = proposals.filter((p) => p.display_status === 'accepted');
  const outstanding = proposals.filter((p) => p.display_status === 'sent');

  return (
    <>
      <PageHeader
        title="Proposals"
        description="Branded quotes sent to prospects."
        action={
          <Link href="/proposals/new">
            <Button>New proposal</Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Proposals</p>
          <p className="text-xl font-semibold tabular mt-1">{proposals.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Awaiting response</p>
          <p className="text-xl font-semibold tabular mt-1 text-[var(--info)]">
            {formatCurrency(outstanding.reduce((s, p) => s + Number(p.total), 0))}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Accepted</p>
          <p className="text-xl font-semibold tabular mt-1 text-[var(--success)]">
            {formatCurrency(accepted.reduce((s, p) => s + Number(p.total), 0))}
          </p>
        </Card>
      </div>

      {error ? (
        <EmptyState title="Could not load proposals" description={error.message} />
      ) : proposals.length === 0 ? (
        <EmptyState
          title="No proposals yet"
          description="Create a branded quote from your service catalogue."
          action={
            <Link href="/proposals/new">
              <Button>New proposal</Button>
            </Link>
          }
        />
      ) : (
        <TableWrapper>
          <Table>
            <THead>
              <TR>
                <TH>Number</TH>
                <TH>Title</TH>
                <TH>Contact</TH>
                <TH>Status</TH>
                <TH>Valid until</TH>
                <TH align="right">Total</TH>
              </TR>
            </THead>
            <TBody>
              {proposals.map((proposal) => {
                const contact = contactsById.get(proposal.contact_id);
                return (
                  <TR key={proposal.id}>
                    <TD>
                      <Link
                        href={`/proposals/${proposal.id}`}
                        className="font-medium hover:text-[var(--primary)] transition-colors tabular"
                      >
                        {proposal.proposal_number}
                      </Link>
                    </TD>
                    <TD className="text-[var(--text-secondary)]">{proposal.title}</TD>
                    <TD className="text-[var(--text-secondary)]">
                      {contact?.full_name ?? '—'}
                      {contact?.company_name && (
                        <span className="text-[var(--text-muted)] text-xs block">
                          {contact.company_name}
                        </span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={STATUS_TONE[proposal.display_status]}>
                        {proposal.display_status.charAt(0).toUpperCase() +
                          proposal.display_status.slice(1)}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
                      {formatDate(proposal.valid_until)}
                    </TD>
                    <TD align="right" className="font-medium whitespace-nowrap">
                      {formatCurrency(proposal.total, proposal.currency)}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableWrapper>
      )}
    </>
  );
}
