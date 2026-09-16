import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { PageHeader, Card } from '@/components/ui/Card';
import { TaskList, CompletedTasks, type ReminderRow } from './TaskList';
import { TaskComposer } from './TaskComposer';
import type { PendingReminder, Task } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Tasks' };

// Due dates are relative to today, so this page must never be cached.
export const dynamic = 'force-dynamic';

/**
 * Tasks and follow-ups (Phase 2: "Task and Reminder System").
 *
 * Reads the `pending_reminders` view, which merges open tasks with outstanding
 * note reminders. Both are the same thing to the reader — something due on a
 * date — so they belong in one list rather than two.
 *
 * RLS scopes the view through its underlying tables, so a sales user sees only
 * their own tasks and the reminders on notes they can read.
 */
export default async function TasksPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [remindersResult, completedResult, membersResult, contactsResult] =
    await Promise.all([
      supabase
        .from('pending_reminders')
        .select('*')
        .order('due_date', { nullsFirst: false })
        .returns<PendingReminder[]>(),
      supabase
        .from('tasks')
        .select('id, title, completed_at')
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(20)
        .returns<Pick<Task, 'id' | 'title' | 'completed_at'>[]>(),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
      supabase
        .from('contacts')
        .select('id, full_name, company_name')
        .order('full_name')
        .limit(500),
    ]);

  const reminders = remindersResult.data ?? [];

  // Resolve contact and assignee names in one round trip each, rather than
  // embedding — the view carries no relationship metadata to join through.
  const contactIds = [...new Set(reminders.map((r) => r.contact_id).filter(Boolean))] as string[];
  const { data: contactRows } = contactIds.length
    ? await supabase.from('contacts').select('id, full_name').in('id', contactIds)
    : { data: [] };

  const contactsById = new Map((contactRows ?? []).map((c) => [c.id, c.full_name]));
  const membersById = new Map((membersResult.data ?? []).map((m) => [m.id, m.full_name]));

  const rows: ReminderRow[] = reminders.map((r) => ({
    ...r,
    contact_name: r.contact_id ? (contactsById.get(r.contact_id) ?? null) : null,
    assignee_name: r.assigned_to ? (membersById.get(r.assigned_to) ?? null) : null,
  }));

  // Counts for the summary tiles. Computed here rather than in the list so the
  // headline numbers are available before the list renders.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayDiff = (d: string) =>
    Math.round((new Date(`${d}T00:00:00`).getTime() - today.getTime()) / 864e5);

  const overdue = rows.filter((r) => r.due_date && dayDiff(r.due_date) < 0).length;
  const dueToday = rows.filter((r) => r.due_date && dayDiff(r.due_date) === 0).length;

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Follow-ups assigned to you, and reminders set on notes."
        action={
          <TaskComposer
            members={membersResult.data ?? []}
            contacts={contactsResult.data ?? []}
            currentUserRole={profile.role}
          />
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Overdue</p>
          <p
            className={`text-xl font-semibold tabular mt-1 ${
              overdue > 0 ? 'text-[var(--danger)]' : ''
            }`}
          >
            {overdue}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Due today</p>
          <p
            className={`text-xl font-semibold tabular mt-1 ${
              dueToday > 0 ? 'text-[var(--warning)]' : ''
            }`}
          >
            {dueToday}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Open</p>
          <p className="text-xl font-semibold tabular mt-1">{rows.length}</p>
        </Card>
      </div>

      <Card>
        <TaskList rows={rows} />
        <CompletedTasks rows={completedResult.data ?? []} />
      </Card>
    </>
  );
}
