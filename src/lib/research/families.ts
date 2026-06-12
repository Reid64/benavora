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
