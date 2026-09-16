-- ============================================================================
-- Orbit Works CRM — Phase 2: Document Management
-- ============================================================================
-- Brief: "Upload and link contracts, proposals, and signed agreements to
-- contact and deal records."
--
-- Unlike the `branding` bucket, this one is PRIVATE. A signed contract must
-- never be reachable by URL alone: files are served through short-lived signed
-- URLs generated per request for a user who has already passed RLS.
--
-- Storage holds the bytes; this table holds everything the app needs to list,
-- search, and permission a document without touching the storage API.
-- ============================================================================

create type document_kind as enum (
  'contract', 'proposal', 'agreement', 'invoice_copy', 'other'
);

create table documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references organizations(id) on delete cascade,

  -- Same polymorphic shape as notes: a document hangs off a contact, a deal, or
  -- both (a contract for a deal is implicitly about its contact too).
  contact_id      uuid        references contacts(id) on delete cascade,
  deal_id         uuid        references deals(id) on delete cascade,

  -- Display name, editable independently of the stored file. Renaming a
  -- document must not require moving bytes in Storage.
  name            text        not null,
  description     text,
  kind            document_kind not null default 'other',

  -- Path within the `documents` bucket. Not a URL: the bucket is private, so a
  -- URL would be stale the moment its signature expired.
  storage_path    text        not null unique,
  mime_type       text        not null,
  size_bytes      bigint      not null,

  uploaded_by     uuid        references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint document_name_not_blank check (length(trim(name)) > 0),
  constraint document_size_positive check (size_bytes > 0),
  -- A document with no parent would be unreachable in the UI, since it is only
  -- ever listed from a contact or deal.
  constraint document_has_a_parent check (contact_id is not null or deal_id is not null)
);

create index documents_contact_id_idx on documents(contact_id, created_at desc);
create index documents_deal_id_idx on documents(deal_id, created_at desc);
create index documents_organization_id_idx on documents(organization_id);

comment on table documents is
  'Metadata for files in the private `documents` bucket. Holds everything needed to list and permission a file without calling the storage API.';
comment on column documents.storage_path is
  'Object path within the bucket. Deliberately not a URL — the bucket is private, so any stored URL would expire.';

create trigger documents_set_updated_at before update on documents
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — visibility follows the parent record.
-- ---------------------------------------------------------------------------
-- A document is exactly as visible as the contact or deal it belongs to, so a
-- sales user sees contracts for their own accounts and nothing else.

alter table documents enable row level security;

create policy documents_select on documents
  for select using (
    organization_id = current_org_id()
    and (
      is_admin()
      or exists (
        select 1 from contacts c
        where c.id = documents.contact_id and c.assigned_to = auth.uid()
      )
      or exists (
        select 1 from deals d
        where d.id = documents.deal_id and d.assigned_to = auth.uid()
      )
    )
  );

create policy documents_insert on documents
  for insert with check (
    organization_id = current_org_id()
    and uploaded_by = auth.uid()
    and (
      is_admin()
      or exists (
        select 1 from contacts c
        where c.id = documents.contact_id and c.assigned_to = auth.uid()
      )
      or exists (
        select 1 from deals d
        where d.id = documents.deal_id and d.assigned_to = auth.uid()
      )
    )
  );

create policy documents_update on documents
  for update using (
    organization_id = current_org_id()
    and (is_admin() or uploaded_by = auth.uid())
  )
  with check (organization_id = current_org_id());

-- Deleting a contract is destructive and unrecoverable, so it is limited to the
-- uploader and admins.
create policy documents_delete on documents
  for delete using (
    organization_id = current_org_id()
    and (is_admin() or uploaded_by = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Storage bucket — private.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,  -- signed URLs only; never reachable by guessing a path
  26214400, -- 25MB: large enough for a scanned contract, small enough to stay free-tier friendly
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png', 'image/jpeg', 'image/webp',
    'text/plain', 'text/csv'
  ]
)
on conflict (id) do nothing;

-- Paths are "<organization_id>/<contact|deal>/<uuid>.<ext>", so the first
-- segment scopes every policy to the caller's organization.

create policy "Members can read documents in their organization"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = current_org_id()::text
  );

create policy "Members can upload documents to their organization"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = current_org_id()::text
  );

create policy "Members can delete documents in their organization"
  on storage.objects for delete
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = current_org_id()::text
  );
