// Research agent families — client-safe schedule metadata for the Research UI.
//
// Pure data only (no imports), so it is safe to use in client components. The
// category lists MIRROR the authoritative `*_CATEGORIES` constants exported by
// each agent in src/lib/agents/research/* (which pull in server-only code and so
// cannot be imported into the browser bundle). Keep them in sync; the cron route
// (src/app/api/cron/research/route.ts) uses the agent-file constants directly.
//
// Cadence matches AGENTS.md: government grants run daily, the rest weekly.

import type { AgentType } from "@/types/agents";
import type { Enums } from "@/types/database";

type FunderCategory = Enums<"funder_category">;
type OpportunitySourceType = Enums<"opportunity_source_type">;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface ResearchFamily {
  agentType: AgentType;
  /** Display label for the schedule panel. */
  label: string;
  /** Human cadence, e.g. "Daily" / "Weekly". */
  cadence: string;
  /** Minimum gap between automated runs for profiles in this family. */
  intervalMs: number;
  /** Funder categories that put a profile in scope for this family. */
  categories: readonly FunderCategory[];
}

export const RESEARCH_FAMILIES: readonly ResearchFamily[] = [
  {
    agentType: "government_research",
    label: "Government grants",
    cadence: "Daily",
    intervalMs: DAY_MS,
    categories: ["government_grant", "housing_grant", "education_grant"],
  },
  {
    agentType: "corporate_research",
    label: "Corporate giving",
    cadence: "Weekly",
    intervalMs: WEEK_MS,
    categories: [
      "corporate_donation",
      "corporate_sponsorship",
      "corporate_foundation",
      "in_kind_donation",
      "materials_donation",
    ],
  },
  {
    agentType: "foundation_research",
    label: "Foundation grants",
    cadence: "Weekly",
    intervalMs: WEEK_MS,
    categories: ["private_foundation", "corporate_foundation"],
  },
  {
    agentType: "local_sponsorship",
    label: "Local sponsorship",
    cadence: "Weekly",
    intervalMs: WEEK_MS,
    categories: ["local_community_grant", "corporate_sponsorship"],
  },
];

// --- parallel orchestration lanes --------------------------------------------
//
// When the user runs "Run all active", the orchestrator
// (src/lib/agents/research/orchestrator.ts) launches every lane below at once
// via Promise.allSettled and then de-dupes the union of their discoveries. The
// runnable side (which agent class + ResearchFocus each lane uses) lives in the
// server-only agent-configs.ts; this list is the CLIENT-SAFE mirror the Research
// dashboard renders as live per-lane status. Keep `key` in sync between the two.

export interface ResearchLane {
  /** Stable id, shared with the server config (agent-configs.ts). */
  key: string;
  /** Display label for the lane card. */
  label: string;
  /** Underlying agent class this lane runs as (its agent_runs.agent_type). */
  agentType: AgentType;
  /** The funding source-type this lane specializes in (display only). */
  sourceType: OpportunitySourceType | null;
  /** One-line description of what the lane sweeps. */
  description: string;
}

export const RESEARCH_AGENT_LANES: readonly ResearchLane[] = [
  // The four base families (broad sweeps).
  {
    key: "government_research",
    label: "Government grants",
    agentType: "government_research",
    sourceType: "government_federal",
    description: "Federal, state, and local grants via Grants.gov + the open web.",
  },
  {
    key: "corporate_research",
    label: "Corporate giving",
    agentType: "corporate_research",
    sourceType: "corporate_giving",
    description: "Corporate donation, sponsorship, and in-kind giving programs.",
  },
  {
    key: "foundation_research",
    label: "Foundation grants",
    agentType: "foundation_research",
    sourceType: "private_foundation",
    description: "Private and corporate foundation grants via the open web.",
  },
  {
    key: "local_sponsorship",
    label: "Local sponsorship",
    agentType: "local_sponsorship",
    sourceType: "community_foundation",
    description: "Local business sponsorships and community-grant opportunities.",
  },
  // Four new specialized source-type lanes (added for parallel orchestration).
  {
    key: "grants_gov_api",
    label: "Grants.gov API",
    agentType: "government_research",
    sourceType: "government_federal",
    description: "Federal opportunities pulled directly from the Grants.gov API.",
  },
  {
    key: "state_specific",
    label: "State-specific grants",
    agentType: "government_research",
    sourceType: "government_state",
    description: "State-agency grant programs scoped to the profile's geography.",
  },
  {
    key: "foundation_directory",
    label: "Foundation Directory",
    agentType: "foundation_research",
    sourceType: "private_foundation",
    description: "Foundation Directory listings of private grantmakers.",
  },
  {
    key: "faith_based",
    label: "Faith-based funders",
    agentType: "foundation_research",
    sourceType: "faith_based",
    description: "Faith-based and congregation-linked grant and giving programs.",
  },
];
