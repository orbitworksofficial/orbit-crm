import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { Card, CardHeader, PageHeader, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, leadStatusTone, DealStatusBadge } from '@/components/ui/Badge';
import { formatDate, formatCurrency, formatDateTime } from '@/lib/utils';
import { NoteComposer } from '@/components/crm/NoteComposer';
import { Timeline } from './Timeline';
import { addContactNote } from '../actions';

export const metadata: Metadata = { title: 'Contact' };

/** Renders a labelled value, collapsing empty values to an em dash. */
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-[var(--border-subtle)] last:border-0">
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className="text-sm text-[var(--text-primary)] break-words">{value || '—'}</dd>
    </div>
  );
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: contact } = await supabase
    .from('contacts')
    .select(
      `*,
       lead_source:lead_sources(id, name),
       lead_status:lead_statuses(id, name, slug, is_won, is_lost),
       assignee:profiles!contacts_assigned_to_fkey(id, full_name),
       contact_services(service:services(id, name))`,
    )
    .eq('id', id)
    .maybeSingle();

  // A row hidden by RLS is indistinguishable from one that does not exist,
  // which is the correct behaviour — a sales user must not be able to probe
  // for the existence of contacts they do not own.
  if (!contact) notFound();

  const [{ data: deals }, { data: notes }, { data: activity }] = await Promise.all([
    supabase
      .from('deals')
      .select('id, title, value, currency, status, expected_close_date')
      .eq('contact_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('notes')
      .select('*, author:profiles(id, full_name)')
      .eq('contact_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('activity_log')
      .select('*, actor:profiles(id, full_name)')
      .eq('contact_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const services =
    (contact.contact_services as { service: { id: string; name: string } | null }[] | null)
      ?.map((row) => row.service)
      .filter((service): service is { id: string; name: string } => Boolean(service)) ?? [];

  const canEdit = profile.role === 'admin' || contact.assigned_to === profile.id;

  return (
    <>
      <PageHeader
        title={contact.full_name}
        description={contact.company_name ?? undefined}
        action={
          canEdit ? (
            <Link href={`/contacts/${id}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* --- Left column: details --- */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          <Card>
            <CardHeader title="Details" />
            <dl>
              <DetailRow
                label="Status"
                value={
                  contact.lead_status ? (
                    <Badge tone={leadStatusTone(contact.lead_status)}>
                      {contact.lead_status.name}
                    </Badge>
                  ) : null
                }
              />
              <DetailRow label="Source" value={contact.lead_source?.name} />
              <DetailRow
                label="Email"
                value={
                  contact.email ? (
                    <a
                      href={`mailto:${contact.email}`}
                      className="text-[var(--primary)] hover:underline"
                    >
                      {contact.email}
                    </a>
                  ) : null
                }
              />
              <DetailRow
                label="WhatsApp"
                value={
                  contact.whatsapp_number ? (
                    <a
                      href={`https://wa.me/${contact.whatsapp_number.replace(/[^\d]/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--primary)] hover:underline"
                    >
                      {contact.whatsapp_number}
                    </a>
                  ) : null
                }
              />
              <DetailRow label="Industry" value={contact.industry} />
              <DetailRow
                label="Location"
                value={[contact.city, contact.country].filter(Boolean).join(', ')}
              />
              <DetailRow label="Owner" value={contact.assignee?.full_name} />
              <DetailRow label="Created" value={formatDateTime(contact.created_at)} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Service interest" />
            {services.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No services tagged.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {services.map((service) => (
                  <Badge key={service.id} tone="accent">
                    {service.name}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* --- Right column: deals, notes, activity --- */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Deals"
              description={`${deals?.length ?? 0} linked to this contact`}
              action={
                <Link href={`/deals/new?contact=${id}`}>
                  <Button size="sm" variant="secondary">
                    New deal
                  </Button>
                </Link>
              }
            />
            {!deals || deals.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No deals yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
                {deals.map((deal) => (
                  <li key={deal.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/deals/${deal.id}`}
                          className="text-sm font-medium hover:text-[var(--primary)] transition-colors"
                        >
                          {deal.title}
                        </Link>
                        {deal.expected_close_date && (
                          <p className="text-xs text-[var(--text-muted)]">
                            Expected {formatDate(deal.expected_close_date)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm tabular">
                          {formatCurrency(deal.value, deal.currency)}
                        </span>
                        <DealStatusBadge status={deal.status} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Add a note" />
            <NoteComposer recordId={id} action={addContactNote} />
          </Card>

          <Card>
            <CardHeader title="Activity" description="Notes and status changes, newest first." />
            {(notes?.length ?? 0) === 0 && (activity?.length ?? 0) === 0 ? (
              <EmptyState
                title="No activity yet"
                description="Notes and status changes will appear here."
              />
            ) : (
              <Timeline notes={notes ?? []} activity={activity ?? []} />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
