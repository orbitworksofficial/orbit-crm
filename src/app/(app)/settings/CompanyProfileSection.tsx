'use client';

import Image from 'next/image';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { updateCompanyProfile, uploadLogo, type ActionState } from './actions';
import type { Organization } from '@/lib/supabase/database.types';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {label}
    </Button>
  );
}

function StatusMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-xs text-[var(--danger)]">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p role="status" className="text-xs text-[var(--success)]">
        {state.success}
      </p>
    );
  }
  return null;
}

/**
 * Company profile (brief §09). These values populate the invoice PDF header.
 */
export function CompanyProfileSection({
  organization,
  logoUrl,
}: {
  organization: Organization;
  logoUrl: string | null;
}) {
  const [profileState, profileAction] = useActionState<ActionState, FormData>(
    updateCompanyProfile,
    {},
  );
  const [logoState, logoAction] = useActionState<ActionState, FormData>(uploadLogo, {});

  return (
    <Card>
      <CardHeader
        title="Company profile"
        description="Shown on invoice PDFs and in the app header."
      />

      <form action={profileAction} className="grid gap-4 sm:grid-cols-2 mb-5">
        <Input
          label="Company name"
          name="name"
          defaultValue={organization.name}
          required
          className="sm:col-span-2"
        />
        <Input
          label="Website"
          name="website_url"
          type="url"
          defaultValue={organization.website_url ?? ''}
          placeholder="https://orbitworks.com"
        />
        <Input
          label="Contact email"
          name="contact_email"
          type="email"
          defaultValue={organization.contact_email ?? ''}
          placeholder="hello@orbitworks.com"
        />
        <div className="sm:col-span-2 flex items-center gap-3">
          <SubmitButton label="Save profile" />
          <StatusMessage state={profileState} />
        </div>
      </form>

      <div className="border-t border-[var(--border-subtle)] pt-4">
        <p className="text-sm font-medium mb-2">Logo</p>
        <div className="flex items-center gap-4 flex-wrap">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={`${organization.name} logo`}
              width={120}
              height={48}
              className="h-12 w-auto object-contain rounded border border-[var(--border-subtle)] bg-white p-1"
              unoptimized
            />
          ) : (
            <div className="h-12 w-28 rounded border border-dashed border-[var(--border-strong)] flex items-center justify-center text-xs text-[var(--text-muted)]">
              No logo
            </div>
          )}

          <form action={logoAction} className="flex items-center gap-2 flex-wrap">
            <input
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              required
              aria-label="Logo file"
              className="text-xs text-[var(--text-secondary)] file:mr-2 file:rounded-lg file:border-0 file:bg-[var(--surface-sunken)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--text-primary)] file:cursor-pointer"
            />
            <SubmitButton label="Upload" />
          </form>
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-2">
          PNG, JPEG, WebP, or SVG. Maximum 2MB.
        </p>
        <StatusMessage state={logoState} />
      </div>
    </Card>
  );
}
