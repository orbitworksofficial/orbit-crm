import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { PageHeader, EmptyState, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DealStatusBadge } from '@/components/ui/Badge';
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
import { DealFilters } from './DealFilters';
import { buildDealsQuery, hasActiveDealFilters, type DealListFilters } from './queries';
import { formatDate, formatCurrency } from '@/lib/utils';

export const metadata: Metadata = { title: 'Deals' };

const PAGE_SIZE = 25;
const SORTABLE_FIELDS = new Set(['title', 'value', 'expected_close_date', 'created_at']);

type SearchParams = DealListFilters & { sort?: string; dir?: string; page?: string };

interface DealRow {
  id: string;
  title: string;
  value: number;
  currency: string;
  status: 'open' | 'won' | 'lost';
  expected_close_date: string | null;
  created_at: string;
  contact: { id: string; full_name: string; company_name: string | null } | null;
  assignee: { id: string; full_name: string } | null;
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: services }, { data: members }] = await Promise.all([
    supabase.from('services').select('id, name').eq('is_active', true).order('sort_order'),
    supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
  ]);

  const page = Math.max(1, Number(params.page) || 1);
  const sort = SORTABLE_FIELDS.has(params.sort ?? '') ? params.sort! : 'created_at';
  const ascending = params.dir === 'asc';

  const { data, count, error } = await buildDealsQuery(supabase, params, { count: true })
    .order(sort, { ascending })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    .returns<DealRow[]>();

  const deals = data ?? [];
  const filtered = hasActiveDealFilters(params);

  // Summary reflects the current filter set, excluding pagination — so it
  // answers "what is this filtered view worth", not "what is on this page".
  const { data: summaryRows } = await buildDealsQuery(supabase, params)
    .returns<Pick<DealRow, 'value' | 'status'>[]>();

  const openValue =
    summaryRows?.filter((d) => d.status === 'open').reduce((sum, d) => sum + Number(d.value), 0) ?? 0;
  const wonValue =
    summaryRows?.filter((d) => d.status === 'won').reduce((sum, d) => sum + Number(d.value), 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Deals"
        description={
          profile.role === 'admin' ? 'All deals in the pipeline.' : 'Deals assigned to you.'
        }
        action={
          <Link href="/deals/new">
            <Button>New deal</Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Deals</p>
          <p className="text-xl font-semibold tabular mt-1">{count ?? 0}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Open value</p>
          <p className="text-xl font-semibold tabular mt-1 text-[var(--info)]">
            {formatCurrency(openValue)}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Won value</p>
          <p className="text-xl font-semibold tabular mt-1 text-[var(--success)]">
            {formatCurrency(wonValue)}
          </p>
        </Card>
      </div>

      <DealFilters services={services ?? []} members={members ?? []} current={params} />

      {error ? (
        <EmptyState title="Could not load deals" description={error.message} />
      ) : deals.length === 0 ? (
        <EmptyState
          title={filtered ? 'No deals match these filters' : 'No deals yet'}
          description={
            filtered
              ? 'Try widening or clearing the filters above.'
              : 'Create a deal against a contact to start tracking revenue.'
          }
          action={
            filtered ? (
              <Link href="/deals">
                <Button variant="secondary">Clear filters</Button>
              </Link>
            ) : (
              <Link href="/deals/new">
                <Button>New deal</Button>
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
                  <SortableTH field="title" currentSort={sort} currentDir={params.dir} baseParams={params}>
                    Deal
                  </SortableTH>
                  <TH>Contact</TH>
                  <TH>Status</TH>
                  <TH>Owner</TH>
                  <SortableTH
                    field="expected_close_date"
                    currentSort={sort}
                    currentDir={params.dir}
                    baseParams={params}
                  >
                    Expected close
                  </SortableTH>
                  <SortableTH
                    field="value"
                    currentSort={sort}
                    currentDir={params.dir}
                    baseParams={params}
                    align="right"
                  >
                    Value
                  </SortableTH>
                </TR>
              </THead>
              <TBody>
                {deals.map((deal) => (
                  <TR key={deal.id}>
                    <TD>
                      <Link
                        href={`/deals/${deal.id}`}
                        className="font-medium hover:text-[var(--primary)] transition-colors"
                      >
                        {deal.title}
                      </Link>
                    </TD>
                    <TD className="text-[var(--text-secondary)]">
                      {deal.contact ? (
                        <Link
                          href={`/contacts/${deal.contact.id}`}
                          className="hover:text-[var(--primary)] transition-colors"
                        >
                          {deal.contact.full_name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD>
                      <DealStatusBadge status={deal.status} />
                    </TD>
                    <TD className="text-[var(--text-secondary)] text-xs">
                      {deal.assignee?.full_name ?? (
                        <span className="text-[var(--warning)]">Unassigned</span>
                      )}
                    </TD>
                    <TD className="text-[var(--text-secondary)] text-xs whitespace-nowrap">
                      {formatDate(deal.expected_close_date)}
                    </TD>
                    <TD align="right" className="font-medium whitespace-nowrap">
                      {formatCurrency(deal.value, deal.currency)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>

          <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={params} />
        </>
      )}
    </>
  );
}
