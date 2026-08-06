import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import * as heartbeat from './heartbeat.js';
import * as queueProcessor from './queue-processor.js';
import * as ddRequestProcessor from './dd-request-processor.js';
import * as knowledgeIndexerProcessor from './knowledge-indexer-processor.js';
import * as confirmationMonitor from '../src/lib/autoapply/confirmation-monitor.js';
import * as scheduler from './scheduler.js';
import {
  processAgentQueue,
  stopAgentQueueProcessor,
} from './autonomous-orchestrator.js';
import { StreamServer } from './stream-server.js';

// --- Environment validation ---

function validateEnv(): {
  supabaseUrl: string;
  serviceRoleKey: string;
  workerId: string;
} {
  const vars = {
    SUPABASE_URL: process.env['SUPABASE_URL'],
    SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY'],
    ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
    WORKER_ID: process.env['WORKER_ID'],
  };

  const missing = (Object.entries(vars) as Array<[string, string | undefined]>)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    console.error(`[Worker] Fatal: missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  return {
    supabaseUrl: vars.SUPABASE_URL as string,
    serviceRoleKey: vars.SUPABASE_SERVICE_ROLE_KEY as string,
    workerId: vars.WORKER_ID as string,
  };
}

const env = validateEnv();

// --- Supabase client (service role — bypasses RLS) ---
// Node 20 lacks a stable native WebSocket; supply the ws package as the
// Realtime transport. The double-cast is required because @supabase/realtime-js
// types the transport against the browser WebSocket global.

export const supabase: SupabaseClient = createClient(
  env.supabaseUrl,
  env.serviceRoleKey,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  } as unknown as Parameters<typeof createClient>[2],
) as unknown as SupabaseClient;

// --- Graceful shutdown ---

let shuttingDown = false;
let agentQueueDone: Promise<void> = Promise.resolve();

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[Worker] ${signal} received — shutting down`);

  queueProcessor.stop();
  ddRequestProcessor.stop();
  knowledgeIndexerProcessor.stop();
  confirmationMonitor.stop();
  scheduler.stop();
  stopAgentQueueProcessor();

  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  await Promise.race([
    Promise.all([
      queueProcessor.waitForIdle(),
      ddRequestProcessor.waitForIdle(),
      knowledgeIndexerProcessor.waitForIdle(),
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
  knowledgeIndexerProcessor.start(supabase);
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
