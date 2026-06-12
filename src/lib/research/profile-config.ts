// Search-profile advanced configuration — shared, client-safe shapes + parsers.
//
// Migration 011 added several structured (jsonb / array) configuration columns to
// search_profiles. This module is the single source of truth for their TypeScript
// shapes, the option lists the Configuration page renders, and the defensive
// parsers that turn an untyped `Json` value (from the DB or a stale row) into a
// well-typed structure. It is pure data + functions (no React, no server-only
// imports) so BOTH the Search Profile Configuration page (client) and the
// research scheduler/agents (server) can import it without a bundle cycle.

import { OPPORTUNITY_SOURCE_TYPES } from "@/lib/utils/constants";
import type { Enums, Json } from "@/types/database";

export type OpportunitySourceType = Enums<"opportunity_source_type">;
export type FunderCategory = Enums<"funder_category">;

// --- structured shapes -------------------------------------------------------

/** One source-category filter with its priority rank (1 = highest priority). */
export interface SourceTypeFilter {
  source_type: OpportunitySourceType;
  priority: number;
}

/** A focus-area tag with a relative weight (FOCUS_WEIGHT_MIN..FOCUS_WEIGHT_MAX). */
export interface FocusArea {
  label: string;
  weight: number;
}

/** Per-agent enable toggle + schedule cadence (hours between automated runs). */
export interface AgentSetting {
  enabled: boolean;
  intervalHours: number;
}

/** Per-agent settings keyed by the research agent_type. */
export type AgentSettings = Record<string, AgentSetting>;

/**
 * Eligibility pre-filters — structured boolean toggles plus an optional minimum
 * organization age. Unknown keys are ignored on parse; only ELIGIBILITY_PREFILTER
 * keys (+ min_organization_age_years) are recognized.
 */
export interface EligibilityFilters {
  [key: string]: boolean | number | undefined;
  min_organization_age_years?: number;
}

// --- option lists (rendered by the configuration page) -----------------------

export const FOCUS_WEIGHT_MIN = 1;
export const FOCUS_WEIGHT_MAX = 5;
export const FOCUS_WEIGHT_DEFAULT = 3;

/** Eligibility pre-filter toggles. Stored as { [key]: boolean } in the column. */
export const ELIGIBILITY_PREFILTERS = [
  {
    key: "requires_501c3",
    label: "Requires 501(c)(3) status",
    help: "Only pursue funders that require formal tax-exempt status.",
  },
  {
    key: "allows_fiscal_sponsor",
    label: "Accepts fiscally-sponsored applicants",
    help: "Include programs open to projects under a fiscal sponsor.",
  },
  {
    key: "requires_matching_funds",
    label: "Requires matching funds",
    help: "Include opportunities that require a cash/in-kind match.",
  },
  {
    key: "multi_year_only",
    label: "Multi-year funding only",
    help: "Prioritize multi-year commitments over one-time grants.",
  },
  {
    key: "exclude_loi_gated",
    label: "Exclude Letter-of-Inquiry-gated programs",
    help: "Skip funders that require an LOI before a full application.",
  },
  {
    key: "open_deadline_only",
    label: "Rolling / open deadlines only",
    help: "Focus on programs that accept applications year-round.",
  },
] as const;

/** Common population-served tags offered as quick-add chips (free text allowed). */
export const POPULATION_PRESETS = [
  "Youth",
  "Children",
  "Families",
  "Seniors",
  "Veterans",
  "Low-income",
  "Homeless",
  "People with disabilities",
  "Rural communities",
  "Immigrants & refugees",
  "Women & girls",
  "BIPOC communities",
] as const;

/** Common geographic-scope presets offered as quick-add chips (free text allowed). */
export const GEOGRAPHIC_PRESETS = [
  "Nationwide",
  "Texas",
  "California",
  "New York",
  "Florida",
  "Southeast US",
  "Midwest US",
  "Pacific Northwest",
  "Local / county",
  "International",
] as const;

/** Schedule cadences for the per-agent run interval. */
export const AGENT_SCHEDULE_OPTIONS = [
  { label: "Every 12 hours", hours: 12 },
  { label: "Daily", hours: 24 },
  { label: "Every 3 days", hours: 72 },
  { label: "Weekly", hours: 168 },
  { label: "Biweekly", hours: 336 },
  { label: "Monthly", hours: 720 },
] as const;

export const DEFAULT_AGENT_INTERVAL_HOURS = 168; // weekly

// --- parsers (untyped Json -> typed shape) -----------------------------------

const SOURCE_TYPE_SET = new Set<string>(OPPORTUNITY_SOURCE_TYPES);

function asArray(value: Json | null | undefined): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Parse the source_type_filters column; drops invalid entries, sorts by priority. */
export function parseSourceTypeFilters(value: Json | null | undefined): SourceTypeFilter[] {
  const out: SourceTypeFilter[] = [];
  for (const raw of asArray(value)) {
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const st = obj.source_type;
      if (typeof st === "string" && SOURCE_TYPE_SET.has(st)) {
        const priority = Number(obj.priority);
        out.push({
          source_type: st as OpportunitySourceType,
          priority: Number.isFinite(priority) ? priority : out.length + 1,
        });
      }
    }
  }
  // De-duplicate by source_type (keep the first), then rank by priority asc.
  const seen = new Set<string>();
  return out
    .filter((f) => (seen.has(f.source_type) ? false : (seen.add(f.source_type), true)))
    .sort((a, b) => a.priority - b.priority);
}

/** Parse the focus_areas column; clamps weights, drops empty labels. */
export function parseFocusAreas(value: Json | null | undefined): FocusArea[] {
  const out: FocusArea[] = [];
  const seen = new Set<string>();
  for (const raw of asArray(value)) {
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const label = typeof obj.label === "string" ? obj.label.trim() : "";
      if (label === "") continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const weight = Number(obj.weight);
      out.push({
        label,
        weight: clampWeight(Number.isFinite(weight) ? weight : FOCUS_WEIGHT_DEFAULT),
      });
    }
  }
  return out;
}

/** Parse the eligibility_filters column into recognized boolean/number values. */
export function parseEligibilityFilters(
  value: Json | null | undefined,
): EligibilityFilters {
  const out: EligibilityFilters = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const obj = value as Record<string, unknown>;
  for (const { key } of ELIGIBILITY_PREFILTERS) {
    if (typeof obj[key] === "boolean") out[key] = obj[key] as boolean;
  }
  const age = Number(obj.min_organization_age_years);
  if (Number.isFinite(age) && age > 0) out.min_organization_age_years = age;
  return out;
}

/** Parse the agent_settings column keyed by agent_type. */
export function parseAgentSettings(value: Json | null | undefined): AgentSettings {
  const out: AgentSettings = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const obj = value as Record<string, unknown>;
  for (const [agentType, raw] of Object.entries(obj)) {
    if (raw && typeof raw === "object") {
      const setting = raw as Record<string, unknown>;
      const interval = Number(setting.intervalHours);
      out[agentType] = {
        enabled: setting.enabled !== false, // default enabled
        intervalHours: Number.isFinite(interval) && interval > 0
          ? interval
          : DEFAULT_AGENT_INTERVAL_HOURS,
      };
    }
  }
  return out;
}

/** Clamp a focus-area weight into the allowed range. */
export function clampWeight(weight: number): number {
  return Math.min(FOCUS_WEIGHT_MAX, Math.max(FOCUS_WEIGHT_MIN, Math.round(weight)));
}
