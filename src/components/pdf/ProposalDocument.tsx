'use client';

import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

/**
 * Branded proposal PDF (Phase 2: "Proposals and Quotes").
 *
 * Shares the invoice PDF's visual language deliberately — same typography,
 * same table anatomy, same footer — so a client who receives a quote and later
 * an invoice sees one consistent set of documents rather than two designs.
 *
 * Where it departs: a proposal leads with the pitch, so the summary sits above
 * the pricing table; the expiry is given prominence, since that is the whole
 * function of a quote; and terms close the document.
 *
 * Colour values are literal rather than CSS tokens: a PDF has no stylesheet and
 * no dark mode, and must print identically everywhere.
 */

export interface ProposalPdfData {
  proposalNumber: string;
  title: string;
  status: string;
  issueDate: string;
  validUntil: string;
  currency: string;
  summary: string | null;
  terms: string | null;
  subtotal: number;
  discountRate: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  company: {
    name: string;
    websiteUrl: string | null;
    contactEmail: string | null;
    logoUrl: string | null;
  };
  preparedFor: {
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
    marginBottom: 24,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  logo: { width: 34, height: 34, objectFit: 'contain' },
  companyName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: COLORS.ink },
  companyMeta: { fontSize: 8, color: COLORS.secondary, marginTop: 2 },

  docTitle: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.brand,
    textAlign: 'right',
  },
  docNumber: { fontSize: 10, color: COLORS.secondary, textAlign: 'right', marginTop: 2 },

  proposalTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 14,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  metaBlock: { flexDirection: 'column', maxWidth: '48%' },
  metaLabel: {
    fontSize: 7,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  metaValue: { fontSize: 9, color: COLORS.ink, marginBottom: 1 },
  metaValueBold: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 1 },

  // The expiry is the point of a quote, so it gets a tinted panel rather than
  // sitting as one more line of metadata.
  validityBox: {
    backgroundColor: COLORS.sunken,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.brand,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 18,
  },
  validityText: { fontSize: 9, color: COLORS.secondary },
  validityDate: { fontFamily: 'Helvetica-Bold', color: COLORS.ink },

  summary: { marginBottom: 18 },
  summaryBody: { fontSize: 9, color: COLORS.secondary, lineHeight: 1.6 },

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

  totals: { marginTop: 14, marginLeft: 'auto', width: 210 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalLabel: { fontSize: 9, color: COLORS.secondary },
  totalValue: { fontSize: 9, color: COLORS.ink },
  discountValue: { fontSize: 9, color: COLORS.brand },
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

  terms: {
    marginTop: 26,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  termsBody: { fontSize: 8, color: COLORS.secondary, lineHeight: 1.5 },

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

export function ProposalDocument({ data }: { data: ProposalPdfData }) {
  return (
    <Document
      title={`Proposal ${data.proposalNumber}`}
      author={data.company.name}
      subject={`${data.title} — prepared for ${data.preparedFor.fullName}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
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
            <Text style={styles.docTitle}>PROPOSAL</Text>
            <Text style={styles.docNumber}>{data.proposalNumber}</Text>
          </View>
        </View>

        <Text style={styles.proposalTitle}>{data.title}</Text>

        <View style={styles.metaRow}>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Prepared for</Text>
            <Text style={styles.metaValueBold}>{data.preparedFor.fullName}</Text>
            {data.preparedFor.companyName && (
              <Text style={styles.metaValue}>{data.preparedFor.companyName}</Text>
            )}
            {data.preparedFor.email && (
              <Text style={styles.metaValue}>{data.preparedFor.email}</Text>
            )}
            {data.preparedFor.location && (
              <Text style={styles.metaValue}>{data.preparedFor.location}</Text>
            )}
          </View>

          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Date</Text>
            <Text style={styles.metaValue}>{formatPdfDate(data.issueDate)}</Text>
          </View>
        </View>

        <View style={styles.validityBox}>
          <Text style={styles.validityText}>
            This proposal is valid until{' '}
            <Text style={styles.validityDate}>{formatPdfDate(data.validUntil)}</Text>.
          </Text>
        </View>

        {data.summary && (
          <View style={styles.summary}>
            <Text style={styles.metaLabel}>Overview</Text>
            <Text style={styles.summaryBody}>{data.summary}</Text>
          </View>
        )}

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.colItem]}>Service</Text>
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

          {/* Only shown when there is one — a "Discount 0%" line reads as an
              oversight on a document meant to persuade. */}
          {data.discountRate > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount ({data.discountRate}%)</Text>
              <Text style={styles.discountValue}>
                −{money(data.discountAmount, data.currency)}
              </Text>
            </View>
          )}

          {data.taxRate > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax ({data.taxRate}%)</Text>
              <Text style={styles.totalValue}>{money(data.taxAmount, data.currency)}</Text>
            </View>
          )}

          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total</Text>
            <Text style={styles.grandTotalValue}>{money(data.total, data.currency)}</Text>
          </View>
        </View>

        {data.terms && (
          <View style={styles.terms}>
            <Text style={styles.metaLabel}>Terms</Text>
            <Text style={styles.termsBody}>{data.terms}</Text>
          </View>
        )}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${data.company.name} · Proposal ${data.proposalNumber} · Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
