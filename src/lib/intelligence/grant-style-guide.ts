// Grant Style Guide Enforcer — deterministic, funder-type-specific narrative
// rules run on the fully assembled, humanized draft, before the
// applications INSERT. Called by src/lib/agents/draft-generation-agent.ts
// (ag-05-draft) immediately after the narrative humanizer pass.
//
// Fully deterministic (regex/heuristic, no Claude call) — mirrors
// draft-generation-agent.ts's own runComplianceCheck, which uses the same
// "deterministic checklist, never blocks draft creation" pattern for the
// same reason: this runs on every autonomous draft and must not add a
// sixth Claude round trip or a new failure mode to the pipeline.
//
// There is no `funder_type` column anywhere in this schema — not on
// `opportunities`, not on `funders`, confirmed absent from every migration
// and src/types/database.ts. `opportunities.category` (the real
// `funder_category` enum, SCHEMA_REGISTRY_v2.md migration 001) is the closest
// real signal, so `deriveFunderType()` below maps it to the three funder
// classes these rules are organized around. `enforceStyleGuide()` itself
// still takes a plain `funderType: string` per the task spec and normalizes
// whatever it's given (either "federal"/"foundation"/"corporate" or a raw
// `funder_category` value) rather than requiring callers to pre-derive it.

export type FunderType = "federal" | "foundation" | "corporate";

export interface StyleGuideContext {
  /** opportunities.description — used to check funder-priority alignment
   * (foundation) and DEI signaling (foundation). Never fabricated. */
  opportunityDescription?: string | null;
  /** funders.notes — a secondary source of stated funder priorities when
   * the opportunity description doesn't carry them. */
  funderPriorities?: string | null;
  /** funders.geographic_focus — used for the corporate geographic
   * alignment check. */
  funderGeographicFocus?: string | null;
}

export interface StyleViolation {
  type: string;
  originalText: string;
  suggestedReplacement: string;
  severity: "critical" | "warning" | "info";
}

export interface StyleGuideResult {
  violations: StyleViolation[];
  suggestions: string[];
  correctedText: string;
}

/** Maps the real `opportunities.category` enum (or a literal
 * "federal"/"foundation"/"corporate" string) to the funder class this
 * style guide's rules are organized around. Defaults to "foundation" for
 * every category with no clear government or corporate signal
 * (private_foundation, local_community_grant, housing_grant,
 * education_grant, faith_compatible_grant, in_kind_donation,
 * materials_donation, down_payment_assistance) since foundation rules are
 * the closest fit for a mixed-population, non-federal, non-corporate
 * funder. */
export function deriveFunderType(category: string): FunderType {
  const lower = category.toLowerCase();
  if (lower === "government_grant" || lower.includes("federal")) {
    return "federal";
  }
  if (
    lower === "corporate_donation" ||
    lower === "corporate_sponsorship" ||
    lower === "corporate_foundation" ||
    lower.includes("corporate")
  ) {
    return "corporate";
  }
  return "foundation";
}

function normalizeFunderType(funderType: string): FunderType {
  return deriveFunderType(funderType);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "will", "have",
  "their", "about", "into", "across", "over", "under", "than", "through",
  "which", "would", "could", "should",
]);

function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? [];
  return Array.from(new Set(words.filter((w) => !STOPWORDS.has(w))));
}

interface RuleCheckOutput {
  violations: StyleViolation[];
  suggestions: string[];
}

// ---- FEDERAL FUNDERS (HUD, HHS, DOJ, VA, USDA) -----------------------------

/** Informal population descriptors mapped to official HUD/agency
 * terminology. Only substitutions with a real, unambiguous official-term
 * equivalent are listed — never a fabricated term. */
const FEDERAL_TERMINOLOGY_MAP: Record<string, string> = {
  "homeless people": "individuals experiencing homelessness",
  "the homeless": "individuals experiencing homelessness",
  "poor people": "individuals with low income",
  "the poor": "individuals with low income",
  "disabled people": "individuals with disabilities",
  "the disabled": "individuals with disabilities",
  "low income people": "low-income individuals",
};

const OBJECT_CLASS_CATEGORIES = [
  "personnel", "fringe", "travel", "equipment", "supplies", "contractual",
  "other", "indirect",
];

const FEDERAL_ADVOCACY_TERMS = [
  "vote for", "elect", "political party", "legislative agenda",
  "we urge congress", "government must", "the administration should",
  "policymakers must", "advocate for legislation", "lobby for", "partisan",
];

const ACRONYM_PATTERN = /\b[A-Z]{2,6}\b/g;
const COMMON_ACRONYM_ALLOWLIST = new Set([
  "US", "USA", "ID", "OK", "TV", "PDF", "FAQ", "CEO", "CFO", "IRS", "TX",
  "IT", "AI",
]);

function findMissingObjectClassCategories(text: string): string[] {
  const lower = text.toLowerCase();
  return OBJECT_CLASS_CATEGORIES.filter((c) => !lower.includes(c));
}

/** Flags "underserved" only when NONE of its occurrences have a nearby
 * defining clause — a single well-defined use elsewhere in the narrative
 * satisfies the rule for the whole draft. */
function hasUndefinedUnderserved(text: string): boolean {
  const matches = Array.from(text.matchAll(/\bunderserved\b/gi));
  if (matches.length === 0) return false;
  return matches.every((m) => {
    const idx = m.index ?? 0;
    const window = text.slice(Math.max(0, idx - 20), Math.min(text.length, idx + 160));
    return !/(\(|meaning|defined as|specifically|namely|i\.e\.)/i.test(window);
  });
}

/** An acronym counts as "expanded" if its parenthetical form, e.g.
 * "(HUD)", appears anywhere in the text — the standard "spell it out,
 * then (ACRONYM)" convention. */
function findUnexpandedAcronyms(text: string): string[] {
  const found = Array.from(new Set(text.match(ACRONYM_PATTERN) ?? []));
  return found.filter((acronym) => {
    if (COMMON_ACRONYM_ALLOWLIST.has(acronym)) return false;
    return !new RegExp(`\\(${escapeRegExp(acronym)}\\)`).test(text);
  });
}

function checkFederalRules(text: string): RuleCheckOutput {
  const violations: StyleViolation[] = [];
  const suggestions: string[] = [];

  const hasCfda =
    /\bCFDA\b/i.test(text) ||
    /\b\d{2}\.\d{3}\b/.test(text) ||
    /assistance listing/i.test(text);
  if (!hasCfda) {
    violations.push({
      type: "missing_cfda_reference",
      originalText: "",
      suggestedReplacement: "[NEEDS INPUT: CFDA / Assistance Listing Number]",
      severity: "critical",
    });
    suggestions.push(
      "Add the specific CFDA / Assistance Listing Number for this federal program.",
    );
  }

  for (const [informal, official] of Object.entries(FEDERAL_TERMINOLOGY_MAP)) {
    if (new RegExp(`\\b${escapeRegExp(informal)}\\b`, "i").test(text)) {
      violations.push({
        type: "informal_terminology",
        originalText: informal,
        suggestedReplacement: official,
        severity: "warning",
      });
      suggestions.push(`Replace "${informal}" with the official term "${official}".`);
    }
  }

  const missingCategories = findMissingObjectClassCategories(text);
  if (missingCategories.length > 0) {
    violations.push({
      type: "missing_object_class_category",
      originalText: "",
      suggestedReplacement: `Reference these object class categories in the budget narrative: ${missingCategories.join(", ")}.`,
      severity: "warning",
    });
    suggestions.push(
      `Budget narrative is missing object class categories: ${missingCategories.join(", ")}.`,
    );
  }

  if (!/GPRA|Government Performance Results Act/i.test(text)) {
    violations.push({
      type: "missing_gpra_reference",
      originalText: "",
      suggestedReplacement:
        "Reference GPRA (Government Performance Results Act) performance metrics in the evaluation plan, where applicable.",
      severity: "info",
    });
    suggestions.push(
      "Evaluation plan does not reference GPRA metrics — add if this program reports under GPRA.",
    );
  }

  for (const term of FEDERAL_ADVOCACY_TERMS) {
    if (new RegExp(escapeRegExp(term), "i").test(text)) {
      violations.push({
        type: "advocacy_language",
        originalText: term,
        suggestedReplacement: "",
        severity: "critical",
      });
      suggestions.push(
        `Remove advocacy/political language: "${term}" is not appropriate for a federal grant narrative.`,
      );
    }
  }

  if (hasUndefinedUnderserved(text)) {
    violations.push({
      type: "undefined_underserved",
      originalText: "underserved",
      suggestedReplacement: "underserved (define the specific population and criteria)",
      severity: "warning",
    });
    suggestions.push(
      '"Underserved" is used without a definition — state specifically who is underserved and why.',
    );
  }

  const unexpandedAcronyms = findUnexpandedAcronyms(text);
  if (unexpandedAcronyms.length > 0) {
    violations.push({
      type: "unexpanded_acronym",
      originalText: unexpandedAcronyms.join(", "),
      suggestedReplacement:
        "Spell out each acronym in full on first use, followed by the acronym in parentheses.",
      severity: "warning",
    });
    suggestions.push(
      `Acronym(s) used without being spelled out on first use: ${unexpandedAcronyms.join(", ")}.`,
    );
  }

  return { violations, suggestions };
}

// ---- FOUNDATION FUNDERS -----------------------------------------------------

const FEDERAL_ONLY_JARGON = [
  "GPRA", "Government Performance Results Act", "CFDA",
  "object class categories", "Assistance Listing",
];

function stripLeadingHeading(text: string): string {
  return text.replace(/^##[^\n]*\n+/, "");
}

function checkFoundationRules(
  text: string,
  context: StyleGuideContext,
): RuleCheckOutput {
  const violations: StyleViolation[] = [];
  const suggestions: string[] = [];

  const opening = stripLeadingHeading(text).slice(0, 300).trim();
  if (
    /^(We are|Our organization|Founded in|Since \d{4}|[A-Z][\w'&.-]*\s+(Foundation|Inc\.?|Corporation)\s+has\s+(been|served))/i.test(
      opening,
    )
  ) {
    violations.push({
      type: "credentials_first_lead",
      originalText: opening.slice(0, 80),
      suggestedReplacement:
        "Open with the community need or impact this program addresses before introducing organizational credentials.",
      severity: "warning",
    });
    suggestions.push(
      "Narrative opens with organizational credentials rather than community impact — reorder to lead with impact.",
    );
  }

  if (!/theory of change|which (leads|results) in|so that ultimately/i.test(text)) {
    violations.push({
      type: "missing_theory_of_change",
      originalText: "",
      suggestedReplacement:
        "Add an explicit theory-of-change statement connecting activities to outcomes.",
      severity: "info",
    });
    suggestions.push(
      "No explicit theory of change found — foundation funders expect a clear activities-to-outcomes chain.",
    );
  }

  const priorityKeywords = extractKeywords(
    context.opportunityDescription ?? context.funderPriorities ?? "",
  );
  if (priorityKeywords.length > 0) {
    const lowerText = text.toLowerCase();
    const overlap = priorityKeywords.filter((k) => lowerText.includes(k));
    if (overlap.length === 0) {
      violations.push({
        type: "missing_funder_priority_alignment",
        originalText: "",
        suggestedReplacement: `Reference alignment with the funder's stated priorities: ${priorityKeywords.slice(0, 5).join(", ")}.`,
        severity: "warning",
      });
      suggestions.push(
        "Narrative does not reference the funder's stated priorities from the opportunity description.",
      );
    }
  }

  if (!/sustainab/i.test(text)) {
    violations.push({
      type: "missing_sustainability_plan",
      originalText: "",
      suggestedReplacement:
        "Add a sustainability plan describing how the program continues after the grant period ends.",
      severity: "warning",
    });
    suggestions.push(
      "No sustainability plan found — foundation funders expect a post-grant continuation plan.",
    );
  }

  const foundJargon = FEDERAL_ONLY_JARGON.filter((term) =>
    new RegExp(escapeRegExp(term), "i").test(text),
  );
  if (foundJargon.length > 0) {
    violations.push({
      type: "federal_jargon_in_foundation_narrative",
      originalText: foundJargon.join(", "),
      suggestedReplacement:
        "Remove federal-specific terminology not meaningful to a foundation reviewer.",
      severity: "warning",
    });
    suggestions.push(
      `Federal-specific jargon found in a foundation narrative: ${foundJargon.join(", ")}.`,
    );
  }

  const funderPriorityText = `${context.opportunityDescription ?? ""} ${context.funderPriorities ?? ""}`;
  if (
    /diversity|equity|inclusion/i.test(funderPriorityText) &&
    !/diversity|equity|inclusion/i.test(text)
  ) {
    violations.push({
      type: "missing_dei_statement",
      originalText: "",
      suggestedReplacement:
        "Add a brief statement on the organization's diversity, equity, and inclusion commitments.",
      severity: "warning",
    });
    suggestions.push(
      "This funder prioritizes DEI but the narrative includes no DEI statement.",
    );
  }

  return { violations, suggestions };
}

// ---- CORPORATE FUNDERS -------------------------------------------------------

const CORPORATE_WORD_LIMIT_FULL_PROPOSAL = 1500;
const BUSINESS_CASE_PATTERN =
  /\b(return on investment|ROI|business (benefit|case)|partnership with|your (employees|company|team)|brand (visibility|reputation))\b/i;

function checkCorporateRules(
  text: string,
  context: StyleGuideContext,
): RuleCheckOutput {
  const violations: StyleViolation[] = [];
  const suggestions: string[] = [];

  const opening = stripLeadingHeading(text).slice(0, 400);
  if (!BUSINESS_CASE_PATTERN.test(opening)) {
    violations.push({
      type: "missing_business_case_lead",
      originalText: opening.trim().slice(0, 80),
      suggestedReplacement:
        "Open with the business case — how supporting this organization benefits the company, its employees, or its community standing.",
      severity: "warning",
    });
    suggestions.push(
      "Narrative does not lead with a business case for the corporate funder.",
    );
  }

  const wordCount = countWords(text);
  if (wordCount > CORPORATE_WORD_LIMIT_FULL_PROPOSAL) {
    violations.push({
      type: "exceeds_word_count",
      originalText: "",
      suggestedReplacement: `Tighten to at most ${CORPORATE_WORD_LIMIT_FULL_PROPOSAL} words (currently ${wordCount}).`,
      severity: "warning",
    });
    suggestions.push(
      `Narrative is ${wordCount} words — corporate proposals should stay under ${CORPORATE_WORD_LIMIT_FULL_PROPOSAL} words.`,
    );
  }

  if (!/return on investment|\bROI\b|business (benefit|case)/i.test(text)) {
    violations.push({
      type: "missing_roi_framing",
      originalText: "",
      suggestedReplacement:
        "Frame the request in terms of return on investment for the company where possible.",
      severity: "info",
    });
    suggestions.push(
      "No ROI framing found — corporate funders respond to a clear business return.",
    );
  }

  if (context.funderGeographicFocus) {
    const focusKeywords = extractKeywords(context.funderGeographicFocus);
    const lowerText = text.toLowerCase();
    const mentioned = focusKeywords.some((k) => lowerText.includes(k));
    if (!mentioned) {
      violations.push({
        type: "missing_geographic_alignment",
        originalText: "",
        suggestedReplacement: `Mention alignment with the funder's geographic footprint (${context.funderGeographicFocus}).`,
        severity: "info",
      });
      suggestions.push(
        "Narrative does not mention geographic alignment with the funder's facilities/footprint.",
      );
    }
  }

  if (!/volunteer/i.test(text)) {
    violations.push({
      type: "missing_volunteer_mention",
      originalText: "",
      suggestedReplacement: "Highlight an employee volunteer opportunity connected to this program.",
      severity: "info",
    });
    suggestions.push(
      "No employee volunteer opportunity mentioned — corporate funders value employee engagement angles.",
    );
  }

  return { violations, suggestions };
}

// ---- Mechanical corrections ---------------------------------------------------

/** Only "informal_terminology" violations have an unambiguous, safe
 * text-for-text replacement — every other violation type is either a
 * missing-content flag (nothing in the draft to replace) or a judgment
 * call (e.g. reordering an opening) that risks corrupting the narrative
 * if applied blindly. Those are surfaced via `violations`/`suggestions`
 * for a human reviewer, never auto-applied. */
function applyMechanicalCorrections(
  text: string,
  violations: StyleViolation[],
): string {
  let corrected = text;
  for (const violation of violations) {
    if (violation.type !== "informal_terminology" || !violation.originalText) {
      continue;
    }
    const pattern = new RegExp(`\\b${escapeRegExp(violation.originalText)}\\b`, "gi");
    corrected = corrected.replace(pattern, violation.suggestedReplacement);
  }
  return corrected;
}

export function enforceStyleGuide(
  text: string,
  funderType: string,
  context: StyleGuideContext = {},
): StyleGuideResult {
  const normalized = normalizeFunderType(funderType);

  const { violations, suggestions } =
    normalized === "federal"
      ? checkFederalRules(text)
      : normalized === "corporate"
        ? checkCorporateRules(text, context)
        : checkFoundationRules(text, context);

  return {
    violations,
    suggestions,
    correctedText: applyMechanicalCorrections(text, violations),
  };
}
