#!/usr/bin/env node
// CLI entry point for running enrichment jobs.
//
// Usage:
//   npx tsx src/lib/enrichment/runner.ts --job-id <uuid>
//   npx tsx src/lib/enrichment/runner.ts --target foundations --sources propublica,web_search,website_scrape
//   npx tsx src/lib/enrichment/runner.ts --target foundations --config '{"batchSize":100}'

import { config as loadEnv } from "dotenv";
// Load env vars before any module that reads process.env is instantiated.
loadEnv({ path: ".env.local" });
loadEnv(); // fallback to .env

import { createAdminClient } from "../supabase/admin";
import { EnrichmentEngine, type EnrichmentConfig } from "./engine";
import type { enrichment_source } from "./types";

const TABLE_ALIASES: Record<string, EnrichmentConfig["targetTable"]> = {
  foundations: "foundation_directory",
  foundation_directory: "foundation_directory",
  prospects: "prospects",
  funders: "funders",
};

const VALID_SOURCES = new Set<string>([
  "propublica",
  "irs_990",
  "irs_990_xml",
  "irs_990_index",
  "web_search",
  "website_scrape",
  "candid",
  "manual",
]);

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg?.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

async function countPendingRecords(
  db: ReturnType<typeof createAdminClient>,
  table: string,
  resumeFromId?: string,
): Promise<number> {
  let query = db
    .from(table)
    .select("id", { count: "exact", head: true })
    .is("enriched_at", null);

  if (resumeFromId) {
    query = query.gt("id", resumeFromId);
  }

  const { count } = await query;
  return (count as number | null) ?? 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const db = createAdminClient();

  const jobIdArg = args["job-id"];
  const configJson = args["config"];
  const targetAlias = args["target"];
  const sourcesArg = args["sources"];
  const resumeFromId = args["resume-from"];

  let jobId: string;
  let engineConfig: EnrichmentConfig;

  if (jobIdArg) {
    // Resume an existing job — load its config from the DB.
    const { data: job, error } = await db
      .from("enrichment_jobs")
      .select("*")
      .eq("id", jobIdArg)
      .single();

    if (error || !job) {
      console.error(`Job ${jobIdArg} not found: ${error?.message ?? "no data"}`);
      process.exit(1);
    }

    const stored = (job.config as Partial<EnrichmentConfig>) ?? {};
    engineConfig = {
      sources: stored.sources ?? ["propublica"],
      batchSize: stored.batchSize ?? 50,
      delayBetweenMs: stored.delayBetweenMs ?? 1000,
      concurrency: stored.concurrency ?? 3,
      targetTable:
        (job.target_table as EnrichmentConfig["targetTable"]) ??
        "foundation_directory",
      resumeFromId: (job.last_processed_id as string | null) ?? undefined,
    };
    jobId = jobIdArg;
  } else if (targetAlias) {
    // Create a new job for the given target table.
    const targetTable = TABLE_ALIASES[targetAlias];
    if (!targetTable) {
      console.error(
        `Unknown target: "${targetAlias}". Valid: ${Object.keys(TABLE_ALIASES).join(", ")}`,
      );
      process.exit(1);
    }

    const extraConfig = configJson
      ? (JSON.parse(configJson) as Partial<EnrichmentConfig>)
      : {};

    const rawSources = sourcesArg ?? "propublica,web_search,website_scrape";
    const sources = rawSources
      .split(",")
      .map((s) => s.trim())
      .filter((s) => {
        if (!VALID_SOURCES.has(s)) {
          console.warn(`Unknown source "${s}" — skipping`);
          return false;
        }
        return true;
      }) as enrichment_source[];

    if (sources.length === 0) {
      console.error("No valid sources specified");
      process.exit(1);
    }

    engineConfig = {
      batchSize: 50,
      delayBetweenMs: 1000,
      concurrency: 3,
      ...extraConfig,
      sources,
      targetTable,
      resumeFromId,
    };

    const total = await countPendingRecords(db, targetTable, resumeFromId);

    const { data: newJob, error: createError } = await db
      .from("enrichment_jobs")
      .insert({
        job_type: "foundation_enrichment",
        status: "queued",
        target_table: targetTable,
        total_records: total,
        sources_used: sources,
        config: engineConfig,
      })
      .select("id")
      .single();

    if (createError || !newJob) {
      console.error(`Failed to create job: ${createError?.message ?? "unknown"}`);
      process.exit(1);
    }

    jobId = (newJob as { id: string }).id;
    console.log(
      `Created job ${jobId} — ${total} records pending, sources: ${sources.join(",")}`,
    );
  } else {
    console.error(
      [
        "Usage:",
        "  npx tsx src/lib/enrichment/runner.ts --job-id <uuid>",
        "  npx tsx src/lib/enrichment/runner.ts --target <table> [--sources <csv>] [--config <json>]",
        "",
        "Targets:  foundations | foundation_directory | prospects | funders",
        "Sources:  propublica, irs_990, irs_990_xml, web_search, website_scrape",
      ].join("\n"),
    );
    process.exit(1);
  }

  const engine = new EnrichmentEngine(engineConfig);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — pausing job ${jobId}...`);
    await engine.pause(jobId);
    console.log(`Job paused. Resume with:  --job-id ${jobId}`);
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  console.log(`Starting enrichment job ${jobId}...`);

  try {
    const result = await engine.runJob(jobId);
    console.log(
      `Done — processed=${result.processed} enriched=${result.enriched} ` +
        `failed=${result.failed} skipped=${result.skipped} ` +
        `duration=${result.duration_seconds}s`,
    );
    process.exit(0);
  } catch (err) {
    console.error("Job failed:", err);
    process.exit(1);
  }
}

void main();
