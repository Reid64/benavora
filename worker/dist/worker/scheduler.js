"use strict";
// Scheduler — fires the nightly autonomous pipeline at a fixed wall-clock
// time in America/Chicago (CST/CDT), matching WORKER_ARCHITECTURE_v2.md
// section 4's "2:00 AM CST" nightly trigger.
//
// WORKER_ARCHITECTURE_v2.md's own scheduler.ts example is built on
// `node-cron`, but that package was never added to package.json (no
// worker/scheduler.ts existed before this file, and no cron dependency is
// installed) — this file is new, not an update to an existing one. Rather
// than introduce a new dependency for a single daily trigger, this uses the
// same plain setInterval style already used elsewhere in worker/ (see
// heartbeat.ts): check the current America/Chicago time once a minute, fire
// when it matches the target HH:MM, and guard against firing twice within
// the same minute.
Object.defineProperty(exports, "__esModule", { value: true });
exports.start = start;
exports.stop = stop;
const CHECK_INTERVAL_MS = 60_000;
const TARGET_HOUR_CST = 2;
const TARGET_MINUTE_CST = 0;
const TIMEZONE = 'America/Chicago';
let intervalId = null;
let lastFiredOnDateKey = null;
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
 * Starts the minute-granularity scheduler. Runs `runAutonomousPipeline`
 * once, the first time the clock reaches TARGET_HOUR_CST:TARGET_MINUTE_CST
 * America/Chicago on a given calendar day.
 */
function start(supabase) {
    if (intervalId !== null)
        return;
    intervalId = setInterval(() => {
        const { dateKey, hour, minute } = chicagoParts(new Date());
        if (hour === TARGET_HOUR_CST &&
            minute === TARGET_MINUTE_CST &&
            lastFiredOnDateKey !== dateKey) {
            lastFiredOnDateKey = dateKey;
            console.log(`[Scheduler] ${TARGET_HOUR_CST}:${String(TARGET_MINUTE_CST).padStart(2, '0')} CST reached — starting nightly autonomous pipeline.`);
            void import('./autonomous-orchestrator.js')
                .then(({ runAutonomousPipeline }) => runAutonomousPipeline(supabase))
                .catch((err) => {
                console.error('[Scheduler] Nightly pipeline failed:', errMsg(err));
            });
        }
    }, CHECK_INTERVAL_MS);
}
function stop() {
    if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
    }
}
