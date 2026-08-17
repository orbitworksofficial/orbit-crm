-- ============================================================================
-- Orbit Works CRM — Storage
-- ============================================================================
-- One public bucket for company branding (the logo used in the invoice PDF
-- header). Public read is required because @react-pdf/renderer fetches the
-- image from the browser when generating the PDF; a signed URL would expire and
-- break regeneration of historical invoices.
--
-- Nothing confidential belongs in this bucket.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding',
  'branding',
  true,
  2097152, -- 2MB, matching the check in the upload action
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;

-- Anyone may read: the bucket is public by design (see above).
create policy "Branding assets are publicly readable"
  on storage.objects for select
  using (bucket_id = 'branding');

-- Only admins may upload, and only into their own organization's folder.
-- Paths are of the form "<organization_id>/logo-<timestamp>.<ext>", so the
-- first path segment is compared against the caller's organization.
create policy "Admins can upload branding for their organization"
  on storage.objects for insert
  with check (
    bucket_id = 'branding'
    and is_admin()
    and (storage.foldername(name))[1] = current_org_id()::text
  );

create policy "Admins can update branding for their organization"
  on storage.objects for update
  using (
    bucket_id = 'branding'
    and is_admin()
    and (storage.foldername(name))[1] = current_org_id()::text
  );

create policy "Admins can delete branding for their organization"
  on storage.objects for delete
  using (
    bucket_id = 'branding'
    and is_admin()
    and (storage.foldername(name))[1] = current_org_id()::text
  );
