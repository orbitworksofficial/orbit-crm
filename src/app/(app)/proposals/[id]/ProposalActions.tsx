'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { setProposalStatus, convertProposalToDeal } from '../actions';
import type { ProposalStatus } from '@/lib/supabase/database.types';
import type { ProposalPdfData } from '@/components/pdf/ProposalDocument';

/**
 * Status controls, PDF download, and deal conversion for one proposal.
 *
 * @react-pdf/renderer is imported at click time rather than shipped with the
 * page — it is a large dependency, and most page views never download anything.
 */
export function ProposalActions({
  proposalId,
  currentStatus,
  proposalNumber,
  hasDeal,
  pdfData,
}: {
  proposalId: string;
  currentStatus: ProposalStatus;
  proposalNumber: string;
  hasDeal: boolean;
  pdfData: ProposalPdfData;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function change(status: ProposalStatus) {
    startTransition(async () => {
      await setProposalStatus(proposalId, status);
    });
  }

  function convert() {
    startTransition(async () => {
      setError(null);
      const result = await convertProposalToDeal(proposalId);
      if (result.error) setError(result.error);
      else if (result.dealId) router.push(`/deals/${result.dealId}`);
    });
  }

  async function downloadPdf() {
    setIsGenerating(true);
    setError(null);
    try {
      const [{ pdf }, { ProposalDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/pdf/ProposalDocument'),
      ]);

      const blob = await pdf(<ProposalDocument data={pdfData} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${proposalNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (caught) {
      console.error('PDF generation failed:', caught);
      setError('Could not generate the PDF. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {currentStatus === 'draft' && (
          <Button size="sm" onClick={() => change('sent')} disabled={isPending}>
            Mark sent
          </Button>
        )}
        {currentStatus === 'sent' && (
          <>
            <Button size="sm" onClick={() => change('accepted')} disabled={isPending}>
              Accepted
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => change('declined')}
              disabled={isPending}
            >
              Declined
            </Button>
          </>
        )}
        {(currentStatus === 'accepted' || currentStatus === 'declined') && (
          <Button size="sm" variant="ghost" onClick={() => change('sent')} disabled={isPending}>
            Reopen
          </Button>
        )}
      </div>

      <Button size="sm" variant="secondary" onClick={downloadPdf} loading={isGenerating} fullWidth>
        Download PDF
      </Button>

      {/* Converting is only offered once the client has actually agreed, and
          only when no deal exists yet — the action is idempotent regardless. */}
      {currentStatus === 'accepted' && !hasDeal && (
        <Button size="sm" onClick={convert} disabled={isPending} fullWidth>
          Create deal from this proposal
        </Button>
      )}

      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
