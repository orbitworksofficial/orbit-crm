/**
 * Server startup hook. Next calls `register` once per server instance.
 *
 * Starts the background Meta sync, which keeps campaigns, spend and leads
 * current without any external scheduler — the CRM runs as a long-lived
 * process on its own server, so a timer inside it is the whole mechanism.
 */
export async function register() {
  // Next calls register in every runtime, and the chain below reaches
  // node:crypto, which the Edge bundle cannot resolve.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Skipped in development: a sync on every file save would hit the Meta API
  // repeatedly against the live account.
  if (process.env.NODE_ENV !== 'production') return;

  /**
   * The specifier is assembled at runtime so webpack cannot follow it.
   *
   * A plain `await import('./instrumentation-node')` is traced statically and
   * pulled into the Edge bundle regardless of the guard above, which fails the
   * build on node:crypto. Turbopack handles the guard correctly; webpack does
   * not, and the build script uses webpack.
   */
  const moduleName = './instrumentation' + '-node';
  await import(/* webpackIgnore: true */ moduleName);
}
