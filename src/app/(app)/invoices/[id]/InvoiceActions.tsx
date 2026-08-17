'use client';

import { useTransition, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { setInvoiceStatus } from '../actions';
import type { InvoiceStatus } from '@/lib/supabase/database.types';
import type { InvoicePdfData } from '@/components/pdf/InvoiceDocument';

/**
 * Status controls and PDF download for an invoice.
 *
 * @react-pdf/renderer pulls in a large bundle, so it is imported dynamically at
 * click time rather than shipped with the page. That keeps the invoice view
 * fast for the common case where nobody downloads anything.
 */
export function InvoiceActions({
  invoiceId,
  currentStatus,
  invoiceNumber,
  pdfData,
}: {
  invoiceId: string;
  currentStatus: InvoiceStatus;
  invoiceNumber: string;
  pdfData: InvoicePdfData;
}) {
  const [isPending, startTransition] = useTransition();
  const [isGenerating, setIsGenerating] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  function change(status: InvoiceStatus) {
    startTransition(async () => {
      await setInvoiceStatus(invoiceId, status);
    });
  }

  async function downloadPdf() {
    setIsGenerating(true);
    setPdfError(null);
    try {
      // Dynamic import keeps ~500KB of PDF machinery out of the initial bundle.
      const [{ pdf }, { InvoiceDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/pdf/InvoiceDocument'),
      ]);

      const blob = await pdf(<InvoiceDocument data={pdfData} />).toBlob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Release the blob once the download has been handed to the browser.
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('PDF generation failed:', error);
      setPdfError('Could not generate the PDF. Please try again.');
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
        {currentStatus !== 'paid' && currentStatus !== 'void' && (
          <Button size="sm" onClick={() => change('paid')} disabled={isPending}>
            Mark paid
          </Button>
        )}
        {currentStatus === 'paid' && (
          <Button size="sm" variant="secondary" onClick={() => change('sent')} disabled={isPending}>
            Mark unpaid
          </Button>
        )}
        {currentStatus !== 'void' && (
          <Button size="sm" variant="ghost" onClick={() => change('void')} disabled={isPending}>
            Void
          </Button>
        )}
      </div>

      <Button
        size="sm"
        variant="secondary"
        onClick={downloadPdf}
        loading={isGenerating}
        fullWidth
      >
        Download PDF
      </Button>

      {pdfError && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {pdfError}
        </p>
      )}
    </div>
  );
}
