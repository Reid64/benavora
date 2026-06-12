// Funding-source classification for opportunities (migration 010
// opportunity_source_type). This module is the single source of truth for
// turning what we know about an opportunity into a `source_type` bucket. It is
// pure and React-free so the research agents (server) and the UI can both use
// it.
//
// `source_type` answers "where does the money come from?" — a coarser axis than
// the funder `category`. The research agents call inferSourceType() at discovery
// time so every auto-discovered opportunity is tagged; the manual entry form
// lets a user pick it directly. Inference is deterministic: it reads only the
// text the agent already extracted (never the LLM, never fabricated facts) and
// classifies into a bucket, falling back to a category default.

import { OPPORTUNITY_SOURCE_TYPES } from "@/lib/utils/constants";
import type { Enums } from "@/types/database";

export type OpportunitySourceType = Enums<"opportunity_source_type">;
type FunderCategory = Enums<"funder_category">;

/** Type guard for an unknown string against the source_type enum. */
export function isOpportunitySourceType(
  value: unknown,
): value is OpportunitySourceType {
  return (
    typeof value === "string" &&
    (OPPORTUNITY_SOURCE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Default bucket for each funder category, used when the text gives no stronger
 * signal. These are best-fit defaults — government tiers and foundation flavors
 * are refined by inferSourceType() from the page text when possible.
 */
const CATEGORY_DEFAULT: Record<FunderCategory, OpportunitySourceType> = {
  corporate_donation: "corporate_giving",
  corporate_sponsorship: "corporate_giving",
  corporate_foundation: "corporate_giving",
  private_foundation: "private_foundation",
  government_grant: "government_federal",
  local_community_grant: "community_foundation",
  housing_grant: "government_local",
  education_grant: "government_federal",
  faith_compatible_grant: "faith_based",
  in_kind_donation: "corporate_giving",
  materials_donation: "corporate_giving",
  down_payment_assistance: "government_local",
};

const GOVERNMENT_CATEGORIES: readonly FunderCategory[] = [
  "government_grant",
  "housing_grant",
  "education_grant",
  "down_payment_assistance",
];

/** Signals an agent (or the form) can offer about an opportunity to classify it. */
export interface SourceTypeSignals {
  /** The funder category — the strongest fallback when text is inconclusive. */
  category?: FunderCategory | null;
  name?: string | null;
  description?: string | null;
  funderName?: string | null;
  geographicScope?: string | null;
  eligibilityRequirements?: string | null;
  /** Any extra agent-side hints (e.g. extracted CFDA/NOFO/SAM markers). */
  extraText?: string | null;
}

/**
 * Classify an opportunity's funding source. Specific textual signals win over
 * the category default; government opportunities are further split into
 * federal / state / local. Returns null only when nothing — not even a category
 * — is known, in which case the row stays "Unclassified".
 */
export function inferSourceType(
  signals: SourceTypeSignals,
): OpportunitySourceType | null {
  const text = [
    signals.name,
    signals.funderName,
    signals.description,
    signals.geographicScope,
    signals.eligibilityRequirements,
    signals.extraText,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .toLowerCase();

  const category = signals.category ?? null;

  // International reach is classified by scope regardless of funder type.
  if (/\b(international|worldwide|global|overseas|foreign aid|cross-border)\b/.test(text)) {
    return "international";
  }

  // Faith-based funders.
  if (
    /\b(faith[- ]?based|faith|church|ministr(?:y|ies)|religious|christian|catholic|diocese|parish|congregation|synagogue|mosque|jewish|islamic)\b/.test(
      text,
    )
  ) {
    return "faith_based";
  }

  // Community foundations are a named funder type.
  if (/\bcommunity foundation\b/.test(text)) {
    return "community_foundation";
  }

  // Government opportunities — split into tiers. Only applied when the category
  // is governmental or the text clearly reads as a public-sector source, so a
  // foundation that merely mentions a "county" in its address isn't miscast.
  const looksGovernment =
    (category != null && GOVERNMENT_CATEGORIES.includes(category)) ||
    /\b(federal|grants\.gov|cfda|sam\.gov|nofo|hud|usda|government grant|public agency|department of|office of|state of|county of|city of|municipal|governor)\b/.test(
      text,
    );

  if (looksGovernment) {
    if (
      /\b(federal|grants\.gov|cfda|sam\.gov|nofo|hud|usda|national endowment|u\.s\. department|federal government)\b/.test(
        text,
      )
    ) {
      return "government_federal";
    }
    if (
      /\b(city of|county|municipal|township|borough|local government|town of|village of)\b/.test(
        text,
      )
    ) {
      return "government_local";
    }
    if (
      /\b(state of|state grant|state department|state agency|governor|commonwealth of)\b/.test(
        text,
      )
    ) {
      return "government_state";
    }
    // Government, but no tier stated — use the category default.
    return category ? CATEGORY_DEFAULT[category] : "government_federal";
  }

  // No decisive text signal — fall back to the category's default bucket.
  return category ? CATEGORY_DEFAULT[category] : null;
}
