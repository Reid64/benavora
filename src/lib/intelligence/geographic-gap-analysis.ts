// Geographic Gap Detection (FEATURE_REGISTRY_v2.md row #145: "Geographic Gap
// Detection - funder portfolio geographic analysis").
//
// Real schema constraint (checked src/types/database.ts + migration 093
// directly before writing this, per this project's established practice):
// there is no normalized geospatial data anywhere on the funder/opportunity
// side. `funders.geographic_focus` and `opportunities.geographic_restrictions`
// are both free-text columns - not lat/lng, not a structured region enum.
// This is therefore keyword/substring matching over free text, not real
// distance/radius geospatial logic the schema can't support. Every result
// this module returns should be read as a best-effort text signal, not a
// verified geographic determination - the returned `methodology` field says
// so explicitly, and callers should surface that framing in the UI.
//
// Org-side source column: `organizations.service_area` (singular, text),
// NOT `organizational_digital_twins.service_areas` (plural, text[]). Checked
// both directly (src/lib/intelligence/digital-twin-builder.ts's
// buildServiceAreas()) before choosing: the twin's `service_areas` array is
// *derived* from this exact same `organizations.service_area` column, split
// on commas - it is not an independent, richer source, just the same text
// pre-split. Querying the twin table would add a second table dependency
// (and would read null for any org whose twin hasn't been built yet, per
// row #107's event-driven-not-scheduled trigger) for zero additional signal.
// Reading `organizations.service_area` directly and splitting it here
// matches the precedent already set by donor-intent-monitor-agent.ts (AG-30),
// which made and documented this identical choice.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Bounds how many open opportunities a single portfolio scan will check -
 * keeps the scan's cost predictable regardless of how large an org's open
 * pipeline grows. Soonest-deadline-first, so a capped scan still surfaces
 * the opportunities most worth checking before applying. */
export const MAX_OPPORTUNITIES_FOR_GEOGRAPHIC_SCAN = 30;

/** Phrases that mean "no real geographic restriction" wherever they appear
 * in a funder's/opportunity's geographic text - a funder saying "national"
 * or "no restriction" should never be flagged as a mismatch against any org
 * service area, regardless of keyword overlap. */
const NATIONAL_KEYWORDS = [
  "national",
  "nationwide",
  "all states",
  "any state",
  "no restriction",
  "no geographic restriction",
  "united states",
  "u.s.",
  "us only",
  "all 50 states",
  "anywhere in the",
];

/** Words too short/common to be a meaningful geographic match on their own
 * (avoids e.g. "the" or "of" counting as an "overlap"). */
const MIN_TOKEN_LENGTH = 4;

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

function splitIntoTokens(text: string): string[] {
  return text
    .split(/[,;/&]|\band\b/gi)
    .map((t) => normalize(t))
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);
}

function isUnrestrictedNationalText(text: string): boolean {
  const lower = normalize(text);
  return NATIONAL_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Best-effort bidirectional keyword/substring overlap check between an
 * org's service-area text and a funder's/opportunity's geographic text.
 * Returns true when they appear to overlap (no flag), false when they
 * appear NOT to overlap (a geographic mismatch worth flagging).
 */
export function geographicTextsOverlap(
  orgServiceArea: string,
  geoText: string,
): boolean {
  if (isUnrestrictedNationalText(geoText)) return true;
  if (isUnrestrictedNationalText(orgServiceArea)) return true;

  const orgLower = normalize(orgServiceArea);
  const geoLower = normalize(geoText);

  const orgTokens = splitIntoTokens(orgServiceArea);
  if (orgTokens.some((token) => geoLower.includes(token))) return true;

  const geoWords = geoLower
    .split(/[^a-z]+/g)
    .filter((w) => w.length >= MIN_TOKEN_LENGTH);
  if (geoWords.some((word) => orgLower.includes(word))) return true;

  return false;
}

export interface GeographicGapFinding {
  opportunityId: string;
  opportunityName: string;
  funderId: string | null;
  funderName: string | null;
  /** Which field's text drove the mismatch determination. */
  source: "opportunity" | "funder";
  geographicText: string;
}

export interface GeographicGapAnalysisResult {
  orgServiceArea: string | null;
  opportunitiesChecked: number;
  opportunitiesConsidered: number;
  mismatches: GeographicGapFinding[];
  methodology: string;
}

interface OpportunityRow {
  id: string;
  name: string;
  funder_id: string | null;
  geographic_restrictions: string | null;
  deadline: string | null;
}

interface FunderRow {
  id: string;
  name: string;
  geographic_focus: string | null;
}

/**
 * Scans this org's open opportunity portfolio for funders/opportunities
 * whose stated geographic focus doesn't appear to overlap the org's own
 * service area, per the text-based methodology documented above.
 */
export async function computeGeographicGapAnalysis(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<GeographicGapAnalysisResult> {
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("service_area")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgError) {
    throw new Error(`Failed to load organization: ${orgError.message}`);
  }

  const orgServiceArea = (org?.service_area ?? "").trim() || null;

  if (!orgServiceArea) {
    return {
      orgServiceArea: null,
      opportunitiesChecked: 0,
      opportunitiesConsidered: 0,
      mismatches: [],
      methodology:
        "This organization has no service_area on file, so no geographic comparison could be made. Add a service area in Organization Profile to enable this check.",
    };
  }

  const { data: opportunities, error: oppsError } = await supabase
    .from("opportunities")
    .select("id, name, funder_id, geographic_restrictions, deadline")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .order("deadline", { ascending: true, nullsFirst: false })
    .limit(MAX_OPPORTUNITIES_FOR_GEOGRAPHIC_SCAN);

  if (oppsError) {
    throw new Error(`Failed to load opportunities: ${oppsError.message}`);
  }

  const opps = (opportunities ?? []) as OpportunityRow[];
  const funderIds = Array.from(
    new Set(opps.map((o) => o.funder_id).filter((id): id is string => !!id)),
  );

  const fundersById = new Map<string, FunderRow>();
  if (funderIds.length > 0) {
    const { data: funders, error: fundersError } = await supabase
      .from("funders")
      .select("id, name, geographic_focus")
      .in("id", funderIds);

    if (fundersError) {
      throw new Error(`Failed to load funders: ${fundersError.message}`);
    }
    for (const f of (funders ?? []) as FunderRow[]) {
      fundersById.set(f.id, f);
    }
  }

  const mismatches: GeographicGapFinding[] = [];

  for (const opp of opps) {
    const funder = opp.funder_id ? fundersById.get(opp.funder_id) ?? null : null;

    // Prefer the opportunity's own stated restriction (more specific to this
    // particular cycle) over the funder's general focus; fall back to the
    // funder's text only when the opportunity itself states none.
    const oppText = (opp.geographic_restrictions ?? "").trim();
    const funderText = (funder?.geographic_focus ?? "").trim();

    if (oppText) {
      if (!geographicTextsOverlap(orgServiceArea, oppText)) {
        mismatches.push({
          opportunityId: opp.id,
          opportunityName: opp.name,
          funderId: funder?.id ?? null,
          funderName: funder?.name ?? null,
          source: "opportunity",
          geographicText: oppText,
        });
      }
      continue;
    }

    if (funderText) {
      if (!geographicTextsOverlap(orgServiceArea, funderText)) {
        mismatches.push({
          opportunityId: opp.id,
          opportunityName: opp.name,
          funderId: funder?.id ?? null,
          funderName: funder?.name ?? null,
          source: "funder",
          geographicText: funderText,
        });
      }
      continue;
    }
    // Neither field has any text on file - no data means no flag, not a
    // false-positive mismatch.
  }

  return {
    orgServiceArea,
    opportunitiesChecked: opps.length,
    opportunitiesConsidered: opps.length,
    mismatches,
    methodology:
      `Best-effort keyword/substring match between this organization's service_area text ("${orgServiceArea}") and each open opportunity's geographic_restrictions (or its funder's geographic_focus when the opportunity itself states none). ` +
      "Neither field is structured geospatial data in this schema (both are free text), so this is a text-overlap signal, not a verified geographic determination - always confirm eligibility directly with the funder before applying or routing to AutoApply. " +
      `Checked ${opps.length} open opportunit${opps.length === 1 ? "y" : "ies"}${opps.length === MAX_OPPORTUNITIES_FOR_GEOGRAPHIC_SCAN ? ` (capped at ${MAX_OPPORTUNITIES_FOR_GEOGRAPHIC_SCAN} soonest-deadline first - some open opportunities may not be shown)` : ""}.`,
  };
}
