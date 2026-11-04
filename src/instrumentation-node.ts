/**
 * Node-runtime startup work.
 *
 * Split out of instrumentation.ts because that file is bundled for the Edge
 * runtime as well, and the bundler follows every import regardless of the
 * runtime guard around it — the chain from here reaches node:crypto, which
 * Edge cannot resolve. A separate file imported dynamically keeps it out of
 * that bundle entirely.
 */
import { startScheduler } from '@/lib/scheduler';

startScheduler();
