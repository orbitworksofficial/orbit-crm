'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { InvoicePdfData } from '@/components/pdf/InvoiceDocument';

/**
 * PDF download for a client viewing their own invoice.
 *
 * Download only — a client must never change an invoice's status, so none of
 * the staff actions appear here.
 */
export function InvoiceActions({
  invoiceNumber,
  pdfData,
}: {
  invoiceNumber: string;
  pdfData: InvoicePdfData;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadPdf() {
    setIsGenerating(true);
    setError(null);
    try {
      // Imported at click time: the PDF library is large, and most visits never
      // download anything.
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
      <Button size="sm" onClick={downloadPdf} loading={isGenerating} fullWidth>
        Download PDF
      </Button>
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
