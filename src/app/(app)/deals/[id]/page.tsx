import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { Card, CardHeader, PageHeader, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, DealStatusBadge } from '@/components/ui/Badge';
import { formatDate, formatCurrency, formatDateTime, getInitials } from '@/lib/utils';
import { NoteComposer } from '@/components/crm/NoteComposer';
import { StatusActions } from './StatusActions';
import { addDealNote } from '../actions';

export const metadata: Metadata = { title: 'Deal' };

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-[var(--border-subtle)] last:border-0">
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className="text-sm text-[var(--text-primary)] break-words">{value || '—'}</dd>
    </div>
  );
}

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: deal } = await supabase
    .from('deals')
    .select(
      `*,
       contact:contacts!deals_contact_id_fkey(id, full_name, company_name, email),
       assignee:profiles!deals_assigned_to_fkey(id, full_name),
       deal_services(service:services(id, name))`,
    )
    .eq('id', id)
    .maybeSingle();

  if (!deal) notFound();

  const { data: notes } = await supabase
    .from('notes')
    .select('*, author:profiles(id, full_name)')
    .eq('deal_id', id)
    .order('created_at', { ascending: false });

  const services =
    (deal.deal_services as { service: { id: string; name: string } | null }[] | null)
      ?.map((row) => row.service)
      .filter((service): service is { id: string; name: string } => Boolean(service)) ?? [];

  const canEdit = profile.role === 'admin' || deal.assigned_to === profile.id;

  return (
    <>
      <PageHeader
        title={deal.title}
        description={deal.contact?.full_name ?? undefined}
        action={
          canEdit ? (
            <Link href={`/deals/${id}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1 flex flex-col gap-4">
          <Card>
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <span className="text-2xl font-semibold tabular">
                {formatCurrency(deal.value, deal.currency)}
              </span>
              <DealStatusBadge status={deal.status} />
            </div>
            {canEdit && <StatusActions dealId={id} currentStatus={deal.status} />}
          </Card>

          <Card>
            <CardHeader title="Details" />
            <dl>
              <DetailRow
                label="Contact"
                value={
                  deal.contact ? (
                    <Link
                      href={`/contacts/${deal.contact.id}`}
                      className="text-[var(--primary)] hover:underline"
                    >
                      {deal.contact.full_name}
                    </Link>
                  ) : null
                }
              />
              <DetailRow label="Company" value={deal.contact?.company_name} />
              <DetailRow label="Owner" value={deal.assignee?.full_name} />
              <DetailRow
                label="Expected close"
                value={formatDate(deal.expected_close_date)}
              />
              {deal.closed_at && (
                <DetailRow label="Closed" value={formatDateTime(deal.closed_at)} />
              )}
              <DetailRow label="Created" value={formatDateTime(deal.created_at)} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Services in scope" />
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

        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card>
            <CardHeader title="Add a note" description="Notes here are specific to this deal." />
            <NoteComposer
              recordId={id}
              action={addDealNote}
              placeholder="What moved on this deal?"
            />
          </Card>

          <Card>
            <CardHeader title="Deal notes" />
            {!notes || notes.length === 0 ? (
              <EmptyState title="No notes yet" description="Add the first note above." />
            ) : (
              <ol className="flex flex-col gap-3">
                {notes.map((note) => (
                  <li key={note.id} className="flex gap-3">
                    <span
                      className="size-7 shrink-0 rounded-full bg-[var(--surface-sunken)] border border-[var(--border-subtle)] flex items-center justify-center text-[10px] font-semibold text-[var(--text-secondary)]"
                      aria-hidden="true"
                    >
                      {getInitials(note.author?.full_name)}
                    </span>
                    <div className="min-w-0 flex-1 rounded-lg bg-[var(--surface-sunken)] px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <span className="text-xs font-medium">
                          {note.author?.full_name ?? 'Unknown user'}
                        </span>
                        <time dateTime={note.created_at} className="text-xs text-[var(--text-muted)]">
                          {formatDateTime(note.created_at)}
                        </time>
                      </div>
                      <p className="text-sm mt-1 whitespace-pre-wrap break-words">{note.body}</p>
                      {note.next_action_at && (
                        <p className="mt-2">
                          <Badge tone="warning">
                            Next: {note.next_action_description ?? 'Follow up'} ·{' '}
                            {formatDate(note.next_action_at)}
                          </Badge>
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
