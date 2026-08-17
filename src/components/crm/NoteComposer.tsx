'use client';

import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Textarea, Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

/** Both contacts and deals expose an identically-shaped note action state. */
export interface NoteActionState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      Add note
    </Button>
  );
}

/**
 * Composer for a timestamped note, with the optional next-action reminder from
 * brief §08.
 *
 * Shared by contacts and deals — `recordId` is whichever the bound action
 * expects, so the same component serves both note types.
 */
export function NoteComposer({
  recordId,
  action,
  placeholder = 'What happened on this lead?',
}: {
  recordId: string;
  action: (
    recordId: string,
    state: NoteActionState,
    formData: FormData,
  ) => Promise<NoteActionState>;
  placeholder?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [showReminder, setShowReminder] = useState(false);

  /**
   * Wraps the server action so the form clears itself on success.
   *
   * Doing this inside the action rather than in an effect keeps the reset an
   * event-driven consequence of submitting, instead of a render-triggered
   * state cascade.
   */
  const [state, formAction] = useActionState<NoteActionState, FormData>(
    async (previousState, formData) => {
      const result = await action(recordId, previousState, formData);
      if (!result.error) {
        formRef.current?.reset();
        setShowReminder(false);
      }
      return result;
    },
    {},
  );

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <Textarea name="body" placeholder={placeholder} rows={3} required aria-label="Note" />

      {showReminder && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Next action date" name="next_action_at" type="date" />
          <Input
            label="Next action"
            name="next_action_description"
            placeholder="e.g. Follow up on proposal"
          />
        </div>
      )}

      {state.error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <SubmitButton />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setShowReminder((value) => !value)}
        >
          {showReminder ? 'Remove reminder' : 'Add reminder'}
        </Button>
      </div>
    </form>
  );
}
