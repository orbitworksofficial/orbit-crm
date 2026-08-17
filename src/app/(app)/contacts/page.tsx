import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { PageHeader, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, leadStatusTone } from '@/components/ui/Badge';
import {
  TableWrapper,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  SortableTH,
} from '@/components/ui/Table';
import { Pagination } from '@/components/ui/Pagination';
import { ContactFilters } from './ContactFilters';
import { buildContactsQuery, hasActiveFilters, type ContactListFilters } from './queries';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = { title: 'Contacts' };

const PAGE_SIZE = 25;

/** Whitelisted sort columns — keeps user input out of the ORDER BY clause. */
const SORTABLE_FIELDS = new Set(['full_name', 'company_name', 'created_at']);

type SearchParams = ContactListFilters & {
  sort?: string;
  dir?: string;
  page?: string;
};

/** Row shape returned by the list query, including embedded relations. */
interface ContactRow {
  id: string;
  full_name: string;
  email: string | null;
  company_name: string | null;
  created_at: string;
  lead_source: { id: string; name: string } | null;
  lead_status: { id: string; name: string; slug: string; is_won: boolean; is_lost: boolean } | null;
  assignee: { id: string; full_name: string } | null;
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const profile = await requireProfile();
  const supabase = await createClient();

  // Filter option sources. RLS scopes each to the caller's organization.
  const [{ data: sources }, { data: statuses }, { data: services }, { data: members }] =
    await Promise.all([
      supabase.from('lead_sources').select('id, name').eq('is_active', true).order('sort_order'),
      supabase.from('lead_statuses').select('id, name').eq('is_active', true).order('sort_order'),
      supabase.from('services').select('id, name').eq('is_active', true).order('sort_order'),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
    ]);

  const page = Math.max(1, Number(params.page) || 1);
  const sort = SORTABLE_FIELDS.has(params.sort ?? '') ? params.sort! : 'created_at';
  const ascending = params.dir === 'asc';

  const { data, count, error } = await buildContactsQuery(supabase, params, { count: true })
    .order(sort, { ascending })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    .returns<ContactRow[]>();

  const contacts = data ?? [];
  const filtered = hasActiveFilters(params);

  return (
    <>
      <PageHeader
        title="Contacts"
        description={
          profile.role === 'admin'
            ? 'All leads and customers.'
            : 'Leads and customers assigned to you.'
        }
        action={
          <Link href="/contacts/new">
            <Button>New contact</Button>
          </Link>
        }
      />

      <ContactFilters
        sources={sources ?? []}
        statuses={statuses ?? []}
        services={services ?? []}
        members={members ?? []}
        current={params}
      />

      {error ? (
        <EmptyState title="Could not load contacts" description={error.message} />
      ) : contacts.length === 0 ? (
        <EmptyState
          title={filtered ? 'No contacts match these filters' : 'No contacts yet'}
          description={
            filtered
              ? 'Try widening or clearing the filters above.'
              : 'Contacts appear here as your team adds them, or automatically from the website form.'
          }
          action={
            filtered ? (
              <Link href="/contacts">
                <Button variant="secondary">Clear filters</Button>
              </Link>
            ) : (
              <Link href="/contacts/new">
                <Button>New contact</Button>
              </Link>
            )
          }
        />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <THead>
                <TR>
                  <SortableTH
                    field="full_name"
                    currentSort={sort}
                    currentDir={params.dir}
                    baseParams={params}
                  >
                    Name
                  </SortableTH>
                  <SortableTH
                    field="company_name"
                    currentSort={sort}
                    currentDir={params.dir}
                    baseParams={params}
                  >
                    Company
                  </SortableTH>
                  <TH>Status</TH>
                  <TH>Source</TH>
                  <TH>Owner</TH>
                  <SortableTH
                    field="created_at"
                    currentSort={sort}
                    currentDir={params.dir}
                    baseParams={params}
                    align="right"
                  >
                    Created
                  </SortableTH>
                </TR>
              </THead>
              <TBody>
                {contacts.map((contact) => (
                  <TR key={contact.id}>
                    <TD>
                      <Link
                        href={`/contacts/${contact.id}`}
                        className="font-medium text-[var(--text-primary)] hover:text-[var(--primary)] transition-colors"
                      >
                        {contact.full_name}
                      </Link>
                      {contact.email && (
                        <p className="text-xs text-[var(--text-muted)] truncate max-w-[200px]">
                          {contact.email}
                        </p>
                      )}
                    </TD>
                    <TD className="text-[var(--text-secondary)]">{contact.company_name ?? '—'}</TD>
                    <TD>
                      {contact.lead_status ? (
                        <Badge tone={leadStatusTone(contact.lead_status)}>
                          {contact.lead_status.name}
                        </Badge>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </TD>
                    <TD className="text-[var(--text-secondary)] text-xs">
                      {contact.lead_source?.name ?? '—'}
                    </TD>
                    <TD className="text-[var(--text-secondary)] text-xs">
                      {contact.assignee?.full_name ?? (
                        <span className="text-[var(--warning)]">Unassigned</span>
                      )}
                    </TD>
                    <TD
                      align="right"
                      className="text-xs text-[var(--text-secondary)] whitespace-nowrap"
                    >
                      {formatDate(contact.created_at)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>

          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={count ?? 0}
            params={params as Record<string, string | undefined>}
          />
        </>
      )}
    </>
  );
}
