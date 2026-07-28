// EA-04 Foundation Detector (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6).
//
// Cross-references the prospect against `nonprofits` — the live IRS Business
// Master File import (migrations 098/099, ~1.97M records, confirmed live per
// STATE_OF_THE_BUILD.md) — rather than a live IRS fetch: the architecture
// doc's Input column for this agent says "IRS BMF cross-reference + website",
// meaning a lookup against the already-ingested BMF dataset, not a new fetch.
// No page fetch, no Claude call — this agent is purely deterministic.
//
// Trigger: post-acquisition. Rate: 1 request per second — applies to a batch
// runner iterating many prospects (no dispatcher is built as part of this
// change; a single row's cross-reference is one query, nothing to pace).
//
// EIN matching mirrors the format-tolerant approach already used in
// src/lib/intelligence/foundation-matcher.ts's lookupNteeFromBmf() (the real
// stored EIN format on `nonprofits` isn't guaranteed to match a prospect's
// raw EIN format exactly).

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import { fetchProspect, mergeEnrichmentPatch } from "@/lib/agents/corporate-enrichment-shared";

/** Per-spec pacing for a batch runner: 1 lookup per second. */
export const EA04_RATE_MS = 1_000;

const FOUNDATION_NAME_SUFFIXES = [
  "Foundation",
  "Charitable Foundation",
  "Family Foundation",
  "Community Foundation",
] as const;

const CORPORATE_SUFFIX_STRIP = /\b(inc|incorporated|llc|l\.l\.c\.|corp|corporation|co|company|ltd)\.?\s*$/i;

export interface EA04Input {
  prospectId: string;
}

export interface EA04Result {
  foundationAffiliation: string | null;
  foundationEin: string | null;
  matchMethod: "ein" | "name" | "none";
}

interface NonprofitMatch {
  ein: string | null;
  name: string | null;
}

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

function coreCompanyName(legalName: string): string {
  return legalName.replace(CORPORATE_SUFFIX_STRIP, "").trim();
}

export class EA04FoundationDetectorAgent extends BaseAgent<
  EA04Input,
  EA04Result
> {
  readonly agentType: AgentType = "ea04_foundation_detector";

  protected async execute(
    input: EA04Input,
  ): Promise<AgentExecution<EA04Result>> {
    const prospect = await fetchProspect(this.client, input.prospectId);
    if (!prospect) {
      throw new AgentError("Corporate prospect not found.", "not_found", 404);
    }

    let match: NonprofitMatch | null = null;
    let matchMethod: EA04Result["matchMethod"] = "none";

    if (prospect.ein) {
      match = await this.matchByEin(prospect.ein);
      if (match) matchMethod = "ein";
    }

    if (!match) {
      match = await this.matchByName(prospect.legal_name);
      if (match) matchMethod = "name";
    }

    const foundationAffiliation = match?.name ?? null;
    const foundationEin = match?.ein ?? null;

    await mergeEnrichmentPatch(this.client, prospect, {
      foundation_affiliation: foundationAffiliation,
      foundation_ein: foundationEin,
    });

    return {
      data: { foundationAffiliation, foundationEin, matchMethod },
      outputSummary: foundationAffiliation
        ? `${prospect.legal_name}: matched foundation "${foundationAffiliation}" via ${matchMethod}.`
        : `${prospect.legal_name}: no foundation affiliation found in BMF.`,
      itemsFound: 1,
      itemsProcessed: match ? 1 : 0,
    };
  }

  private async matchByEin(ein: string): Promise<NonprofitMatch | null> {
    const raw = ein.trim();
    const digits = digitsOnly(raw);
    const dashed = digits.length === 9 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : null;
    const candidates = Array.from(new Set([raw, digits, dashed].filter((v): v is string => Boolean(v))));

    for (const candidate of candidates) {
      const { data } = await this.client
        .from("nonprofits")
        .select("ein, name")
        .eq("ein", candidate)
        .maybeSingle();
      const row = data as NonprofitMatch | null;
      if (row) return row;
    }
    return null;
  }

  private async matchByName(legalName: string): Promise<NonprofitMatch | null> {
    const core = coreCompanyName(legalName);
    if (!core) return null;

    for (const suffix of FOUNDATION_NAME_SUFFIXES) {
      const { data } = await this.client
        .from("nonprofits")
        .select("ein, name")
        .ilike("name", `%${core}%${suffix}%`)
        .limit(1)
        .maybeSingle();
      const row = data as NonprofitMatch | null;
      if (row) return row;
    }
    return null;
  }
}
