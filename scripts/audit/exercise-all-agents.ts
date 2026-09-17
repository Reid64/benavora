// AR-4.1 Step 3 — the agent exercise harness. Invokes every agent in
// agent-exercise-registry.ts against the seed-exercise-org.ts fixture,
// records what actually happened, and writes AGENT_EXERCISE_REPORT.md +
// agent-exercise-results.json. This script is a measurement instrument, not
// a gate — it always exits 0. A failing/no-op agent is data, not a harness
// failure.
//
// Usage:
//   pnpm tsx scripts/audit/exercise-all-agents.ts --dry-run
//   pnpm tsx scripts/audit/exercise-all-agents.ts --family=pil --max-agents=10
//   pnpm tsx scripts/audit/exercise-all-agents.ts --families=core,autoapply
//   pnpm tsx scripts/audit/exercise-all-agents.ts --agent=BEN-SUP-01
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import fs from "node:fs";
import path from "node:path";
import { createAdminClient } from "../../src/lib/supabase/admin";
import { seedExerciseOrg, type SeededFixture } from "./seed-exercise-org";
import { AGENT_REGISTRY, countByFamily, type AgentDescriptor, type AgentFamily } from "./agent-exercise-registry";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PER_AGENT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_AGENTS = 25;

type Outcome = "success" | "threw" | "timeout" | "no_effect" | "skipped";

interface ExerciseResult {
  agentType: string;
  family: AgentFamily;
  modulePath: string;
  exportName: string;
  invoked: boolean;
  outcome: Outcome;
  durationMs: number;
  errorMessage: string | null;
  rowAppeared: boolean;
}

interface Args {
  families: string[] | null;
  agent: string | null;
  dryRun: boolean;
  maxAgents: number;
  allowRealOrg: boolean;
}

function parseArgs(argv: string[]): Args {
  let families: string[] | null = null;
  let agent: string | null = null;
  let dryRun = false;
  let maxAgents = DEFAULT_MAX_AGENTS;
  let allowRealOrg = false;

  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--allow-real-org") allowRealOrg = true;
    else if (arg.startsWith("--family=")) families = arg.slice("--family=".length).split(",").filter(Boolean);
    else if (arg.startsWith("--families=")) families = arg.slice("--families=".length).split(",").filter(Boolean);
    else if (arg.startsWith("--agent=")) agent = arg.slice("--agent=".length);
    else if (arg.startsWith("--max-agents=")) maxAgents = Number.parseInt(arg.slice("--max-agents=".length), 10);
  }

  return { families, agent, dryRun, maxAgents, allowRealOrg };
}

function selectAgents(args: Args): { selected: AgentDescriptor[]; dropped: AgentDescriptor[] } {
  let pool = AGENT_REGISTRY;
  if (args.families) {
    const set = new Set(args.families);
    pool = pool.filter((a) => set.has(a.family));
  }
  if (args.agent) {
    pool = pool.filter((a) => a.agentType === args.agent);
  }

  if (Number.isFinite(args.maxAgents) && args.maxAgents >= 0 && pool.length > args.maxAgents) {
    return { selected: pool.slice(0, args.maxAgents), dropped: pool.slice(args.maxAgents) };
  }
  return { selected: pool, dropped: [] };
}

function printDryRun(selected: AgentDescriptor[], dropped: AgentDescriptor[]): void {
  const byFamily = new Map<AgentFamily, AgentDescriptor[]>();
  for (const entry of selected) {
    const list = byFamily.get(entry.family) ?? [];
    list.push(entry);
    byFamily.set(entry.family, list);
  }

  console.log(`DRY RUN — would invoke ${selected.length} agent(s), grouped by family:\n`);
  for (const [family, entries] of byFamily) {
    console.log(`${family} (${entries.length}):`);
    for (const entry of entries) {
      console.log(`  - ${entry.agentType}  (${entry.modulePath} :: ${entry.exportName})`);
    }
    console.log("");
  }
  if (dropped.length > 0) {
    console.log(`DROPPED by --max-agents cap (${dropped.length} not listed above, not invoked):`);
    for (const entry of dropped) console.log(`  - ${entry.agentType} (${entry.family})`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`__HARNESS_TIMEOUT__:${ms}ms`)), ms)),
  ]);
}

async function rowAppearedFor(
  client: ReturnType<typeof createAdminClient>,
  entry: AgentDescriptor,
  fixture: SeededFixture,
  sinceIso: string,
): Promise<{ appeared: boolean; status: string | null; error: string | null }> {
  if (entry.writesTable === "agent_runs") {
    const { data } = await client
      .from("agent_runs")
      .select("status, error_message, created_at")
      .eq("organization_id", fixture.orgId)
      .eq("agent_type", entry.agentType)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return { appeared: false, status: null, error: null };
    return { appeared: true, status: data.status as string, error: (data as any).error_message ?? null };
  }
  if (entry.writesTable === "pil_agent_runs") {
    const { data } = await client
      .from("pil_agent_runs")
      .select("status, error, created_at")
      .eq("organization_id", fixture.orgId)
      .eq("agent_id", entry.agentType)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return { appeared: false, status: null, error: null };
    return { appeared: true, status: data.status as string, error: (data as any).error ?? null };
  }
  // writesTable === "none": look for a newly-created alerts row instead —
  // the only side-effect channel these plain functions have (per their own
  // file-header comments).
  const { data } = await client
    .from("alerts")
    .select("id, created_at")
    .eq("organization_id", fixture.orgId)
    .gte("created_at", sinceIso)
    .limit(1)
    .maybeSingle();
  return { appeared: !!data, status: data ? "alert_written" : null, error: null };
}

async function exerciseOne(
  client: ReturnType<typeof createAdminClient>,
  entry: AgentDescriptor,
  fixture: SeededFixture,
): Promise<ExerciseResult> {
  const sinceIso = new Date(Date.now() - 1000).toISOString();
  const start = Date.now();

  try {
    await withTimeout(entry.invoke({ client, fixture }), PER_AGENT_TIMEOUT_MS);
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("__HARNESS_TIMEOUT__")) {
      return {
        agentType: entry.agentType,
        family: entry.family,
        modulePath: entry.modulePath,
        exportName: entry.exportName,
        invoked: true,
        outcome: "timeout",
        durationMs,
        errorMessage: `exceeded ${PER_AGENT_TIMEOUT_MS}ms`,
        rowAppeared: false,
      };
    }
    const check = await rowAppearedFor(client, entry, fixture, sinceIso).catch(() => ({ appeared: false, status: null, error: null }));
    return {
      agentType: entry.agentType,
      family: entry.family,
      modulePath: entry.modulePath,
      exportName: entry.exportName,
      invoked: true,
      outcome: "threw",
      durationMs,
      errorMessage: message,
      rowAppeared: check.appeared,
    };
  }

  const durationMs = Date.now() - start;
  const check = await rowAppearedFor(client, entry, fixture, sinceIso).catch(() => ({ appeared: false, status: null, error: null }));

  if (!check.appeared) {
    return {
      agentType: entry.agentType,
      family: entry.family,
      modulePath: entry.modulePath,
      exportName: entry.exportName,
      invoked: true,
      outcome: "no_effect",
      durationMs,
      errorMessage: null,
      rowAppeared: false,
    };
  }

  if (check.status === "failed") {
    return {
      agentType: entry.agentType,
      family: entry.family,
      modulePath: entry.modulePath,
      exportName: entry.exportName,
      invoked: true,
      outcome: "threw",
      durationMs,
      errorMessage: check.error,
      rowAppeared: true,
    };
  }

  if (check.status === "completed" || check.status === "alert_written") {
    return {
      agentType: entry.agentType,
      family: entry.family,
      modulePath: entry.modulePath,
      exportName: entry.exportName,
      invoked: true,
      outcome: "success",
      durationMs,
      errorMessage: null,
      rowAppeared: true,
    };
  }

  // Any other terminal PIL status (blocked, escalated, queued, running left
  // stuck) — a row exists but no real completed work happened.
  return {
    agentType: entry.agentType,
    family: entry.family,
    modulePath: entry.modulePath,
    exportName: entry.exportName,
    invoked: true,
    outcome: "no_effect",
    durationMs,
    errorMessage: check.status ? `row status: ${check.status}` : null,
    rowAppeared: true,
  };
}

function writeReport(results: ExerciseResult[], dropped: AgentDescriptor[]): void {
  const byFamily = new Map<AgentFamily, ExerciseResult[]>();
  for (const r of results) {
    const list = byFamily.get(r.family) ?? [];
    list.push(r);
    byFamily.set(r.family, list);
  }
  const byOutcome: Record<string, number> = {};
  for (const r of results) byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;

  const lines: string[] = [];
  lines.push("# AGENT_EXERCISE_REPORT.md");
  lines.push("");
  lines.push(`Generated by \`pnpm tsx scripts/audit/exercise-all-agents.ts\` at ${new Date().toISOString()}.`);
  lines.push("");
  lines.push(`Invoked ${results.length} agent(s)${dropped.length > 0 ? `, ${dropped.length} dropped by --max-agents cap (not invoked)` : ""}.`);
  lines.push("");
  lines.push("## Summary by outcome");
  lines.push("");
  lines.push("| Outcome | Count |");
  lines.push("|---|---|");
  for (const [outcome, count] of Object.entries(byOutcome)) lines.push(`| ${outcome} | ${count} |`);
  lines.push("");
  lines.push("## Summary by family");
  lines.push("");
  lines.push("| Family | Invoked | success | threw | timeout | no_effect |");
  lines.push("|---|---|---|---|---|---|");
  for (const [family, list] of byFamily) {
    const s = list.filter((r) => r.outcome === "success").length;
    const t = list.filter((r) => r.outcome === "threw").length;
    const to = list.filter((r) => r.outcome === "timeout").length;
    const n = list.filter((r) => r.outcome === "no_effect").length;
    lines.push(`| ${family} | ${list.length} | ${s} | ${t} | ${to} | ${n} |`);
  }
  lines.push("");
  if (dropped.length > 0) {
    lines.push(`## Dropped by --max-agents cap (${dropped.length}, not invoked)`);
    lines.push("");
    for (const entry of dropped) lines.push(`- ${entry.agentType} (${entry.family})`);
    lines.push("");
  }
  lines.push("## Per-agent detail");
  lines.push("");
  lines.push("| agent_type | family | module | invoked | outcome | duration_ms | row appeared | error |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const err = r.errorMessage ? r.errorMessage.replace(/\|/g, "\\|").slice(0, 200) : "";
    lines.push(
      `| ${r.agentType} | ${r.family} | ${r.modulePath} | ${r.invoked ? "yes" : "no"} | ${r.outcome} | ${r.durationMs} | ${r.rowAppeared ? "yes" : "no"} | ${err} |`,
    );
  }
  lines.push("");

  fs.writeFileSync(path.join(REPO_ROOT, "AGENT_EXERCISE_REPORT.md"), lines.join("\n"));
  fs.writeFileSync(
    path.join(REPO_ROOT, "scripts", "audit", "agent-exercise-results.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), results, dropped: dropped.map((d) => d.agentType) }, null, 2),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { selected, dropped } = selectAgents(args);

  if (args.dryRun) {
    printDryRun(selected, dropped);
    process.exit(0);
  }

  console.log(`Seeding exercise org fixture...`);
  const fixture = await seedExerciseOrg();
  const client = createAdminClient();

  const { data: org } = await client.from("organizations").select("name").eq("id", fixture.orgId).maybeSingle();
  if (!org?.name?.startsWith("EXERCISE-HARNESS-") && !args.allowRealOrg) {
    console.error(
      `Refusing to run: fixture organization "${org?.name}" does not start with "EXERCISE-HARNESS-". Pass --allow-real-org to override.`,
    );
    process.exit(0);
  }

  console.log(`Invoking ${selected.length} agent(s) (dropped ${dropped.length} by --max-agents cap)...`);
  const results: ExerciseResult[] = [];
  for (const entry of selected) {
    console.log(`  -> ${entry.agentType} (${entry.family})`);
    const result = await exerciseOne(client, entry, fixture);
    console.log(`     ${result.outcome} in ${result.durationMs}ms${result.errorMessage ? ` — ${result.errorMessage.slice(0, 120)}` : ""}`);
    results.push(result);
  }

  writeReport(results, dropped);
  console.log(`\nWrote AGENT_EXERCISE_REPORT.md and scripts/audit/agent-exercise-results.json`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Harness crashed (this should not happen — every per-agent failure should have been caught):", err);
  process.exit(0);
});
