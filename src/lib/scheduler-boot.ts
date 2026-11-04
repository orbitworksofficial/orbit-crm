import 'server-only';

/**
 * Starts the background sync on the first server-rendered request.
 *
 * Deliberately NOT instrumentation.ts. That hook is bundled for the Edge
 * runtime as well, and webpack follows its imports past any NEXT_RUNTIME
 * guard to node:crypto, which Edge cannot resolve — the build fails. Making
 * the specifier untraceable fixed the build but meant the file was never
 * emitted, so the server then died at boot unable to resolve it. Both
 * failures took the whole site down.
 *
 * Calling it from a page render avoids the hook entirely: this module is only
 * ever reached from the Node runtime, so there is nothing for the Edge bundler
 * to trace and nothing that can stop the server starting. The cost is that the
 * timer begins on the first request rather than at boot, which for a CRM
 * somebody is about to use is no cost at all.
 */
export function ensureSchedulerStarted(): void {
  // Only in production: a sync on every file save would hit the Meta API
  // repeatedly against the live account.
  if (process.env.NODE_ENV !== 'production') return;

  // Fire and forget. A failure here must never affect the page that triggered
  // it — the request asked for a dashboard, not a sync.
  void import('@/lib/scheduler')
    .then(({ startScheduler }) => startScheduler())
    .catch((cause) => {
      console.error('[scheduler] Could not start:', cause);
    });
}
