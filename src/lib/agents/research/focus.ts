// Per-run specialization for the research agents (parallel orchestration).
//
// A ResearchFocus lets the orchestrator run the SAME agent class under several
// specialized configurations at once - e.g. the Government agent once against
// the Grants.gov API and again against state-agency web results - without
// forking the agent's pipeline. It only narrows WHERE and HOW an agent searches;
// it never overrides what a page actually states, so source-type classification
// stays page-text-driven (BEHAVIORAL_CONTRACTS §9: never fabricate).
//
// Leaf module (types only) so both the agents and the config registry can import
// it without a cycle.

import type { SearchSource } from "@/lib/agents/research/search-engine";
import type { OpportunitySourceType } from "@/lib/opportunities/source-type";

export interface ResearchFocus {
  /**
   * Restrict/override which search sources this run queries. When omitted the
   * agent uses its own default source set.
   */
  sources?: SearchSource[];
  /**
   * Suffix appended to every generated query to specialize it (e.g.
   * "state agency", "faith-based"). Empty/omitted leaves queries unchanged.
   */
  querySuffix?: string;
  /**
   * The source-type this specialization is biased toward. Used only for the
   * run summary/label - classification of each discovered opportunity remains
   * driven by the page text (Contracts §9).
   */
  sourceTypeHint?: OpportunitySourceType;
  /** Short human label for logs/summaries, e.g. "Grants.gov API". */
  label?: string;
}

/** Append a focus query suffix to each query (deduped, trimmed). No-op when unset. */
export function applyQuerySuffix(
  queries: string[],
  focus: ResearchFocus | undefined,
): string[] {
  const suffix = focus?.querySuffix?.trim() ?? "";
  if (suffix === "") return queries;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries) {
    const combined = `${q} ${suffix}`.trim();
    const norm = combined.toLowerCase();
    if (norm === "" || seen.has(norm)) continue;
    seen.add(norm);
    out.push(combined);
  }
  return out;
}
