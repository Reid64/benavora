// PT-09-002 execution proof: AG-13 (ag-13-foundation-enrichment /
// src/lib/scraper/foundation-scraper.ts)
//
// Trigger method: direct invocation of enrichSingleFoundation(foundationId) --
// the same single-row entry point AG-42 Change Monitor chains into, reusing
// processFoundation()/buildEinIndex() unchanged. Real trigger per
// agent-inventory.json is WIRED-SCHEDULED-ENV-GATED (worker/scheduler.ts's
// 'foundation-enrichment-weekly' job, hour 3 Sunday, gated on
// ENABLE_SCRAPER='true'). That gate lives in the scheduler wrapper, not in
// this file's own functions -- enrichSingleFoundation() itself has no env
// gate, so it is directly invocable without setting ENABLE_SCRAPER; set it
// anyway for trigger-path fidelity.
//
// Real IRS 990 index/XML downloads + a real Google-search fallback + a real
// contact-page crawl (StealthEngine/Playwright, verified installed and able
// to launch chromium headless in this sandbox) -- all real HTTP GETs, no
// mocking. Bounded with a harness-level timeout since Strategy 1's IRS index
// CSV / batch ZIP downloads are large, real files.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-13.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  writeAgentResult,
} from "../pt09-002-lib.mjs";

process.env.ENABLE_SCRAPER = "true";
setupLocalEnv();

const { enrichSingleFoundation } = await import("../../../src/lib/scraper/foundation-scraper.ts");

const CANONICAL = "AG-13";
const WRITE_TABLES = ["foundation_directory"];
const RUN_TIMEOUT_MS = 110_000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`HARNESS TIMEOUT after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  const env = loadEnvironment();
  const foundationId = env.foundationDirectory[0];

  const db = await pgClient();
  const before = (
    await db.query("select * from foundation_directory where id = $1", [foundationId])
  ).rows[0];
  console.log("Before:", before);

  const log = [];
  log.push(`Target foundation_directory row: ${foundationId} (name=${before?.name}, ein=${before?.ein}, website=${before?.website}, email=${before?.email}, phone=${before?.phone}).`);
  log.push("ENABLE_SCRAPER=true set for trigger-path fidelity (not read by enrichSingleFoundation() itself, only by the scheduler wrapper that normally calls it weekly).");

  let errorSurfaced = null;
  let outcome = null;
  let timedOut = false;

  try {
    outcome = await withTimeout(
      enrichSingleFoundation(foundationId),
      RUN_TIMEOUT_MS,
      "enrichSingleFoundation()",
    );
    log.push(`enrichSingleFoundation() resolved: ${JSON.stringify(outcome)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    timedOut = /HARNESS TIMEOUT/.test(errorSurfaced);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = (
    await db.query("select * from foundation_directory where id = $1", [foundationId])
  ).rows[0];
  await db.end();

  const delta = {
    foundation_directory_website_changed: before?.website !== after?.website,
    foundation_directory_email_changed: before?.email !== after?.email,
    foundation_directory_phone_changed: before?.phone !== after?.phone,
    foundation_directory_enriched_web_at_changed: before?.enriched_web_at !== after?.enriched_web_at,
  };
  const anyFieldChanged = Object.values(delta).some(Boolean);

  let verdict;
  let reasoning;
  if (errorSurfaced && !timedOut) {
    verdict = "ERROR-SWALLOWED";
    reasoning =
      "enrichSingleFoundation() threw; caught by this harness (not silently swallowed by the app itself), but no write completed. Classified ERROR-SWALLOWED per the taxonomy's harness-caught convention.";
  } else if (timedOut) {
    verdict = "TRIGGER-BROKEN";
    reasoning =
      `The real invocation was made but did not complete within the harness's ${RUN_TIMEOUT_MS}ms bound -- Strategy 1's IRS 990 index CSV / batch ZIP download (a real multi-hundred-MB-class file from apps.irs.gov) is the most likely cause. This is an honest external-dependency timeout, not a code defect this harness can distinguish further without a much longer budget. No foundation_directory row was changed in the time available.`;
  } else if (outcome?.enriched && anyFieldChanged) {
    verdict = "WORKS";
    reasoning = `enrichSingleFoundation() returned enriched=true via strategy="${outcome.strategy}", and the foundation_directory row's website/email/phone/enriched_web_at genuinely changed to reflect real data pulled from a live external source -- matches AG-13's documented intent (waterfall enrichment writing real contact info back to foundation_directory).`;
  } else if (outcome && !outcome.enriched) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `enrichSingleFoundation() ran to completion cleanly (no throw) and returned enriched=false, strategy="${outcome.strategy}" -- meaning none of the three waterfall strategies (IRS 990 XML match / Google fallback / contact-page extraction) found anything for this row, and no foundation_directory column was patched. This is a genuine "ran clean, wrote nothing" result for this specific seed row (no real-world EIN on file to match against the IRS index, and/or Google's CAPTCHA breaker or contact-page extraction found nothing) -- flagged per the taxonomy regardless of the plausible per-row cause.`;
  } else if (outcome === null) {
    verdict = "TRIGGER-BROKEN";
    reasoning = "enrichSingleFoundation() returned null, meaning its own initial row lookup (select ... eq('id', foundationId)) failed to find the seeded row or errored -- the invocation itself never reached the enrichment waterfall.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Unexpected outcome shape with no error and no clear enriched flag; treating as an inconclusive/broken invocation.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-13-foundation-enrichment",
    implementingFile: "src/lib/scraper/foundation-scraper.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct invocation via tsx against the local pt05-local-stack: enrichSingleFoundation(foundationId) -- the exported single-row entry point this file's own header documents as AG-42 Change Monitor's real chain target, reusing the same processFoundation()/buildEinIndex() waterfall the weekly 'foundation-enrichment-weekly' scheduled job (worker/scheduler.ts) uses. Real network calls throughout: IRS 990 index/XML download (apps.irs.gov), Google search fallback, and a real Playwright/Chromium-driven contact-page crawl via StealthEngine (chromium launch verified working in this sandbox before running). No mocking.",
    before: before ? { id: before.id, name: before.name, ein: before.ein, website: before.website, email: before.email, phone: before.phone, enriched_web_at: before.enriched_web_at } : null,
    after: after ? { id: after.id, name: after.name, ein: after.ein, website: after.website, email: after.email, phone: after.phone, enriched_web_at: after.enriched_web_at } : null,
    rowDelta: delta,
    sampleWrittenRow: after ? { id: after.id, name: after.name, ein: after.ein, website: after.website, email: after.email, phone: after.phone, enrichment: after.enrichment, enriched_web_at: after.enriched_web_at, website_discovered_via: after.website_discovered_via } : null,
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED-ENV-GATED ('foundation-enrichment-weekly' worker/scheduler.ts job, hour 3 Sunday, gated on ENABLE_SCRAPER='true'; CONFIRMED STARTED per boot-inventory + confirmedFiringLive per cron-reconciliation).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
