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

import type { SupabaseClient } from '@supabase/supabase-js';

interface ScheduledJob {
  name: string;
  hour: number;
  minute: number;
  run: (supabase: SupabaseClient) => Promise<void>;
  lastFiredOnDateKey: string | null;
}

const CHECK_INTERVAL_MS = 60_000;
const TIMEZONE = 'America/Chicago';

const jobs: ScheduledJob[] = [
  {
    name: 'nightly autonomous pipeline',
    hour: 2,
    minute: 0,
    lastFiredOnDateKey: null,
    run: async (supabase) => {
      const { runAutonomousPipeline } = await import('./autonomous-orchestrator.js');
      await runAutonomousPipeline(supabase);

      // AG-28 application_followups sweep - shares this same 2AM slot rather
      // than a dedicated cron entry, matching this file's existing precedent
      // of folding same-cadence jobs into the nightly sweep instead of
      // inventing a new fixed-time slot for each one.
      const { processFollowups } = await import(
        '../src/worker/jobs/process-followups.js'
      );
      await processFollowups(supabase);
    },
  },
  {
    name: 'morning digest pipeline',
    hour: 7,
    minute: 0,
    lastFiredOnDateKey: null,
    run: (supabase) =>
      import('./autonomous-orchestrator.js').then(({ runDigestPipeline }) =>
        runDigestPipeline(supabase),
      ),
  },
  {
    name: 'AG-38 self-improvement pipeline',
    hour: 4,
    minute: 0,
    lastFiredOnDateKey: null,
    run: (supabase) =>
      import('./autonomous-orchestrator.js').then(
        ({ runSelfImprovementPipeline }) => runSelfImprovementPipeline(supabase),
      ),
  },
  {
    name: 'AutoApply autonomous overnight orchestrator',
    hour: 3,
    minute: 0,
    lastFiredOnDateKey: null,
    run: (supabase) =>
      import('./autoapply-autonomous-orchestrator.js').then(
        ({ runAutonomousAutoApply }) => runAutonomousAutoApply(supabase),
      ),
  },
  {
    // AG-36 Learning Network Aggregator — platform-level, weekly. This job
    // fires daily like every other entry here (worker/scheduler.ts has no
    // day-of-week concept), but runLearningNetworkPipeline() itself no-ops
    // unless it's Sunday in America/Chicago — see that function's own
    // comment in autonomous-orchestrator.ts.
    name: 'AG-36 learning network aggregator pipeline',
    hour: 6,
    minute: 0,
    lastFiredOnDateKey: null,
    run: (supabase) =>
      import('./autonomous-orchestrator.js').then(
        ({ runLearningNetworkPipeline }) => runLearningNetworkPipeline(supabase),
      ),
  },
  {
    // AG-10 Grant DNA Analysis Agent — per-org, weekly, Sunday 3:00 AM CST
    // per AGENTS_v2.md's AG-10 spec ("off-peak, matching the existing
    // weekly-cadence convention already used for foundation-enrichment-
    // weekly"). Shares this hour:minute slot with foundation-enrichment-
    // weekly below — jobs at the same slot all fire independently, matching
    // this file's existing precedent (e.g. AG-36 at hour 6 self-guards
    // Sunday inside its own pipeline function rather than needing a unique
    // slot). Real day-of-week gating lives inside
    // runGrantDnaWeeklyPipeline() (isSundayChicago()), not here.
    name: 'AG-10 grant DNA weekly pipeline',
    hour: 3,
    minute: 0,
    lastFiredOnDateKey: null,
    run: (supabase) =>
      import('./autonomous-orchestrator.js').then(
        ({ runGrantDnaWeeklyPipeline }) => runGrantDnaWeeklyPipeline(supabase),
      ),
  },
  {
    // Foundation directory enrichment (STANDING_DIRECTIVES.md Directive 1,
    // src/lib/scraper/foundation-scraper.ts). Weekly, Sunday 3AM CST — same
    // precedent as the AG-36 entry above: this file has no day-of-week
    // concept, so the job fires daily at this hour and the run() body itself
    // no-ops on any day that isn't Sunday in America/Chicago. Gated behind
    // ENABLE_SCRAPER to prevent accidental runs (task requirement) — the
    // scraper launches real Chromium instances and makes outbound requests to
    // IRS/Google/foundation websites, which is not something to fire
    // silently just because a queued deploy happened to land near 3AM.
    name: 'foundation-enrichment-weekly',
    hour: 3,
    minute: 0,
    lastFiredOnDateKey: null,
    run: async (_supabase) => {
      if (process.env['ENABLE_SCRAPER'] !== 'true') {
        console.log(
          "[Scheduler] foundation-enrichment-weekly skipped — ENABLE_SCRAPER is not 'true'.",
        );
        return;
      }
      if (chicagoWeekday(new Date()) !== 'Sun') return;

      const { runFoundationScraper } = await import(
        '../src/lib/scraper/foundation-scraper.js'
      );
      await runFoundationScraper();
    },
  },
  {
    // Nonprofit contact-enrichment agent (STANDING_DIRECTIVES.md Directive 1,
    // src/lib/scraper/nonprofit-scraper.ts). Weekly, Sunday 4AM CST — staggered
    // one hour after foundation-enrichment-weekly (3AM) so the two scrapers'
    // StealthEngine browser pools never run concurrently on the same worker.
    // Same day-of-week guard and ENABLE_SCRAPER gate as that job, for the same
    // reason: this scraper also launches real Chromium instances and makes
    // outbound requests to nonprofit websites.
    name: 'nonprofit-enrichment-weekly',
    hour: 4,
    minute: 0,
    lastFiredOnDateKey: null,
    run: async (_supabase) => {
      if (process.env['ENABLE_SCRAPER'] !== 'true') {
        console.log(
          "[Scheduler] nonprofit-enrichment-weekly skipped — ENABLE_SCRAPER is not 'true'.",
        );
        return;
      }
      if (chicagoWeekday(new Date()) !== 'Sun') return;

      const { runNonprofitScraper } = await import(
        '../src/lib/scraper/nonprofit-scraper.js'
      );
      await runNonprofitScraper();
    },
  },
];

let intervalId: ReturnType<typeof setInterval> | null = null;

function chicagoParts(now: Date): { dateKey: string; hour: number; minute: number } {
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
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '00';

  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
  };
}

function chicagoWeekday(now: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
  }).format(now);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Starts the minute-granularity scheduler. Runs each job in `jobs` once, the
 * first time the clock reaches that job's hour:minute America/Chicago on a
 * given calendar day.
 */
export function start(supabase: SupabaseClient): void {
  if (intervalId !== null) return;

  intervalId = setInterval(() => {
    const { dateKey, hour, minute } = chicagoParts(new Date());

    for (const job of jobs) {
      if (
        hour === job.hour &&
        minute === job.minute &&
        job.lastFiredOnDateKey !== dateKey
      ) {
        job.lastFiredOnDateKey = dateKey;
        console.log(
          `[Scheduler] ${job.hour}:${String(job.minute).padStart(
            2,
            '0',
          )} CST reached — starting ${job.name}.`,
        );
        void job.run(supabase).catch((err: unknown) => {
          console.error(`[Scheduler] ${job.name} failed:`, errMsg(err));
        });
      }
    }
  }, CHECK_INTERVAL_MS);
}

export function stop(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
