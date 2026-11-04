import 'server-only';

/**
 * In-process scheduler.
 *
 * The CRM runs as a long-lived Node process on its own server, so a timer
 * inside it is enough — no platform cron, no external service, nothing to
 * configure in a dashboard that someone has to remember exists.
 *
 * This is deliberately simple. It is not a job queue: there is one job, it is
 * idempotent, and a missed run costs nothing because the next one covers the
 * same window. Reaching for a queue here would add a dependency and a failure
 * mode to solve a problem that does not exist yet.
 *
 * Started from instrumentation.ts, which Next runs once per server process.
 */

/** How often the sync runs. Hourly keeps spend current without hammering
 *  Meta's rate limit, which is generous but not unlimited. */
const INTERVAL_MS = 60 * 60 * 1000;

/** Delay before the first run, so a deploy is not competing with a sync while
 *  the process is still warming up. */
const STARTUP_DELAY_MS = 60 * 1000;

declare global {
  var __orbitSchedulerStarted: boolean | undefined;
}

/**
 * Runs one sync pass.
 *
 * Imported lazily so starting the scheduler does not pull the Meta client and
 * the Supabase admin client into every server start, including builds that
 * never serve a request.
 */
async function runMetaSync(): Promise<void> {
  const { syncAllMetaData } = await import('@/lib/meta/sync');
  const result = await syncAllMetaData();

  if (result.ok) {
    if (result.leadsCreated > 0 || result.spendRows > 0) {
      console.log(
        `[scheduler] Meta sync: ${result.spendRows} spend rows, ${result.leadsCreated} new leads.`,
      );
    }
  } else {
    console.error(`[scheduler] Meta sync had problems: ${result.message}`);
  }
}

/**
 * Starts the background schedule. Safe to call more than once.
 *
 * The guard is on globalThis rather than module scope because Next reloads
 * modules on edit in development, and a fresh module-level flag per reload
 * would start a second timer every time a file is saved — within an hour of
 * work there would be a dozen syncs running in parallel.
 */
export function startScheduler(): void {
  if (global.__orbitSchedulerStarted) return;
  global.__orbitSchedulerStarted = true;

  const tick = () => {
    // Never let a failing sync take the process down: this runs detached from
    // any request, so an unhandled rejection here would be fatal rather than
    // a 500 on one page.
    void runMetaSync().catch((cause) => {
      console.error('[scheduler] Meta sync threw:', cause);
    });
  };

  setTimeout(() => {
    tick();
    // unref so the timer never keeps the process alive during a shutdown.
    setInterval(tick, INTERVAL_MS).unref();
  }, STARTUP_DELAY_MS).unref();

  console.log('[scheduler] Meta sync scheduled hourly.');
}
