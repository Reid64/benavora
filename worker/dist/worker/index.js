"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const ws_1 = __importDefault(require("ws"));
const heartbeat = __importStar(require("./heartbeat.js"));
const queueProcessor = __importStar(require("./queue-processor.js"));
const ddRequestProcessor = __importStar(require("./dd-request-processor.js"));
const scheduler = __importStar(require("./scheduler.js"));
const autonomous_orchestrator_js_1 = require("./autonomous-orchestrator.js");
const stream_server_js_1 = require("./stream-server.js");
// --- Environment validation ---
function validateEnv() {
    const vars = {
        SUPABASE_URL: process.env['SUPABASE_URL'],
        SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY'],
        ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
        WORKER_ID: process.env['WORKER_ID'],
    };
    const missing = Object.entries(vars)
        .filter(([, v]) => !v)
        .map(([k]) => k);
    if (missing.length > 0) {
        console.error(`[Worker] Fatal: missing required env vars: ${missing.join(', ')}`);
        process.exit(1);
    }
    return {
        supabaseUrl: vars.SUPABASE_URL,
        serviceRoleKey: vars.SUPABASE_SERVICE_ROLE_KEY,
        workerId: vars.WORKER_ID,
    };
}
const env = validateEnv();
// --- Supabase client (service role — bypasses RLS) ---
// Node 20 lacks a stable native WebSocket; supply the ws package as the
// Realtime transport. The double-cast is required because @supabase/realtime-js
// types the transport against the browser WebSocket global.
exports.supabase = (0, supabase_js_1.createClient)(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws_1.default },
});
// --- Graceful shutdown ---
let shuttingDown = false;
let agentQueueDone = Promise.resolve();
async function shutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    console.log(`[Worker] ${signal} received — shutting down`);
    queueProcessor.stop();
    ddRequestProcessor.stop();
    scheduler.stop();
    (0, autonomous_orchestrator_js_1.stopAgentQueueProcessor)();
    const FIVE_MINUTES_MS = 5 * 60 * 1000;
    await Promise.race([
        Promise.all([
            queueProcessor.waitForIdle(),
            ddRequestProcessor.waitForIdle(),
            agentQueueDone,
        ]),
        new Promise((resolve) => setTimeout(resolve, FIVE_MINUTES_MS)),
    ]);
    heartbeat.stop();
    await exports.supabase
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
process.on('uncaughtException', (error) => {
    console.error('[Worker] Uncaught exception:', error);
    exports.supabase
        .from('worker_status')
        .update({ status: 'error' })
        .eq('worker_id', env.workerId)
        .then(() => process.exit(1), () => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
    console.error('[Worker] Unhandled rejection:', reason);
    exports.supabase
        .from('worker_status')
        .update({ status: 'error' })
        .eq('worker_id', env.workerId)
        .then(() => process.exit(1), () => process.exit(1));
});
// --- Boot sequence ---
async function main() {
    const streamPort = parseInt(process.env['PORT'] ?? '8080', 10);
    const streamServer = new stream_server_js_1.StreamServer(streamPort, exports.supabase);
    await streamServer.start();
    await heartbeat.register(exports.supabase, env.workerId);
    heartbeat.start(exports.supabase, env.workerId);
    queueProcessor.start(exports.supabase, env.workerId, streamServer);
    ddRequestProcessor.start(exports.supabase);
    scheduler.start(exports.supabase);
    agentQueueDone = (0, autonomous_orchestrator_js_1.processAgentQueue)(exports.supabase).catch((err) => {
        console.error('[Worker] Agent queue processor crashed:', err);
    });
    console.log(`[Worker] AutoApply Worker started — id=${env.workerId} at ${new Date().toISOString()}`);
}
void main().catch((error) => {
    console.error('[Worker] Failed to start:', error);
    process.exit(1);
});
