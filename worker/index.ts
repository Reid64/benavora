import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../src/lib/supabase/admin.js';
import * as heartbeat from './heartbeat.js';
import * as queueProcessor from './queue-processor.js';
import * as ddRequestProcessor from './dd-request-processor.js';
import * as enrichmentProcessor from './enrichment-processor.js';
import * as knowledgeIndexerProcessor from './knowledge-indexer-processor.js';
import * as stuckRunWatchdog from './stuck-run-watchdog.js';
import * as confirmationMonitor from '../src/lib/autoapply/confirmation-monitor.js';
import * as scheduler from './scheduler.js';
import {
  processAgentQueue,
  stopAgentQueueProcessor,
} from './autonomous-orchestrator.js';
import { StreamServer } from './stream-server.js';

// --- Environment validation ---
//
// WGR-158: this used to check only 4 vars (SUPABASE_URL among them) and
// then build its own Supabase client directly from that narrow list -
// which meant the boot check could pass cleanly on Railway (SUPABASE_URL
// present) while every real Donor Discovery request still failed, because
// the shared admin-client factory those code paths actually call
// (src/lib/supabase/admin.ts's createAdminClient(), see its header comment)
// read a *different* env var name (NEXT_PUBLIC_SUPABASE_URL) that Railway
// never had set. A passing boot check that doesn't exercise every real code
// path is worse than no check - it hides exactly this class of bug. Two
// tiers now:
//   - REQUIRED_ENV_VARS: the worker cannot do anything at all without
//     these; missing any is fatal at boot (unchanged behavior otherwise -
//     still exits 1 immediately, still lists every missing one together,
//     not just the first).
//   - FEATURE_ENV_VARS: specific worker features degrade or fail once they
//     run without these, but the worker itself still boots and does useful
//     work (matches the existing gmail-confirmation-monitor "Skipping
//     cycle" pattern) - missing ones are logged loudly as warnings at boot,
//     not discovered later only when that feature's own request fails live.

const REQUIRED_ENV_VARS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'WORKER_ID',
] as const;

const FEATURE_ENV_VARS = [
  'GOOGLE_PLACES_API_KEY', // donor-discovery enumeration (Places adapter)
  'SAM_GOV_API_KEY', // donor-discovery entity/award adapters, grants sources
  'RESEND_API_KEY', // email sends (campaigns, digests, reminders)
  'PROXY_LIST', // scraper proxy rotation
] as const;

function validateEnv(): { workerId: string } {
  const missing: string[] = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);

  // SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL: either name satisfies the
  // shared factory (createAdminClient() checks SUPABASE_URL first, falls
  // back to NEXT_PUBLIC_SUPABASE_URL) - checked here as one combined
  // requirement, not two independent ones, so the boot check's pass/fail
  // matches exactly what createAdminClient() will actually do below.
  if (!process.env['SUPABASE_URL'] && !process.env['NEXT_PUBLIC_SUPABASE_URL']) {
    missing.push('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)');
  }

  if (missing.length > 0) {
    console.error(`[Worker] Fatal: missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const missingFeature = FEATURE_ENV_VARS.filter((k) => !process.env[k]);
  if (missingFeature.length > 0) {
    console.warn(
      `[Worker] Warning: missing feature-scoped env vars (worker will boot; these features will fail or no-op until set): ${missingFeature.join(', ')}`,
    );
  }

  return { workerId: process.env['WORKER_ID'] as string };
}

const env = validateEnv();

// --- Supabase client (service role — bypasses RLS) ---
// Routed through the single shared factory (src/lib/supabase/admin.ts,
// WGR-158) instead of constructing its own client here — every module
// under src/lib/ this worker calls (donor-discovery enumeration/directory,
// agents, etc.) already goes through that same factory, so this is now the
// one and only place a service-role client gets built, on either platform.
export const supabase: SupabaseClient = createAdminClient();

// --- Graceful shutdown ---

let shuttingDown = false;
let agentQueueDone: Promise<void> = Promise.resolve();

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[Worker] ${signal} received — shutting down`);

  queueProcessor.stop();
  ddRequestProcessor.stop();
  enrichmentProcessor.stop();
  knowledgeIndexerProcessor.stop();
  stuckRunWatchdog.stop();
  confirmationMonitor.stop();
  scheduler.stop();
  stopAgentQueueProcessor();

  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  await Promise.race([
    Promise.all([
      queueProcessor.waitForIdle(),
      ddRequestProcessor.waitForIdle(),
      enrichmentProcessor.waitForIdle(),
      knowledgeIndexerProcessor.waitForIdle(),
      stuckRunWatchdog.waitForIdle(),
      confirmationMonitor.waitForIdle(),
      agentQueueDone,
    ]),
    new Promise<void>((resolve) => setTimeout(resolve, FIVE_MINUTES_MS)),
  ]);

  heartbeat.stop();

  await supabase
    .from('worker_status')
    .update({ status: 'offline' })
    .eq('worker_id', env.workerId);

  console.log('[Worker] Shut down cleanly');
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

// --- Unhandled error handlers ---

process.on('uncaughtException', (error: Error) => {
  console.error('[Worker] Uncaught exception:', error);
  supabase
    .from('worker_status')
    .update({ status: 'error' })
    .eq('worker_id', env.workerId)
    .then(() => process.exit(1), () => process.exit(1));
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[Worker] Unhandled rejection:', reason);
  supabase
    .from('worker_status')
    .update({ status: 'error' })
    .eq('worker_id', env.workerId)
    .then(() => process.exit(1), () => process.exit(1));
});

// --- Boot sequence ---

async function main(): Promise<void> {
  const streamPort = parseInt(process.env['PORT'] ?? '8080', 10);
  const streamServer = new StreamServer(streamPort, supabase);
  await streamServer.start();

  await heartbeat.register(supabase, env.workerId);
  heartbeat.start(supabase, env.workerId);
  queueProcessor.start(supabase, env.workerId, streamServer);
  ddRequestProcessor.start(supabase);
  enrichmentProcessor.start(supabase);
  knowledgeIndexerProcessor.start(supabase);
  stuckRunWatchdog.start(supabase);
  confirmationMonitor.start(supabase);
  scheduler.start(supabase);
  agentQueueDone = processAgentQueue(supabase).catch((err: unknown) => {
    console.error('[Worker] Agent queue processor crashed:', err);
  });

  console.log(
    `[Worker] AutoApply Worker started — id=${env.workerId} at ${new Date().toISOString()}`,
  );
}

void main().catch((error: unknown) => {
  console.error('[Worker] Failed to start:', error);
  process.exit(1);
});
