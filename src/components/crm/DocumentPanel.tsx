'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input, Select } from '@/components/ui/Field';
import {
  uploadDocument,
  getDocumentUrl,
  deleteDocument,
  type ActionState,
} from '@/app/(app)/documents/actions';
import { formatDate, cn } from '@/lib/utils';
import type { CrmDocument, DocumentKind } from '@/lib/supabase/database.types';

/**
 * Documents attached to a contact or a deal (Phase 2: "Document Management").
 *
 * The same component serves both — it takes whichever parent id applies, which
 * is also what the server action uses to decide where the file is stored.
 *
 * Files live in a private bucket, so downloads are fetched through a
 * short-lived signed URL at click time rather than rendered as links. A link in
 * the markup would either be permanently public or dead within the minute.
 */

export interface DocumentRow extends CrmDocument {
  uploader_name: string | null;
}

const KIND_LABEL: Record<DocumentKind, string> = {
  contract: 'Contract',
  proposal: 'Proposal',
  agreement: 'Agreement',
  invoice_copy: 'Invoice',
  other: 'Document',
};

const KIND_TONE: Record<DocumentKind, 'info' | 'accent' | 'success' | 'neutral'> = {
  contract: 'info',
  proposal: 'accent',
  agreement: 'success',
  invoice_copy: 'neutral',
  other: 'neutral',
};

/** Human-readable file size. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      Upload
    </Button>
  );
}

function DocumentItem({ doc }: { doc: DocumentRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function download() {
    startTransition(async () => {
      setError(null);
      const result = await getDocumentUrl(doc.id);
      if (result.error || !result.url) {
        setError(result.error ?? 'Could not open the document.');
        return;
      }
      // Opening in a new tab rather than navigating: the signed URL expires,
      // so a back-button return to it would fail.
      window.open(result.url, '_blank', 'noopener,noreferrer');
    });
  }

  function remove() {
    if (!window.confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      try {
        await deleteDocument(doc.id);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not delete.');
      }
    });
  }

  return (
    <li className="flex items-start gap-3 py-2.5 border-b border-[var(--border-subtle)] last:border-0">
      <span
        className="size-8 shrink-0 rounded-lg bg-[var(--surface-sunken)] flex items-center justify-center text-[var(--text-muted)]"
        aria-hidden="true"
      >
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinejoin="round" />
          <path d="M14 2v6h6" strokeLinejoin="round" />
        </svg>
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <button
            type="button"
            onClick={download}
            disabled={isPending}
            className={cn(
              'text-sm font-medium text-[var(--text-primary)] text-left',
              'hover:text-[var(--primary)] transition-colors disabled:opacity-60',
            )}
          >
            {doc.name}
          </button>
          <Badge tone={KIND_TONE[doc.kind]}>{KIND_LABEL[doc.kind]}</Badge>
        </div>

        {doc.description && (
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{doc.description}</p>
        )}

        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          {formatBytes(doc.size_bytes)} · {formatDate(doc.created_at)}
          {doc.uploader_name && ` · ${doc.uploader_name}`}
        </p>

        {error && (
          <p role="alert" className="text-xs text-[var(--danger)] mt-1">
            {error}
          </p>
        )}
      </div>

      <Button size="sm" variant="ghost" onClick={remove} disabled={isPending} aria-label={`Delete ${doc.name}`}>
        ✕
      </Button>
    </li>
  );
}

export function DocumentPanel({
  documents,
  contactId,
  dealId,
}: {
  documents: DocumentRow[];
  contactId?: string;
  dealId?: string;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previousState, formData) => {
      const result = await uploadDocument(previousState, formData);
      if (!result.error) {
        formRef.current?.reset();
        setOpen(false);
      }
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader
        title="Documents"
        description={
          documents.length > 0
            ? `${documents.length} attached`
            : 'Contracts, proposals, and signed agreements.'
        }
        action={
          <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
            {open ? 'Cancel' : 'Upload'}
          </Button>
        }
      />

      {open && (
        <form
          ref={formRef}
          action={formAction}
          className="flex flex-col gap-3 mb-4 pb-4 border-b border-[var(--border-subtle)]"
        >
          {contactId && <input type="hidden" name="contact_id" value={contactId} />}
          {dealId && <input type="hidden" name="deal_id" value={dealId} />}

          <input
            type="file"
            name="file"
            required
            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.csv"
            aria-label="File"
            className="text-xs text-[var(--text-secondary)] file:mr-2 file:rounded-lg file:border-0 file:bg-[var(--surface-sunken)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--text-primary)] file:cursor-pointer"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Name (optional)"
              name="name"
              placeholder="Defaults to the filename"
            />
            <Select
              label="Type"
              name="kind"
              defaultValue="contract"
              options={[
                { value: 'contract', label: 'Contract' },
                { value: 'proposal', label: 'Proposal' },
                { value: 'agreement', label: 'Signed agreement' },
                { value: 'invoice_copy', label: 'Invoice copy' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </div>

          <Input label="Description (optional)" name="description" />

          <div className="flex items-center gap-3">
            <SubmitButton />
            <span className="text-xs text-[var(--text-muted)]">
              PDF, Word, Excel, images, or text. Up to 25MB.
            </span>
          </div>

          {state.error && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {state.error}
            </p>
          )}
        </form>
      )}

      {documents.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No documents yet.</p>
      ) : (
        <ul className="flex flex-col">
          {documents.map((doc) => (
            <DocumentItem key={doc.id} doc={doc} />
          ))}
        </ul>
      )}
    </Card>
  );
}
