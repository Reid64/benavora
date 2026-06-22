// EnrichmentEngine — orchestrates the waterfall enrichment pipeline.
// Designed to run as a long-lived Node.js process. All progress is written to
// Supabase so the web UI can poll for updates.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";
import { IRS990Source } from "./sources/irs990";
import { ProPublicaSource } from "./sources/propublica";
import { WebSearchSource } from "./sources/web-search";
import { WebsiteScraper } from "./sources/website-scraper";
import type { enrichment_source, EnrichmentResult } from "./types";

export interface EnrichmentConfig {
  sources: enrichment_source[];
  batchSize?: number;
  delayBetweenMs?: number;
  concurrency?: number;
  targetTable: "foundation_directory" | "prospects" | "funders";
  resumeFromId?: string;
}

export interface JobResult {
  processed: number;
  enriched: number;
  failed: number;
  skipped: number;
  duration_seconds: number;
}

export interface JobProgress {
  total: number;
  processed: number;
  enriched: number;
  failed: number;
  skipped: number;
  percent_complete: number;
  estimated_remaining_minutes: number;
  current_source: string;
  last_entity_name: string;
}

interface RawRecord {
  id: string;
  ein?: string | null;
  name?: string | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  enriched_at?: string | null;
}

interface JobCounters {
  processed: number;
  enriched: number;
  failed: number;
  skipped: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Later sources fill gaps — they do NOT overwrite data found by earlier sources.
function mergeResults(results: EnrichmentResult[]): EnrichmentResult | null {
  if (results.length === 0) return null;

  const first = results.at(0);
  if (!first) return null;

  const merged: EnrichmentResult = {
    source: first.source,
    emails: [],
    phones: [],
    officers: [],
    confidence: 0,
    raw: {},
  };

  const emailSet = new Set<string>();
  const phoneSet = new Set<string>();
  const officerKeys = new Set<string>();

  for (const r of results) {
    if (!merged.website && r.website) merged.website = r.website;
    if (merged.revenue === undefined && r.revenue !== undefined) merged.revenue = r.revenue;
    if (merged.assets === undefined && r.assets !== undefined) merged.assets = r.assets;
    if (merged.giving === undefined && r.giving !== undefined) merged.giving = r.giving;
    if (!merged.address && r.address) merged.address = r.address;
    if (!merged.programs && r.programs) merged.programs = r.programs;

    for (const e of r.emails) {
      if (!emailSet.has(e)) {
        emailSet.add(e);
        merged.emails.push(e);
      }
    }
    for (const p of r.phones) {
      if (!phoneSet.has(p)) {
        phoneSet.add(p);
        merged.phones.push(p);
      }
    }
    for (const o of r.officers) {
      const key = `${o.name}|${o.title}`;
      if (!officerKeys.has(key)) {
        officerKeys.add(key);
        merged.officers.push(o);
      }
    }
    if (r.confidence > merged.confidence) merged.confidence = r.confidence;
  }

  return merged;
}

// Map TS source type to DB enrichment_source enum value.
function toDbSource(source: enrichment_source): string {
  if (source === "irs_990_xml" || source === "irs_990_index" || source === "irs_990") {
    return "irs_990";
  }
  return source;
}

function hasIrs990Source(sources: enrichment_source[]): boolean {
  return sources.some(
    (s) => s === "irs_990" || s === "irs_990_xml" || s === "irs_990_index",
  );
}

export class EnrichmentEngine {
  private readonly sources: enrichment_source[];
  private readonly batchSize: number;
  private readonly delayBetweenMs: number;
  private readonly concurrency: number;
  private readonly targetTable: "foundation_directory" | "prospects" | "funders";
  private readonly resumeFromId: string | undefined;
  private readonly xmlDir: string;
  private readonly db: SupabaseClient;
  private readonly irs990 = new IRS990Source();
  private readonly propublica = new ProPublicaSource();
  private readonly webSearch = new WebSearchSource();
  private readonly scraper = new WebsiteScraper();
  private shouldPause = false;

  constructor(config: EnrichmentConfig) {
    this.sources = config.sources;
    this.batchSize = config.batchSize ?? 50;
    this.delayBetweenMs = config.delayBetweenMs ?? 1000;
    this.concurrency = config.concurrency ?? 3;
    this.targetTable = config.targetTable;
    this.resumeFromId = config.resumeFromId;
    this.xmlDir = process.env.IRS_990_XML_DIR ?? "";
    this.db = createAdminClient();
  }

  async runJob(jobId: string): Promise<JobResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    const { data: job, error: jobFetchError } = await this.db
      .from("enrichment_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobFetchError || !job) {
      throw new Error(
        `Job ${jobId} not found: ${String(jobFetchError?.message ?? "no data")}`,
      );
    }

    await this.db
      .from("enrichment_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", jobId);

    const counters: JobCounters = {
      processed: (job.processed as number | null) ?? 0,
      enriched: (job.enriched as number | null) ?? 0,
      failed: (job.failed as number | null) ?? 0,
      skipped: (job.skipped as number | null) ?? 0,
    };

    let lastId: string | undefined =
      this.resumeFromId ?? (job.last_processed_id as string | null) ?? undefined;
    let hasMore = true;

    while (hasMore && !this.shouldPause) {
      let query = this.db
        .from(this.targetTable)
        .select("id, ein, name, city, state, website, enriched_at")
        .order("id")
        .limit(this.batchSize);

      if (lastId !== undefined) {
        query = query.gt("id", lastId);
      }

      const { data: batch, error: batchError } = await query;

      if (batchError) {
        errors.push(
          `Batch fetch after id=${lastId ?? "start"}: ${batchError.message}`,
        );
        break;
      }

      if (!batch || batch.length === 0) {
        hasMore = false;
        break;
      }

      const records = batch as RawRecord[];

      for (let i = 0; i < records.length; i += this.concurrency) {
        if (this.shouldPause) break;

        const chunk = records.slice(i, i + this.concurrency);

        await Promise.all(
          chunk.map(async (record) => {
            try {
              await this.processRecord(record, jobId, counters);
            } catch (err) {
              counters.failed++;
              errors.push(
                `Record ${record.id} (${record.name ?? "?"}): ${String(err)}`,
              );
            }
          }),
        );

        const chunkLast = chunk.at(-1);
        if (chunkLast) {
          lastId = chunkLast.id;
        }

        await this.db
          .from("enrichment_jobs")
          .update({
            processed: counters.processed,
            enriched: counters.enriched,
            failed: counters.failed,
            skipped: counters.skipped,
            last_processed_id: lastId ?? null,
          })
          .eq("id", jobId);

        // Check for external pause/cancel signal from the DB
        const { data: refreshed } = await this.db
          .from("enrichment_jobs")
          .select("status")
          .eq("id", jobId)
          .single();

        const externalStatus = refreshed?.status as string | undefined;
        if (externalStatus === "paused" || externalStatus === "cancelled") {
          this.shouldPause = true;
          break;
        }

        if (this.delayBetweenMs > 0 && i + this.concurrency < records.length) {
          await sleep(this.delayBetweenMs);
        }
      }

      if (batch.length < this.batchSize) {
        hasMore = false;
      }
    }

    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    const finalUpdate = {
      processed: counters.processed,
      enriched: counters.enriched,
      failed: counters.failed,
      skipped: counters.skipped,
      last_processed_id: lastId ?? null,
      error_log: errors.slice(0, 100),
    };

    if (this.shouldPause) {
      await this.db
        .from("enrichment_jobs")
        .update({ ...finalUpdate, status: "paused", paused_at: new Date().toISOString() })
        .eq("id", jobId);
    } else {
      await this.db
        .from("enrichment_jobs")
        .update({
          ...finalUpdate,
          status: "completed",
          completed_at: new Date().toISOString(),
          results_summary: {
            processed: counters.processed,
            enriched: counters.enriched,
            failed: counters.failed,
            skipped: counters.skipped,
            duration_seconds: durationSeconds,
            sources_used: this.sources,
          },
        })
        .eq("id", jobId);
    }

    return { ...counters, duration_seconds: durationSeconds };
  }

  private async processRecord(
    record: RawRecord,
    jobId: string,
    counters: JobCounters,
  ): Promise<void> {
    // Skip already-enriched records
    if (record.enriched_at) {
      counters.skipped++;
      return;
    }

    const sourceResults: EnrichmentResult[] = [];
    let currentWebsite = record.website ?? undefined;

    // IRS 990 — local XML lookup
    if (hasIrs990Source(this.sources) && record.ein && this.xmlDir) {
      const result = await this.irs990.enrichFromLocalXml(record.ein, this.xmlDir);
      if (result) {
        sourceResults.push(result);
        if (!currentWebsite && result.website) currentWebsite = result.website;
      }
    }

    // ProPublica — EIN lookup preferred, name search as fallback
    if (this.sources.includes("propublica")) {
      if (record.ein) {
        const result = await this.propublica.searchByEin(record.ein);
        if (result) {
          sourceResults.push(result);
          if (!currentWebsite && result.website) currentWebsite = result.website;
        }
      } else if (record.name) {
        const results = await this.propublica.searchByName(
          record.name,
          record.state ?? undefined,
        );
        const first = results.at(0);
        if (first) sourceResults.push(first);
      }
    }

    // Web Search — find website when not yet known from any source
    if (this.sources.includes("web_search") && !currentWebsite && record.name) {
      const websiteUrl = await this.webSearch.searchForWebsite(
        record.name,
        record.city ?? undefined,
        record.state ?? undefined,
      );
      if (websiteUrl) {
        currentWebsite = websiteUrl;
        sourceResults.push({
          source: "web_search",
          website: websiteUrl,
          emails: [],
          phones: [],
          officers: [],
          confidence: 0.5,
          raw: { found_via: "web_search" },
        });
      }
    }

    // Website Scrape — extract contacts from the known website
    if (this.sources.includes("website_scrape") && currentWebsite) {
      const contacts = await this.scraper.scrapeContactInfo(currentWebsite);
      if (
        contacts.emails.length > 0 ||
        contacts.phones.length > 0 ||
        contacts.officers.length > 0
      ) {
        sourceResults.push({
          source: "website_scrape",
          website: currentWebsite,
          emails: contacts.emails,
          phones: contacts.phones,
          officers: contacts.officers,
          confidence: 0.7,
          raw: { found_via: "website_scrape" },
        });
      }
    }

    counters.processed++;

    if (sourceResults.length === 0) {
      counters.skipped++;
      return;
    }

    const merged = mergeResults(sourceResults);
    if (!merged) {
      counters.skipped++;
      return;
    }

    const primarySource = sourceResults.at(0);
    if (!primarySource) {
      counters.skipped++;
      return;
    }

    const allDbSources = [
      ...new Set(sourceResults.map((r) => toDbSource(r.source))),
    ];

    await this.db.from("enrichment_results").insert({
      job_id: jobId,
      entity_id: record.id,
      entity_name: record.name ?? null,
      entity_ein: record.ein ?? null,
      source: toDbSource(primarySource.source),
      found_website: merged.website ?? null,
      found_emails: merged.emails,
      found_phones: merged.phones,
      found_officers: merged.officers,
      found_revenue: merged.revenue ?? null,
      found_assets: merged.assets ?? null,
      found_giving: merged.giving ?? null,
      found_programs: merged.programs ?? null,
      found_address: merged.address ?? null,
      confidence: merged.confidence,
      raw_data: { sources: sourceResults.map((r) => r.raw) },
      applied_to_db: false,
    });

    await this.updateTargetRecord(record.id, merged, allDbSources.join(","));

    await this.db
      .from("enrichment_results")
      .update({ applied_to_db: true })
      .eq("job_id", jobId)
      .eq("entity_id", record.id);

    counters.enriched++;
  }

  private async updateTargetRecord(
    id: string,
    merged: EnrichmentResult,
    sourceName: string,
  ): Promise<void> {
    const update: Record<string, unknown> = {
      enriched_at: new Date().toISOString(),
      enrichment_source: sourceName,
    };

    if (merged.website) update.website = merged.website;
    if (merged.emails.length > 0) update.contact_emails = merged.emails;
    if (merged.phones.length > 0) update.contact_phones = merged.phones;
    if (merged.officers.length > 0) update.officers = merged.officers;
    if (merged.revenue !== undefined) update.revenue_amount = merged.revenue;
    if (merged.assets !== undefined) update.asset_amount = merged.assets;
    if (merged.giving !== undefined) update.giving_total = merged.giving;

    await this.db.from(this.targetTable).update(update).eq("id", id);
  }

  async pause(jobId: string): Promise<void> {
    this.shouldPause = true;
    await this.db
      .from("enrichment_jobs")
      .update({ status: "paused", paused_at: new Date().toISOString() })
      .eq("id", jobId);
  }

  async resume(jobId: string): Promise<void> {
    this.shouldPause = false;
    await this.db
      .from("enrichment_jobs")
      .update({ status: "running" })
      .eq("id", jobId);
  }

  async getProgress(jobId: string): Promise<JobProgress> {
    const { data: job } = await this.db
      .from("enrichment_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (!job) {
      return {
        total: 0,
        processed: 0,
        enriched: 0,
        failed: 0,
        skipped: 0,
        percent_complete: 0,
        estimated_remaining_minutes: 0,
        current_source: this.sources.at(0) ?? "",
        last_entity_name: "",
      };
    }

    const total = (job.total_records as number | null) ?? 0;
    const processed = (job.processed as number | null) ?? 0;
    const enriched = (job.enriched as number | null) ?? 0;
    const failed = (job.failed as number | null) ?? 0;
    const skipped = (job.skipped as number | null) ?? 0;
    const percentComplete = total > 0 ? Math.round((processed / total) * 100) : 0;

    const startedAt = job.started_at as string | null;
    let estimatedRemainingMinutes = 0;
    if (startedAt && processed > 0 && processed < total) {
      const elapsedSeconds = (Date.now() - new Date(startedAt).getTime()) / 1000;
      const avgSecondsPerRecord = elapsedSeconds / processed;
      const remaining = total - processed;
      estimatedRemainingMinutes = Math.round(
        (remaining * avgSecondsPerRecord) / 60,
      );
    }

    const { data: lastResult } = await this.db
      .from("enrichment_results")
      .select("entity_name")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    return {
      total,
      processed,
      enriched,
      failed,
      skipped,
      percent_complete: percentComplete,
      estimated_remaining_minutes: estimatedRemainingMinutes,
      current_source: this.sources.at(0) ?? "",
      last_entity_name: (lastResult?.entity_name as string | null) ?? "",
    };
  }
}
