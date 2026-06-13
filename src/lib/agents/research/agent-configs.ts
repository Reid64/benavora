// Research agent configs - the runnable registry behind parallel orchestration.
//
// Each config is one "lane" the orchestrator (orchestrator.ts) launches at once:
// it names the underlying agent class, the search specialization (ResearchFocus)
// that narrows what that class sweeps, and a factory to build it. The four base
// families run their agents broadly; the four NEW source-type configs reuse the
// Government and Foundation agent classes under a focus so several specialized
// passes (e.g. Grants.gov API vs. state agencies) run side by side and are then
// folded together by the cross-result dedup pass.
//
// Server-only (imports the agent classes). The CLIENT-SAFE mirror of this list -
// keys, labels, source types - lives in src/lib/research/families.ts
// (RESEARCH_AGENT_LANES) for the dashboard. Keep `key` in sync between the two.

import type { AgentRunOutcome, BaseAgentOptions } from "@/lib/agents/base-agent";
import { CorporateGivingResearchAgent } from "@/lib/agents/research/corporate-giving";
import type { ResearchFocus } from "@/lib/agents/research/focus";
import { FoundationGrantsResearchAgent } from "@/lib/agents/research/foundation-grants";
import { GovernmentGrantsResearchAgent } from "@/lib/agents/research/government-grants";
import { LocalSponsorshipResearchAgent } from "@/lib/agents/research/local-sponsorship";
import {
  RESEARCH_AGENT_LANES,
  type ResearchLane,
} from "@/lib/research/families";
import type { AgentType } from "@/types/agents";

/** Options every research agent constructor accepts (mirrors the routes). */
export interface ResearchAgentOptions extends BaseAgentOptions {
  model: string;
  maxTokens: number;
}

/** The uniform run input + outcome shape across the research agents. */
export interface ResearchAgent {
  run(input: {
    profileIds?: string[] | null;
  }): Promise<AgentRunOutcome<unknown>>;
}

/** One runnable lane: a base family or a specialized source-type pass. */
export interface ResearchAgentConfig {
  key: string;
  label: string;
  agentType: AgentType;
  sourceType: ResearchLane["sourceType"];
  description: string;
  /** The specialization applied to the agent class, if any. */
  focus?: ResearchFocus;
  /** Build the agent for this lane. */
  create(options: ResearchAgentOptions): ResearchAgent;
}

/** Look up the client-safe lane metadata by key (kept as the single source). */
function lane(key: string): ResearchLane {
  const found = RESEARCH_AGENT_LANES.find((l) => l.key === key);
  if (!found) {
    throw new Error(`Unknown research lane: ${key}`);
  }
  return found;
}

/** Build a config from its lane metadata plus an optional focus + factory. */
function config(
  key: string,
  create: ResearchAgentConfig["create"],
  focus?: ResearchFocus,
): ResearchAgentConfig {
  const { label, agentType, sourceType, description } = lane(key);
  return { key, label, agentType, sourceType, description, focus, create };
}

// Focus presets for the specialized lanes. Each only narrows WHERE/HOW the
// agent searches; classification of each discovery stays page-text-driven.

const GRANTS_GOV_FOCUS: ResearchFocus = {
  sources: ["grants_gov"],
  sourceTypeHint: "government_federal",
  label: "Grants.gov API",
};

const STATE_FOCUS: ResearchFocus = {
  sources: ["google"],
  querySuffix: "state agency grant program",
  sourceTypeHint: "government_state",
  label: "State-specific",
};

const DIRECTORY_FOCUS: ResearchFocus = {
  sources: ["foundation_directory"],
  sourceTypeHint: "private_foundation",
  label: "Foundation Directory",
};

const FAITH_FOCUS: ResearchFocus = {
  sources: ["google"],
  querySuffix: "faith-based religious congregation",
  sourceTypeHint: "faith_based",
  label: "Faith-based",
};

export const RESEARCH_AGENT_CONFIGS: readonly ResearchAgentConfig[] = [
  // --- four base families (broad sweeps) -------------------------------------
  config(
    "government_research",
    (o) => new GovernmentGrantsResearchAgent(o),
  ),
  config(
    "corporate_research",
    (o) => new CorporateGivingResearchAgent(o),
  ),
  config(
    "foundation_research",
    (o) => new FoundationGrantsResearchAgent(o),
  ),
  config(
    "local_sponsorship",
    (o) => new LocalSponsorshipResearchAgent(o),
  ),

  // --- four new specialized source-type lanes --------------------------------
  config(
    "grants_gov_api",
    (o) => new GovernmentGrantsResearchAgent({ ...o, focus: GRANTS_GOV_FOCUS }),
    GRANTS_GOV_FOCUS,
  ),
  config(
    "state_specific",
    (o) => new GovernmentGrantsResearchAgent({ ...o, focus: STATE_FOCUS }),
    STATE_FOCUS,
  ),
  config(
    "foundation_directory",
    (o) => new FoundationGrantsResearchAgent({ ...o, focus: DIRECTORY_FOCUS }),
    DIRECTORY_FOCUS,
  ),
  config(
    "faith_based",
    (o) => new FoundationGrantsResearchAgent({ ...o, focus: FAITH_FOCUS }),
    FAITH_FOCUS,
  ),
];

/** Find a single config by key (used by the API route / tests). */
export function getResearchAgentConfig(
  key: string,
): ResearchAgentConfig | undefined {
  return RESEARCH_AGENT_CONFIGS.find((c) => c.key === key);
}
