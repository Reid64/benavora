"use strict";
// Scheduler — fires the nightly autonomous pipeline and the morning digest
// pipeline at fixed wall-clock times in America/Chicago (CST/CDT), matching
// WORKER_ARCHITECTURE_v2.md section 4's "2:00 AM CST" nightly trigger and
// "7:00 AM — Morning digest notification sent to users".
//
// WORKER_ARCHITECTURE_v2.md's own scheduler.ts example is built on
// `node-cron`, but that package was never added to package.json (no
// worker/scheduler.ts existed before this file, and no cron dependency is
// installed) — this file is new, not an update to an existing one. Rather
// than introduce a new dependency for a small, fixed set of daily triggers,
// this uses the same plain setInterval style already used elsewhere in
// worker/ (see heartbeat.ts): check the current America/Chicago time once a
// minute, fire any job whose target HH:MM matches, and guard each job
// independently against firing twice within the same day.
Object.defineProperty(exports, "__esModule", { value: true });
exports.start = start;
exports.stop = stop;
const CHECK_INTERVAL_MS = 60_000;
const TIMEZONE = 'America/Chicago';
const jobs = [
    {
        name: 'nightly autonomous pipeline',
        hour: 2,
        minute: 0,
        lastFiredOnDateKey: null,
        run: (supabase) => import('./autonomous-orchestrator.js').then(({ runAutonomousPipeline }) => runAutonomousPipeline(supabase)),
    },
    {
        name: 'morning digest pipeline',
        hour: 7,
        minute: 0,
        lastFiredOnDateKey: null,
        run: (supabase) => import('./autonomous-orchestrator.js').then(({ runDigestPipeline }) => runDigestPipeline(supabase)),
    },
    {
        name: 'AG-38 self-improvement pipeline',
        hour: 4,
        minute: 0,
        lastFiredOnDateKey: null,
        run: (supabase) => import('./autonomous-orchestrator.js').then(({ runSelfImprovementPipeline }) => runSelfImprovementPipeline(supabase)),
    },
    {
        name: 'AutoApply autonomous overnight orchestrator',
        hour: 3,
        minute: 0,
        lastFiredOnDateKey: null,
        run: (supabase) => import('./autoapply-autonomous-orchestrator.js').then(({ runAutonomousAutoApply }) => runAutonomousAutoApply(supabase)),
    },
];
let intervalId = null;
function chicagoParts(now) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
    return {
        dateKey: `${get('year')}-${get('month')}-${get('day')}`,
        hour: parseInt(get('hour'), 10),
        minute: parseInt(get('minute'), 10),
    };
}
function errMsg(err) {
    return err instanceof Error ? err.message : String(err);
}
/**
 * Starts the minute-granularity scheduler. Runs each job in `jobs` once, the
 * first time the clock reaches that job's hour:minute America/Chicago on a
 * given calendar day.
 */
function start(supabase) {
    if (intervalId !== null)
        return;
    intervalId = setInterval(() => {
        const { dateKey, hour, minute } = chicagoParts(new Date());
        for (const job of jobs) {
            if (hour === job.hour &&
                minute === job.minute &&
                job.lastFiredOnDateKey !== dateKey) {
                job.lastFiredOnDateKey = dateKey;
                console.log(`[Scheduler] ${job.hour}:${String(job.minute).padStart(2, '0')} CST reached — starting ${job.name}.`);
                void job.run(supabase).catch((err) => {
                    console.error(`[Scheduler] ${job.name} failed:`, errMsg(err));
                });
            }
        }
    }, CHECK_INTERVAL_MS);
}
function stop() {
    if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
    }
}
