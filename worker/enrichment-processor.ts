// Corporate Intelligence enrichment pipeline orchestrator
// (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2C, "Enrichment Pipeline"):
//
//   corporate_prospects (unenriched)
//     -> Enrichment Queue (Railway worker)
//     -> EA-01 through EA-10 run sequentially per company
//     -> results merged into enrichment jsonb
//     -> enrichment_completed_at set
//     -> Score Engine triggered automatically
//
//   Rate limiting: 1 company per 3 seconds overall.
//   Batch size: 500 companies per Railway worker run.
//
// Orchestration only. This file wires the 10 EA-0X BaseAgent subclasses
// already built (src/lib/agents/ea-01-giving-detector.ts through
// ea-10-social-media-analyzer.ts) into the batch/pace/dependency contract
// §2C specifies -- it adds no enrichment logic of its own. Every EA-0X agent
// already merges its own patch into `enrichment` jsonb via
// mergeEnrichmentPatch() (corporate-enrichment-shared.ts) and self-gates on
// its documented dependency by checking for the prerequisite agent's key in
// that jsonb (see ea-03/ea-06/ea-07/ea-10's own header comments). Calling
// all 10 in strict numeric order, each awaited before the next starts,
// therefore satisfies every dependency §2C lists (EA-03 after EA-01,
// EA-06/EA-07 after EA-02, EA-10 after EA-08) without this file needing to
// encode the dependency graph itself.
//
// Naming note: AGENTS_v2.md's AG-13 (Foundation Enrichment Agent) entry
// describes a `worker/enrichment-processor.ts` that "does not exist anywhere
// in worker/" for foundation_directory (133K+ records) enrichment -- a
// different feature area. This file is NOT that one. This session's task
// explicitly directs this filename for the Corporate Intelligence pipeline
// (corporate_prospects, EA-01..EA-10) per
// CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2C -- flagging so a future session
// doesn't conflate the two.
//
// Score Engine (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §3, Propensity
// Scoring PS-01..PS-10 / AGENTS_v2.md AG-22): verified via repo-wide grep
// this session -- no implementation exists anywhere in this codebase
// (AGENTS_v2.md §5 AG-22 status: PLANNED; worker/batch-scorer.ts is an
// unrelated agent -- it reorders AutoApply's submission_queue, not
// corporate_prospects propensity). triggerScoreEngine() below is the
// documented call site for that agent once it exists; until then it only
// logs, so this pipeline never fabricates a `scores`/`scores_computed_at`
// value.
//
// corporate_prospects has no organization_id (shared, cross-org table --
// corporate-enrichment-shared.ts). BaseAgent still requires one for its own
// agent_runs audit trail. Reuses the same SYSTEM_ORG_ID sentinel
// learning-network-aggregator-agent.ts (AG-36) already established for
// exactly this situation -- a platform-level background pipeline with no
// requesting org.
//
// This module is not wired into worker/index.ts's boot sequence by this
// change. Call start(supabase) from index.ts when this pipeline is ready to
// run continuously in production; runEnrichmentBatch(supabase) is also
// exported standalone for a one-shot/manual/CLI run in the meantime.

import type { SupabaseClient } from '@supabase/supabase-js';

import { EA01GivingDetectorAgent } from '../src/lib/agents/ea-01-giving-detector.js';
import { EA02CommunityOutreachDetectorAgent } from '../src/lib/agents/ea-02-community-outreach-detector.js';
import { EA03SponsorshipDetectorAgent } from '../src/lib/agents/ea-03-sponsorship-detector.js';
import { EA04FoundationDetectorAgent } from '../src/lib/agents/ea-04-foundation-detector.js';
import { EA05CareerPageAnalyzerAgent } from '../src/lib/agents/ea-05-career-page-analyzer.js';
import { EA06PressReleaseAnalyzerAgent } from '../src/lib/agents/ea-06-press-release-analyzer.js';
import { EA07EsgAnalyzerAgent } from '../src/lib/agents/ea-07-esg-analyzer.js';
import { EA08ExecutiveBiographyAnalyzerAgent } from '../src/lib/agents/ea-08-executive-biography-analyzer.js';
import { EA09ContactExtractorAgent } from '../src/lib/agents/ea-09-contact-extractor.js';
import { EA10SocialMediaAnalyzerAgent } from '../src/lib/agents/ea-10-social-media-analyzer.js';
import type { BaseAgent, BaseAgentOptions } from '../src/lib/agents/base-agent.js';

/** Same sentinel AG-36 (Learning Network Aggregator) uses for platform-level, non-org-scoped agent runs. */
const SYSTEM_ORG_ID = '00000000-0000-4000-8000-000000000036';
const SYSTEM_ORG_NAME = 'Benavora Platform (System)';

/** §2C: "Batch size: 500 companies per Railway worker run." */
const BATCH_SIZE = 500;
/** §2C: "Rate limiting: 1 company per 3 seconds overall." */
const RATE_LIMIT_MS = 3_000;
/** How long to wait before re-checking for unenriched companies once a batch finds none. */
const POLL_INTERVAL_MS = 60_000;

interface ProspectRow {
  id: string;
  legal_name: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Idempotent. Same pattern as AG-36's ensureSystemOrg() -- agent_runs.organization_id needs a real organizations row to satisfy the FK. */
async function ensureSystemOrg(supabase: SupabaseClient): Promise<void> {
  const { data: existing } = await supabase
    .from('organizations')
    .select('id')
    .eq('id', SYSTEM_ORG_ID)
    .maybeSingle();

  if (existing) return;

  const { error } = await supabase.from('organizations').insert({
    id: SYSTEM_ORG_ID,
    name: SYSTEM_ORG_NAME,
    onboarding_completed: true,
  });

  if (error && !/duplicate key/i.test(error.message ?? '')) {
    throw new Error(
      `Failed to provision system organization for corporate enrichment runs: ${error.message}`,
    );
  }
}

/**
 * Score Engine trigger (§2C, §3 Propensity Scoring PS-01..PS-10). No such
 * agent exists in this codebase yet (AGENTS_v2.md §5 AG-22: PLANNED). This
 * is the documented call site for it once built.
 */
async function triggerScoreEngine(prospectId: string): Promise<void> {
  console.log(
    `[EnrichmentProcessor] Score Engine trigger for prospect ${prospectId} -- ` +
      'no PS-01..PS-10 propensity scoring agent exists in this codebase yet (AG-22, PLANNED). Skipped.',
  );
}

/** Runs EA-01 through EA-10 sequentially for one prospect (§2C dependency order). */
async function enrichProspect(
  supabase: SupabaseClient,
  prospect: ProspectRow,
): Promise<void> {
  const options: BaseAgentOptions = { client: supabase, organizationId: SYSTEM_ORG_ID };
  const input = { prospectId: prospect.id };

  const agents: BaseAgent<{ prospectId: string }, unknown>[] = [
    new EA01GivingDetectorAgent(options),
    new EA02CommunityOutreachDetectorAgent(options),
    new EA03SponsorshipDetectorAgent(options),
    new EA04FoundationDetectorAgent(options),
    new EA05CareerPageAnalyzerAgent(options),
    new EA06PressReleaseAnalyzerAgent(options),
    new EA07EsgAnalyzerAgent(options),
    new EA08ExecutiveBiographyAnalyzerAgent(options),
    new EA09ContactExtractorAgent(options),
    new EA10SocialMediaAnalyzerAgent(options),
  ];

  for (const agent of agents) {
    try {
      await agent.run(input);
    } catch (err) {
      // One agent's failure doesn't block the rest of the sequence -- each
      // dependent agent (EA-03/06/07/10) already handles a
      // skipped/not-yet-run prerequisite gracefully via its own
      // hasOwnProperty check on `enrichment`.
      console.error(
        `[EnrichmentProcessor] ${agent.agentType} failed for prospect ${prospect.id} ` +
          `(${prospect.legal_name}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // §2C: "set enrichment_completed_at". Guaranteed here even if every
  // EA-0X agent above skipped its own mergeEnrichmentPatch() write (e.g. no
  // website on file, or every dependency check short-circuited) --
  // corporate-enrichment-shared.ts's mergeEnrichmentPatch() also stamps this
  // column on each successful patch, so this is a final, authoritative
  // stamp rather than new enrichment content.
  await supabase
    .from('corporate_prospects')
    .update({ enrichment_completed_at: new Date().toISOString() })
    .eq('id', prospect.id);

  await triggerScoreEngine(prospect.id);
}

/** Runs one batch of up to BATCH_SIZE unenriched companies (§2C). */
export async function runEnrichmentBatch(
  supabase: SupabaseClient,
): Promise<{ processed: number }> {
  await ensureSystemOrg(supabase);

  const { data, error } = await supabase
    .from('corporate_prospects')
    .select('id, legal_name')
    .is('enrichment_completed_at', null)
    .order('first_seen_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error(`[EnrichmentProcessor] Batch query failed: ${error.message}`);
    return { processed: 0 };
  }

  const prospects = (data ?? []) as ProspectRow[];
  if (prospects.length === 0) return { processed: 0 };

  console.log(
    `[EnrichmentProcessor] Batch starting -- ${prospects.length} unenriched compan${
      prospects.length === 1 ? 'y' : 'ies'
    }`,
  );

  for (let i = 0; i < prospects.length; i++) {
    if (i > 0) await sleep(RATE_LIMIT_MS); // §2C: 1 company per 3 seconds overall
    const prospect = prospects[i]!;
    try {
      await enrichProspect(supabase, prospect);
    } catch (err) {
      console.error(
        `[EnrichmentProcessor] Prospect ${prospect.id} (${prospect.legal_name}) failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`[EnrichmentProcessor] Batch complete -- ${prospects.length} processed`);
  return { processed: prospects.length };
}

// --- Continuous poll loop (Railway worker) ------------------------------
// Structurally mirrors worker/dd-request-processor.ts's start/stop/
// waitForIdle convention.

let running = false;
let processing = false;
const idleResolvers: Array<() => void> = [];

function resolveIdle(): void {
  for (const resolve of idleResolvers) resolve();
  idleResolvers.length = 0;
}

async function loop(supabase: SupabaseClient): Promise<void> {
  while (running) {
    processing = true;
    let result: { processed: number };
    try {
      result = await runEnrichmentBatch(supabase);
    } catch (err) {
      console.error('[EnrichmentProcessor] Batch run crashed:', err);
      result = { processed: 0 };
    }
    processing = false;

    if (!running) break;
    if (result.processed === 0) {
      await sleep(POLL_INTERVAL_MS);
    }
  }
  resolveIdle();
}

/** Begin the continuous poll loop. */
export function start(supabase: SupabaseClient): void {
  if (running) return;
  running = true;
  console.log('[EnrichmentProcessor] Starting');
  void loop(supabase);
}

/** Signal the loop to stop. Resolves immediately if idle. */
export function stop(): void {
  running = false;
  if (!processing) resolveIdle();
}

/** Resolves when the current batch finishes (or immediately if idle). */
export function waitForIdle(): Promise<void> {
  if (!processing) return Promise.resolve();
  return new Promise((resolve) => {
    idleResolvers.push(resolve);
  });
}
