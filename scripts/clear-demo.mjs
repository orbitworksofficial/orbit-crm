#!/usr/bin/env node
/**
 * Removes all demo records, leaving reference data intact.
 *
 *   npm run db:demo:clear
 *
 * Deletes every contact, deal, and invoice — which is correct while the
 * database holds only demo data. Once real records exist, stop using this and
 * remove demo rows individually through the app, or this will take real data
 * with them.
 *
 * Reference data (organization, users, services, lead sources, statuses) is
 * never touched: that is production configuration, not demo data.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is missing from .env.local.');
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const NIL = '00000000-0000-0000-0000-000000000000';

// Order matters: invoices reference contacts with ON DELETE RESTRICT, so a
// contact carrying an invoice cannot be removed until the invoice is gone.
// Line items, notes, activity, and tag rows all cascade from their parents.
for (const table of ['invoice_line_items', 'invoices', 'deals', 'contacts']) {
  const { error } = await db.from(table).delete().neq('id', NIL);
  console.log(`  ${table.padEnd(20)} ${error ? 'ERROR ' + error.message : 'cleared'}`);
}

// Reset numbering so the first real invoice is 0001 again. Safe only because
// every invoice has just been deleted.
await db.from('organizations').update({ invoice_next_number: 1 }).neq('id', NIL);

const { count } = await db.from('contacts').select('*', { count: 'exact', head: true });
console.log(`\nDone. Contacts remaining: ${count}. Invoice numbering reset to 0001.`);
