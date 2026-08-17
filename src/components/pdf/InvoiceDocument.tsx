'use client';

import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

/**
 * Branded invoice PDF (brief §06 "PDF export").
 *
 * Rendered client-side with @react-pdf/renderer, as specified in the technical
 * spec. This component deliberately uses its own literal colour values rather
 * than the app's CSS custom properties — a PDF has no stylesheet, no dark mode,
 * and must print identically everywhere.
 *
 * Company details come from Settings (brief §09 "Company profile").
 */

export interface InvoicePdfData {
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  notes: string | null;
  paymentTerms: string | null;
  company: {
    name: string;
    websiteUrl: string | null;
    contactEmail: string | null;
    /** Public URL of the logo in Supabase Storage, if uploaded. */
    logoUrl: string | null;
  };
  billTo: {
    fullName: string;
    companyName: string | null;
    email: string | null;
    location: string | null;
  };
  lineItems: {
    id: string;
    name: string;
    description: string | null;
    quantity: number;
    rate: number;
  }[];
}

const COLORS = {
  ink: '#0f172a',
  secondary: '#475569',
  muted: '#94a3b8',
  border: '#e2e8f0',
  sunken: '#f8fafc',
  brand: '#e81e5a',
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontSize: 9,
    color: COLORS.ink,
    fontFamily: 'Helvetica',
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
  },
  // `objectFit: contain` keeps a square mark and a wide lockup both undistorted
  // within the same box.
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  logo: { width: 34, height: 34, objectFit: 'contain' },
  companyName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: COLORS.ink },
  companyMeta: { fontSize: 8, color: COLORS.secondary, marginTop: 2 },

  invoiceTitle: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.brand,
    textAlign: 'right',
  },
  invoiceNumber: { fontSize: 10, color: COLORS.secondary, textAlign: 'right', marginTop: 2 },

  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  metaBlock: { flexDirection: 'column', maxWidth: '48%' },
  metaLabel: {
    fontSize: 7,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  metaValue: { fontSize: 9, color: COLORS.ink, marginBottom: 1 },
  metaValueBold: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: COLORS.ink, marginBottom: 1 },

  table: { marginTop: 4 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.sunken,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  th: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  colItem: { flex: 5 },
  colQty: { flex: 1, textAlign: 'right' },
  colRate: { flex: 1.6, textAlign: 'right' },
  colAmount: { flex: 1.8, textAlign: 'right' },

  itemName: { fontSize: 9, color: COLORS.ink },
  itemDescription: { fontSize: 7.5, color: COLORS.muted, marginTop: 1.5 },

  totals: { marginTop: 14, marginLeft: 'auto', width: 200 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalLabel: { fontSize: 9, color: COLORS.secondary },
  totalValue: { fontSize: 9, color: COLORS.ink },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 7,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: COLORS.ink,
  },
  grandTotalLabel: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  grandTotalValue: { fontSize: 11, fontFamily: 'Helvetica-Bold' },

  notes: {
    marginTop: 28,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  notesBody: { fontSize: 8.5, color: COLORS.secondary, lineHeight: 1.5 },

  footer: {
    position: 'absolute',
    bottom: 28,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 7.5,
    color: COLORS.muted,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
  },
});

/** Formats money for the PDF without relying on browser locale APIs. */
function money(amount: number, currency: string): string {
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === 'USD' ? `$${formatted}` : `${currency} ${formatted}`;
}

function formatPdfDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  return (
    <Document
      title={`Invoice ${data.invoiceNumber}`}
      author={data.company.name}
      subject={`Invoice ${data.invoiceNumber} for ${data.billTo.fullName}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            {/* Mark and name sit together: the mark alone would not identify the
                business on a printed invoice. */}
            <View style={styles.logoRow}>
              {data.company.logoUrl && (
                // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image takes no alt
                <Image style={styles.logo} src={data.company.logoUrl} />
              )}
              <Text style={styles.companyName}>{data.company.name}</Text>
            </View>
            {data.company.websiteUrl && (
              <Text style={styles.companyMeta}>{data.company.websiteUrl}</Text>
            )}
            {data.company.contactEmail && (
              <Text style={styles.companyMeta}>{data.company.contactEmail}</Text>
            )}
          </View>

          <View>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>{data.invoiceNumber}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Bill to</Text>
            <Text style={styles.metaValueBold}>{data.billTo.fullName}</Text>
            {data.billTo.companyName && (
              <Text style={styles.metaValue}>{data.billTo.companyName}</Text>
            )}
            {data.billTo.email && <Text style={styles.metaValue}>{data.billTo.email}</Text>}
            {data.billTo.location && <Text style={styles.metaValue}>{data.billTo.location}</Text>}
          </View>

          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Issue date</Text>
            <Text style={styles.metaValue}>{formatPdfDate(data.issueDate)}</Text>
            <Text style={[styles.metaLabel, { marginTop: 8 }]}>Due date</Text>
            <Text style={styles.metaValue}>{formatPdfDate(data.dueDate)}</Text>
            {data.paymentTerms && (
              <>
                <Text style={[styles.metaLabel, { marginTop: 8 }]}>Terms</Text>
                <Text style={styles.metaValue}>{data.paymentTerms}</Text>
              </>
            )}
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.colItem]}>Description</Text>
            <Text style={[styles.th, styles.colQty]}>Qty</Text>
            <Text style={[styles.th, styles.colRate]}>Rate</Text>
            <Text style={[styles.th, styles.colAmount]}>Amount</Text>
          </View>

          {data.lineItems.map((item) => (
            <View key={item.id} style={styles.tableRow} wrap={false}>
              <View style={styles.colItem}>
                <Text style={styles.itemName}>{item.name}</Text>
                {item.description && (
                  <Text style={styles.itemDescription}>{item.description}</Text>
                )}
              </View>
              <Text style={[styles.itemName, styles.colQty]}>{item.quantity}</Text>
              <Text style={[styles.itemName, styles.colRate]}>
                {money(item.rate, data.currency)}
              </Text>
              <Text style={[styles.itemName, styles.colAmount]}>
                {money(item.quantity * item.rate, data.currency)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{money(data.subtotal, data.currency)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax ({data.taxRate}%)</Text>
            <Text style={styles.totalValue}>{money(data.taxAmount, data.currency)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total</Text>
            <Text style={styles.grandTotalValue}>{money(data.total, data.currency)}</Text>
          </View>
        </View>

        {data.notes && (
          <View style={styles.notes}>
            <Text style={styles.metaLabel}>Notes</Text>
            <Text style={styles.notesBody}>{data.notes}</Text>
          </View>
        )}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${data.company.name} · Invoice ${data.invoiceNumber} · Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
