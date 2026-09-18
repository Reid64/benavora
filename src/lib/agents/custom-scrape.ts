// Custom Scrape Research Agent — AGENTS.md Agent 20.
//
// Fetches client-assigned URLs server-side and uses Claude to extract
// structured grant opportunity data (BEHAVIORAL_CONTRACTS §21).
//
// Per-target behaviour:
//   1. Re-check the org's domain allowlist (custom_connector_allowlist) —
//      a target whose domain was since removed is skipped, not fetched.
//   2. Enforce a per-target cooldown so repeated manual "Run Now" clicks
//      can't become an unbounded fetch loop.
//   3. Fetch the URL via `safeFetch()` — SSRF-safe (validated/pinned IP,
//      capped response size, hard timeout), not a raw `fetch()` (public
//      pages only; §21)
//   4. Truncate content to ~80 KB to stay within Claude's context window
//   5. Prompt Claude to extract opportunities relevant to the target description
//   6. Validate each extracted item: name is required + url or description (§21)
//   7. Deduplicate against existing opportunities by name + source
//   8. Insert new records with source = 'scrape:' + target URL
//   9. Update last_scraped_at; on failure increment failure_count, pause at 5+ (§21)
//
// Tier enforcement is delegated to the route layer (§21).

import { callClaude } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  withCause,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import {
  AllowlistBlockedError,
  assertDomainAllowed,
} from "@/lib/security/custom-connector-allowlist";
import { safeFetch, SsrfBlockedError } from "@/lib/security/safe-fetch";
import type { AgentType } from "@/types/agents";

/** Minimum time between fetches for the same target (manual-trigger cooldown). */
const TARGET_COOLDOWN_MS = 30_000;

export interface CustomScrapeInput {
  /** Run only this target; omit to run all active targets for the org. */
  targetId?: string;
}

export interface CustomScrapeResult {
  targetsRun: number;
  opportunitiesCreated: number;
  targetsPaused: number;
  errors: { targetId: string; url: string; message: string }[];
}

interface TargetRow {
  id: string;
  url: string;
  description: string | null;
  failure_count: number;
  last_scraped_at: string | null;
}

interface RawExtracted {
  name?: unknown;
  title?: unknown;
  organization?: unknown;
  amount?: unknown;
  deadline?: unknown;
  description?: unknown;
  url?: unknown;
  eligibility?: unknown;
}

export class CustomScrapeResearchAgent extends BaseAgent<
  CustomScrapeInput,
  CustomScrapeResult
> {
  // Reuses the custom_api_research agent_type — both agents discover
  // opportunities from external sources and share the same DB enum value.
  // p5a-002 (2026-09-15): was "custom_api_research", colliding with
  // custom-api.ts (the client-configured REST API agent). Renamed to its own
  // distinct DB enum value (already live) so agent_runs is attributable.
  readonly agentType: AgentType = "custom_scrape_research";

  constructor(options: BaseAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? 300_000 });
  }

  protected async execute(
    input: CustomScrapeInput,
  ): Promise<AgentExecution<CustomScrapeResult>> {
    let query = this.client
      .from("scraping_targets")
      .select("id, url, description, failure_count, last_scraped_at")
      .eq("organization_id", this.organizationId)
      .eq("is_active", true);

    if (input.targetId) {
      query = query.eq("id", input.targetId);
    }

    const { data: rows, error: loadError } = await query;
    if (loadError) {
      throw new AgentError(
        withCause("Failed to load scraping targets.", loadError),
        "load_failed",
      );
    }
    if (!rows || rows.length === 0) {
      return {
        data: {
          targetsRun: 0,
          opportunitiesCreated: 0,
          targetsPaused: 0,
          errors: [],
        },
        outputSummary: "No active scraping targets found.",
        itemsFound: 0,
        itemsProcessed: 0,
        tokensUsed: 0,
      };
    }

    const targets = rows as TargetRow[];
    let opportunitiesCreated = 0;
    let targetsPaused = 0;
    let totalTokens = 0;
    const errors: { targetId: string; url: string; message: string }[] = [];

    for (const target of targets) {
      try {
        const { created, tokensUsed } = await this.scrapeTarget(target);
        opportunitiesCreated += created;
        totalTokens += tokensUsed;

        await this.client
          .from("scraping_targets")
          .update({
            failure_count: 0,
            last_scraped_at: new Date().toISOString(),
            last_success_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", target.id)
          .eq("organization_id", this.organizationId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        errors.push({ targetId: target.id, url: target.url, message });

        const newCount = (target.failure_count ?? 0) + 1;
        const shouldPause = newCount >= 5;

        await this.client
          .from("scraping_targets")
          .update({
            failure_count: newCount,
            last_scraped_at: new Date().toISOString(),
            is_active: !shouldPause,
            updated_at: new Date().toISOString(),
          })
          .eq("id", target.id)
          .eq("organization_id", this.organizationId);

        if (shouldPause) {
          targetsPaused++;
          // Best-effort notification — a missing automation_notifications table
          // must never block the agent result.
          await this.client.from("automation_notifications").insert({
            organization_id: this.organizationId,
            event_type: "target_paused",
            title: `Scraping target paused: ${target.url}`,
            message: `The target was auto-paused after 5 consecutive failures. Last error: ${message}`,
            is_read: false,
            sent_via: "in_app",
          });
        }
      }
    }

    return {
      data: {
        targetsRun: targets.length,
        opportunitiesCreated,
        targetsPaused,
        errors,
      },
      outputSummary: `Scraped ${targets.length} target(s): ${opportunitiesCreated} opportunities created, ${targetsPaused} paused.`,
      itemsFound: targets.length,
      itemsProcessed: opportunitiesCreated,
      tokensUsed: totalTokens,
    };
  }

  private async scrapeTarget(
    target: TargetRow,
  ): Promise<{ created: number; tokensUsed: number }> {
    // Cooldown: a burst of manual "Run Now" clicks must not turn into an
    // unbounded fetch loop against the same target.
    if (target.last_scraped_at) {
      const elapsed = Date.now() - new Date(target.last_scraped_at).getTime();
      if (elapsed < TARGET_COOLDOWN_MS) {
        throw new Error(
          `This target was scraped ${Math.round(elapsed / 1000)}s ago — please wait ${Math.ceil((TARGET_COOLDOWN_MS - elapsed) / 1000)}s before running it again.`,
        );
      }
    }

    // Re-check the domain allowlist at fetch time, not just at save time.
    try {
      await assertDomainAllowed(this.client, this.organizationId, target.url);
    } catch (err) {
      if (err instanceof AllowlistBlockedError) throw err;
      throw new Error("Could not verify the domain allowlist.");
    }

    let response;
    try {
      response = await safeFetch(target.url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Benavora/1.0; grant-research-bot)",
          Accept: "text/html,application/xhtml+xml,text/plain,application/json",
        },
        timeoutMs: 20_000,
        maxBytes: 2_000_000,
      });
    } catch (err) {
      if (err instanceof SsrfBlockedError) throw err;
      throw err;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers["content-type"] ?? "";
    const rawText = response.body;

    // Truncate to ~80 KB to stay within Claude's context window.
    const pageContent =
      rawText.length > 80_000 ? rawText.slice(0, 80_000) : rawText;

    const descriptionClause = target.description?.trim()
      ? `This page should contain: ${target.description.trim()}.`
      : "This page may contain grant or funding opportunities.";

    const isJson = contentType.includes("application/json");

    const prompt = `You are extracting grant and funding opportunities from a web page.

${descriptionClause}

Return ONLY a JSON array. Each element must follow this exact shape (use null for any missing field):
{
  "name": string,
  "organization": string | null,
  "amount": string | null,
  "deadline": string | null,
  "description": string | null,
  "url": string | null,
  "eligibility": string | null
}

Rules:
- "name" is required. If no clear opportunity name exists, use a concise descriptive title.
- For "deadline": use YYYY-MM-DD if determinable, otherwise raw date text, otherwise null.
- For "amount": include the full funding range as text (e.g. "Up to $50,000"), otherwise null.
- For "url": include the direct link to the opportunity if present, otherwise null.
- Only extract genuine grant or funding opportunities, not navigation items or general news.
- If no opportunities are found, return an empty array: []
- Do NOT wrap the array in markdown fences or any other text. Return only raw JSON.

${isJson ? "JSON content:" : "Page content:"}
${pageContent}`;

    const claudeResult = await callClaude({ prompt, maxTokens: 2048 });
    const items = parseClaudeResponse(claudeResult.text);

    let created = 0;
    const source = `scrape:${target.url}`;

    for (const raw of items) {
      const name = toStr(raw?.name ?? raw?.title);
      if (!name) continue;

      // Quality gate: must have name AND (url or description) (Contracts §21).
      const urlStr = toStr(raw?.url);
      const descStr = toStr(raw?.description);
      if (!urlStr && !descStr) continue;

      // Dedup: skip if this org already has an opportunity from this source with
      // this name (Contracts §21: source = 'scrape:' + target URL).
      const { data: existing } = await this.client
        .from("opportunities")
        .select("id")
        .eq("organization_id", this.organizationId)
        .eq("name", name)
        .eq("source", source)
        .maybeSingle();

      if (existing) continue;

      const opp: Record<string, unknown> = {
        organization_id: this.organizationId,
        name,
        source,
        status: "open",
        category: "government_grant",
      };

      if (descStr) opp.description = descStr;
      if (urlStr) opp.url = urlStr;

      const elig = toStr(raw?.eligibility);
      if (elig) opp.eligibility_requirements = elig;

      const amtStr = toStr(raw?.amount);
      const amtNum = amtStr ? parseAmount(amtStr) : null;
      if (amtNum !== null) opp.amount_available = amtNum;

      const deadline = toStr(raw?.deadline);
      if (deadline && isIsoDate(deadline)) opp.deadline = deadline;

      const { error: insertError } = await this.client
        .from("opportunities")
        .insert(opp);

      if (!insertError) created++;
    }

    return { created, tokensUsed: claudeResult.usage.totalTokens };
  }
}

function parseClaudeResponse(text: string): RawExtracted[] {
  const clean = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    const parsed: unknown = JSON.parse(clean);
    if (Array.isArray(parsed)) return parsed as RawExtracted[];
    if (parsed !== null && typeof parsed === "object") {
      const candidate = (parsed as Record<string, unknown>)["opportunities"];
      if (Array.isArray(candidate)) return candidate as RawExtracted[];
    }
  } catch {
    // Claude occasionally returns plain text when no opportunities are found.
  }
  return [];
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(s);
}

function parseAmount(s: string): number | null {
  const match = s.replace(/[,$\s]/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = parseFloat(match[1] ?? "0");
  return isNaN(n) ? null : n;
}
