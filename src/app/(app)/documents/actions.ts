'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import type { DocumentKind } from '@/lib/supabase/database.types';

/**
 * Document server actions (Phase 2: "Document Management").
 *
 * The `documents` bucket is private, so nothing here ever returns a permanent
 * URL. Downloads go through `getDocumentUrl`, which mints a short-lived signed
 * URL for a caller who has already passed RLS on the document row.
 */

export interface ActionState {
  error?: string;
  success?: string;
}

/** Mirrors the bucket's own limit, so an oversized file fails before upload. */
const MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
]);

const uploadSchema = z.object({
  name: z.string().trim().max(200).optional(),
  description: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable(),
  kind: z.enum(['contract', 'proposal', 'agreement', 'invoice_copy', 'other']),
  contact_id: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable(),
  deal_id: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable(),
});

/** Strips anything that could escape the intended folder or confuse a header. */
function safeExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'bin';
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
}

export async function uploadDocument(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a file to upload.' };
  }
  if (file.size > MAX_BYTES) {
    return { error: 'The file must be 25MB or smaller.' };
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return { error: 'Upload a PDF, Word or Excel document, an image, or a text file.' };
  }

  const parsed = uploadSchema.safeParse({
    name: formData.get('name') ?? '',
    description: formData.get('description') ?? '',
    kind: formData.get('kind') ?? 'other',
    contact_id: formData.get('contact_id') ?? '',
    deal_id: formData.get('deal_id') ?? '',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  if (!parsed.data.contact_id && !parsed.data.deal_id) {
    return { error: 'A document must be attached to a contact or a deal.' };
  }

  const supabase = await createClient();

  // Organization-scoped path, so the storage policy can authorise on the first
  // segment alone. A random id rather than the filename keeps two people
  // uploading "contract.pdf" from colliding, and stops a crafted filename from
  // steering the path.
  const parent = parsed.data.deal_id ? 'deals' : 'contacts';
  const parentId = parsed.data.deal_id ?? parsed.data.contact_id;
  const path = `${profile.organization_id}/${parent}/${parentId}/${crypto.randomUUID()}.${safeExtension(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}` };
  }

  const { error: insertError } = await supabase.from('documents').insert({
    organization_id: profile.organization_id,
    contact_id: parsed.data.contact_id,
    deal_id: parsed.data.deal_id,
    name: parsed.data.name?.trim() || file.name,
    description: parsed.data.description,
    kind: parsed.data.kind as DocumentKind,
    storage_path: path,
    mime_type: file.type,
    size_bytes: file.size,
    uploaded_by: profile.id,
  });

  if (insertError) {
    // Remove the orphaned object: a file in the bucket with no row is
    // invisible in the UI and impossible to clean up later.
    await supabase.storage.from('documents').remove([path]);
    return { error: `Could not save the document: ${insertError.message}` };
  }

  if (parsed.data.contact_id) revalidatePath(`/contacts/${parsed.data.contact_id}`);
  if (parsed.data.deal_id) revalidatePath(`/deals/${parsed.data.deal_id}`);
  return { success: 'Document uploaded.' };
}

/**
 * Mints a short-lived signed URL for one document.
 *
 * Reading the row first is the authorisation step: RLS decides whether this
 * caller may see the document at all, and only then is a URL created. Storage
 * policies alone would not be enough, since they scope by organization rather
 * than by which contacts a sales user owns.
 */
export async function getDocumentUrl(
  documentId: string,
): Promise<{ url?: string; error?: string }> {
  await requireProfile();

  const supabase = await createClient();

  const { data: document } = await supabase
    .from('documents')
    .select('storage_path, name')
    .eq('id', documentId)
    .maybeSingle();

  if (!document) {
    // Indistinguishable from "does not exist", which is correct — a sales user
    // must not be able to probe for documents they cannot read.
    return { error: 'That document is not available.' };
  }

  // 60 seconds: long enough to start a download, short enough that a copied
  // link is useless almost immediately.
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(document.storage_path, 60, { download: document.name });

  if (error || !data) {
    return { error: 'Could not prepare the download.' };
  }

  return { url: data.signedUrl };
}

export async function deleteDocument(documentId: string) {
  await requireProfile();

  const supabase = await createClient();

  const { data: document } = await supabase
    .from('documents')
    .select('storage_path, contact_id, deal_id')
    .eq('id', documentId)
    .maybeSingle();

  if (!document) throw new Error('That document is not available.');

  // Row first: if the storage delete fails the row is already gone, so the UI
  // is consistent and the orphaned object can be swept up later. The reverse
  // order would leave a listed document whose file 404s.
  const { error } = await supabase.from('documents').delete().eq('id', documentId);
  if (error) throw new Error(`Could not delete the document: ${error.message}`);

  await supabase.storage.from('documents').remove([document.storage_path]);

  if (document.contact_id) revalidatePath(`/contacts/${document.contact_id}`);
  if (document.deal_id) revalidatePath(`/deals/${document.deal_id}`);
}
