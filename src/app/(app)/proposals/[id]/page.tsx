import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { Card, CardHeader, PageHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { TableWrapper, Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { ProposalActions } from './ProposalActions';
import { formatDate, formatCurrency } from '@/lib/utils';
import type {
  ProposalWithStatus,
  ProposalLineItem,
  ProposalDisplayStatus,
} from '@/lib/supabase/database.types';
import type { ProposalPdfData } from '@/components/pdf/ProposalDocument';

export const metadata: Metadata = { title: 'Proposal' };

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<ProposalDisplayStatus, BadgeTone> = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  declined: 'neutral',
  expired: 'warning',
};

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: proposal } = await supabase
    .from('proposals_with_status')
    .select('*')
    .eq('id', id)
    .maybeSingle<ProposalWithStatus>();

  if (!proposal) notFound();

  const [{ data: items }, { data: contact }, { data: organization }] = await Promise.all([
    supabase
      .from('proposal_line_items')
      .select('*')
      .eq('proposal_id', id)
      .order('sort_order')
      .returns<ProposalLineItem[]>(),
    supabase
      .from('contacts')
      .select('id, full_name, company_name, email, city, country')
      .eq('id', proposal.contact_id)
      .maybeSingle(),
    supabase
      .from('organizations')
      .select('name, website_url, contact_email, logo_path')
      .eq('id', profile.organization_id)
      .single(),
  ]);

  // Falls back to the bundled mark when Settings has no upload, so a proposal
  // is never unbranded. Resolves against the site origin — the PDF is generated
  // in the browser.
  const logoUrl = organization?.logo_path
    ? supabase.storage.from('branding').getPublicUrl(organization.logo_path).data.publicUrl
    : '/logo-mark.png';

  const pdfData: ProposalPdfData = {
    proposalNumber: proposal.proposal_number,
    title: proposal.title,
    status: proposal.display_status,
    issueDate: proposal.issue_date,
    validUntil: proposal.valid_until,
    currency: proposal.currency,
    summary: proposal.summary,
    terms: proposal.terms,
    subtotal: proposal.subtotal,
    discountRate: proposal.discount_rate,
    discountAmount: proposal.discount_amount,
    taxRate: proposal.tax_rate,
    taxAmount: proposal.tax_amount,
    total: proposal.total,
    company: {
      name: organization?.name ?? 'Orbit Works',
      websiteUrl: organization?.website_url ?? null,
      contactEmail: organization?.contact_email ?? null,
      logoUrl,
    },
    preparedFor: {
      fullName: contact?.full_name ?? 'Unknown contact',
      companyName: contact?.company_name ?? null,
      email: contact?.email ?? null,
      location: [contact?.city, contact?.country].filter(Boolean).join(', ') || null,
    },
    lineItems: (items ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      rate: item.rate,
    })),
  };

  return (
    <>
      <PageHeader
        title={proposal.proposal_number}
        description={proposal.title}
        action={
          <Link href={`/proposals/${id}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1 flex flex-col gap-4">
          <Card>
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <span className="text-2xl font-semibold tabular">
                {formatCurrency(proposal.total, proposal.currency)}
              </span>
              <Badge tone={STATUS_TONE[proposal.display_status]}>
                {proposal.display_status.charAt(0).toUpperCase() +
                  proposal.display_status.slice(1)}
              </Badge>
            </div>
            <ProposalActions
              proposalId={id}
              currentStatus={proposal.status}
              proposalNumber={proposal.proposal_number}
              hasDeal={Boolean(proposal.deal_id)}
              pdfData={pdfData}
            />
          </Card>

          <Card>
            <CardHeader title="Details" />
            <dl className="text-sm">
              <div className="flex justify-between gap-3 py-1.5 border-b border-[var(--border-subtle)]">
                <dt className="text-[var(--text-muted)] text-xs">Issued</dt>
                <dd>{formatDate(proposal.issue_date)}</dd>
              </div>
              <div className="flex justify-between gap-3 py-1.5 border-b border-[var(--border-subtle)]">
                <dt className="text-[var(--text-muted)] text-xs">Valid until</dt>
                <dd
                  className={
                    proposal.display_status === 'expired' ? 'text-[var(--warning)]' : undefined
                  }
                >
                  {formatDate(proposal.valid_until)}
                </dd>
              </div>
              {proposal.responded_at && (
                <div className="flex justify-between gap-3 py-1.5 border-b border-[var(--border-subtle)]">
                  <dt className="text-[var(--text-muted)] text-xs">Responded</dt>
                  <dd>{formatDate(proposal.responded_at)}</dd>
                </div>
              )}
              {proposal.deal_id && (
                <div className="flex justify-between gap-3 py-1.5">
                  <dt className="text-[var(--text-muted)] text-xs">Deal</dt>
                  <dd>
                    <Link
                      href={`/deals/${proposal.deal_id}`}
                      className="text-[var(--primary)] hover:underline"
                    >
                      View deal
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Prepared for" />
            {contact ? (
              <address className="not-italic text-sm flex flex-col gap-0.5">
                <Link
                  href={`/contacts/${contact.id}`}
                  className="font-medium text-[var(--primary)] hover:underline"
                >
                  {contact.full_name}
                </Link>
                {contact.company_name && (
                  <span className="text-[var(--text-secondary)]">{contact.company_name}</span>
                )}
                {contact.email && (
                  <span className="text-[var(--text-secondary)]">{contact.email}</span>
                )}
              </address>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">Contact unavailable.</p>
            )}
          </Card>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-4">
          {proposal.summary && (
            <Card>
              <CardHeader title="Overview" />
              <p className="text-sm whitespace-pre-wrap text-[var(--text-secondary)]">
                {proposal.summary}
              </p>
            </Card>
          )}

          <TableWrapper>
            <Table>
              <THead>
                <TR>
                  <TH>Service</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Rate</TH>
                  <TH align="right">Amount</TH>
                </TR>
              </THead>
              <TBody>
                {(items ?? []).map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <span className="font-medium">{item.name}</span>
                      {item.description && (
                        <span className="block text-xs text-[var(--text-muted)]">
                          {item.description}
                        </span>
                      )}
                    </TD>
                    <TD align="right">{item.quantity}</TD>
                    <TD align="right">{formatCurrency(item.rate, proposal.currency)}</TD>
                    <TD align="right" className="font-medium">
                      {formatCurrency(item.quantity * item.rate, proposal.currency)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>

          <Card>
            <dl className="ml-auto max-w-xs flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--text-secondary)]">Subtotal</dt>
                <dd className="tabular">
                  {formatCurrency(proposal.subtotal, proposal.currency)}
                </dd>
              </div>
              {proposal.discount_rate > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--text-secondary)]">
                    Discount ({proposal.discount_rate}%)
                  </dt>
                  <dd className="tabular text-[var(--primary)]">
                    −{formatCurrency(proposal.discount_amount, proposal.currency)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--text-secondary)]">Tax ({proposal.tax_rate}%)</dt>
                <dd className="tabular">
                  {formatCurrency(proposal.tax_amount, proposal.currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-4 pt-1.5 border-t border-[var(--border-subtle)] font-semibold text-base">
                <dt>Total</dt>
                <dd className="tabular">{formatCurrency(proposal.total, proposal.currency)}</dd>
              </div>
            </dl>
          </Card>

          {proposal.terms && (
            <Card>
              <CardHeader title="Terms" />
              <p className="text-sm whitespace-pre-wrap text-[var(--text-secondary)]">
                {proposal.terms}
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
