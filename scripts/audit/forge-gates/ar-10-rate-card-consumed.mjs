#!/usr/bin/env node
// FORGE gate - AR-10.1: every dollar figure must trace to the rate card.
//
// AR-6.4's own closing finding: model_cost_reference was created, seeded and
// freshness-tested, but NOTHING READS IT. ai_usage_log.cost_usd is computed by
// callers from per-file hardcoded rates across ~29 files under src/lib/pil/
// agents/. The dashboards therefore show dollars traceable to whatever each
// agent file hardcoded, not to a dated, sourced rate.
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const sh = (c) => { try { return execSync(c, { encoding: "utf8" }); } catch (e) { return e.stdout ?? ""; } };

// 1. A single pricing resolver must exist and read the table.
const R = "src/lib/pil/model-pricing.ts";
if (!existsSync(R)) fail(`${R} not found - rates must resolve through one module, not per-file constants`);
const res = readFileSync(R, "utf8");
if (!/model_cost_reference/.test(res))
  fail(`${R} never reads model_cost_reference - the rate card is still decorative`);

// 2. No hardcoded per-million-token rates left in agent files. The live rates
//    are 3/15 (sonnet-4-6) and 1/5 (haiku-4-5); any literal pairing of those
//    with a token divisor in an agent file is a bypass.
const bypass = sh(
  `grep -rn --include=*.ts --exclude-dir=node_modules --exclude-dir=__tests__ ` +
  `-E "(1_000_000|1000000|1e6)" src/lib/pil src/lib/agents | grep -viE "model-pricing|// *ok:" || true`
).split("\n").filter(Boolean);
if (bypass.length)
  fail(`${bypass.length} per-million-token cost computation(s) still outside ${R}:\n       ` +
       bypass.slice(0, 6).map((l) => l.split(":").slice(0, 2).join(":")).join("\n       ") +
       (bypass.length > 6 ? `\n       ...and ${bypass.length - 6} more` : ""));

// 3. adapter_usage_log.api_cost_cents (google-places-adapter.ts,
//    donor-discovery/connectors/usage-log.ts) is a real, live ledger too, but
//    it prices a different thing entirely: per-API-call cents charged by
//    Google Places/Apollo/Hunter, providers model_cost_reference has no rows
//    for (that table is Anthropic per-token rates only). It is not a second
//    Anthropic cost ledger and out of AR-10.1's scope - excluded by path
//    rather than flagged, same as check #2's `// ok:` escape hatch.
const adapter = sh(`grep -rn --include=*.ts --exclude-dir=node_modules --exclude-dir=__tests__ "api_cost_cents" src worker || true`)
  .split("\n").filter(Boolean)
  .filter((l) => !/\/\/|superseded|deprecated/i.test(l))
  .filter((l) => !/donor-discovery\/(adapters\/google-places-adapter|connectors\/usage-log)\.ts/.test(l));
if (adapter.length)
  fail(`api_cost_cents is written outside the known Google Places/donor-discovery adapters in ${adapter.length} place(s) - that is a second Anthropic-cost ledger:\n       ` +
       adapter.slice(0, 4).map((l) => l.split(":").slice(0, 2).join(":")).join("\n       "));

// 4. A test proving a dashboard dollar traces to a dated rate.
const T = "src/__tests__/integration/cost-traceability.test.ts";
if (!existsSync(T)) fail(`${T} not found - traceability needs a standing proof`);

console.log("OK: one pricing resolver reading model_cost_reference, no hardcoded per-MTok rates in agent files, no second cost writer");
