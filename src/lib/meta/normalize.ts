import type { MetaLead, NormalizedLead } from './types';

/**
 * Maps a Meta lead onto CRM columns, keeping everything else verbatim.
 *
 * Meta's own prefilled questions have stable field names, so those map to real
 * columns. Custom questions do not: the name is whatever the advertiser typed
 * into the form builder, and it changes per campaign. Those keep their label
 * and land in custom_fields.
 *
 * Nothing is ever dropped. Meta permanently deletes lead data 90 days after
 * submission, so a field discarded at import is not recoverable afterwards —
 * which is why the unrecognised half is stored rather than ignored.
 */

/**
 * Meta's standard field names, mapped to the column each belongs in.
 *
 * Meta sends snake_case keys for its prefilled questions. The list covers the
 * variants seen in practice, including the ones that differ only by locale or
 * by form age (`phone` vs `phone_number`).
 */
const STANDARD_FIELDS: Record<string, keyof NormalizedLead | 'firstName' | 'lastName'> = {
  full_name: 'fullName',
  first_name: 'firstName',
  last_name: 'lastName',
  email: 'email',
  phone_number: 'phone',
  phone: 'phone',
  company_name: 'companyName',
  city: 'city',
  country: 'country',
};

/** Turns a Meta field name into something readable in the UI. */
export function humanizeFieldName(name: string): string {
  const spaced = name.replace(/[_-]+/g, ' ').trim();
  if (spaced === '') return name;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function normalizeLead(lead: MetaLead): NormalizedLead {
  let fullName = '';
  let firstName = '';
  let lastName = '';
  let email: string | null = null;
  let phone: string | null = null;
  let companyName: string | null = null;
  let city: string | null = null;
  let country: string | null = null;
  const customFields: Record<string, string> = {};

  for (const field of lead.field_data ?? []) {
    // Multi-select answers arrive as several values; joining keeps all of them
    // rather than silently taking the first.
    const value = (field.values ?? []).map((v) => String(v).trim()).filter(Boolean).join(', ');
    if (value === '') continue;

    const target = STANDARD_FIELDS[field.name?.toLowerCase() ?? ''];

    switch (target) {
      case 'fullName':
        fullName = value;
        break;
      case 'firstName':
        firstName = value;
        break;
      case 'lastName':
        lastName = value;
        break;
      case 'email':
        email = value;
        break;
      case 'phone':
        phone = value;
        break;
      case 'companyName':
        companyName = value;
        break;
      case 'city':
        city = value;
        break;
      case 'country':
        country = value;
        break;
      default:
        // Not a field Meta defines — an advertiser's own question. Keep the
        // label they chose; it is what makes the answer intelligible.
        customFields[field.name] = value;
    }
  }

  // Some forms ask for a full name, others for the two halves. Prefer the
  // explicit full name when both arrived.
  if (fullName === '') {
    fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  }

  // full_name is NOT NULL on contacts, and a lead with no name at all is still
  // worth keeping — the email or phone is the valuable part. A placeholder is
  // better than rejecting the lead or writing an empty string that reads as a
  // rendering bug.
  if (fullName === '') {
    fullName = email ?? phone ?? 'Unnamed Meta lead';
  }

  // The custom answers as readable text, so whoever picks the lead up sees
  // what was asked and answered without opening a side panel.
  const message =
    Object.keys(customFields).length > 0
      ? Object.entries(customFields)
          .map(([name, value]) => `${humanizeFieldName(name)}: ${value}`)
          .join('\n')
      : null;

  return { fullName, email, phone, companyName, city, country, customFields, message };
}
