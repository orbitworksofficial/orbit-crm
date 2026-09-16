'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';

/**
 * Task server actions (Phase 2: "Assign tasks, set deadlines").
 *
 * Available to every role: a sales user needs their own follow-up list. RLS
 * restricts what each person can see and assign — a sales user may only assign
 * to themselves, while an admin may delegate.
 */

export interface ActionState {
  error?: string;
  success?: string;
}

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable();

const optionalUuid = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .refine(
    (value) => value === null || z.string().uuid().safeParse(value).success,
    'Invalid selection',
  );

const taskSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title').max(200),
  description: optionalText,
  due_date: optionalText,
  priority: z.enum(['low', 'normal', 'high']),
  assigned_to: optionalUuid,
  contact_id: optionalUuid,
  deal_id: optionalUuid,
});

export async function createTask(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();

  const parsed = taskSchema.safeParse({
    title: formData.get('title') ?? '',
    description: formData.get('description') ?? '',
    due_date: formData.get('due_date') ?? '',
    priority: formData.get('priority') ?? 'normal',
    assigned_to: formData.get('assigned_to') ?? '',
    contact_id: formData.get('contact_id') ?? '',
    deal_id: formData.get('deal_id') ?? '',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Sales users own what they create; RLS would reject any other assignment, so
  // defaulting here turns a would-be error into the obvious behaviour.
  const assignedTo =
    profile.role === 'admin' ? (parsed.data.assigned_to ?? profile.id) : profile.id;

  const supabase = await createClient();
  const { error } = await supabase.from('tasks').insert({
    ...parsed.data,
    assigned_to: assignedTo,
    organization_id: profile.organization_id,
    created_by: profile.id,
  });

  if (error) return { error: error.message };

  revalidatePath('/tasks');
  revalidatePath('/', 'layout'); // refreshes the sidebar due-count badge
  return { success: 'Task added.' };
}

/** Marks a task done, or reopens it. `completed_by` is stamped by a trigger. */
export async function toggleTaskComplete(taskId: string, complete: boolean) {
  await requireProfile();

  const supabase = await createClient();
  const { error } = await supabase
    .from('tasks')
    .update({ completed_at: complete ? new Date().toISOString() : null })
    .eq('id', taskId);

  if (error) throw new Error(`Could not update the task: ${error.message}`);

  revalidatePath('/tasks');
  revalidatePath('/', 'layout');
}

export async function deleteTask(taskId: string) {
  await requireProfile();

  const supabase = await createClient();
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);

  if (error) throw new Error(`Could not delete the task: ${error.message}`);

  revalidatePath('/tasks');
  revalidatePath('/', 'layout');
}

/**
 * Clears a note's reminder once it has been dealt with.
 *
 * Note reminders have no completed state of their own — clearing the date is
 * what "done" means for them. The note body itself is left untouched, since it
 * is a record of what happened.
 */
export async function dismissNoteReminder(noteId: string) {
  await requireProfile();

  const supabase = await createClient();
  const { error } = await supabase
    .from('notes')
    .update({ next_action_at: null, next_action_description: null })
    .eq('id', noteId);

  if (error) throw new Error(`Could not clear the reminder: ${error.message}`);

  revalidatePath('/tasks');
  revalidatePath('/', 'layout');
}
