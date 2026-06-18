// Research data quality — overnight-006.
//
// Provides a lightweight quality-scoring pass that runs on already-discovered
// opportunity rows and flags low-quality records for review or removal. Unlike
// result-parser's per-extraction confidence (which scores the extraction),
// this module scores the STORED opportunity against a set of completeness and
// credibility rules. It is called by the data-quality API route and can also
// be run on a schedule to maintain a clean pipeline.
//
// Score 0-100. Thresholds:
//   >= 70  good     — no action required
//   40-69  fair     — surface in "Needs Review" queue
//   <  40  poor     — flag for deletion / re-research

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Enums } from "@/types/database";

type OppStatus = Enums<"opportunity_status">;

export interface QualityIssue {
  field: string;
  severity: "warn" | "error";
  message: string;
}

export interface QualityScore {
  opportunityId: string;
  score: number;
  grade: "good" | "fair" | "poor";
  issues: QualityIssue[];
}

export interface QualityCheckOptions {
  client: SupabaseClient;
  organizationId: string;
  /** Restrict to specific opportunity ids; omit to check all non-closed opps. */
  opportunityIds?: string[];
  /** Maximum opportunities to evaluate in one call (default: 50). */
  limit?: number;
}

export interface QualityCheckResult {
  scored: QualityScore[];
  goodCount: number;
  fairCount: number;
  poorCount: number;
}

interface OpportunityQualityRow {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  url: string | null;
  eligibility_requirements: string | null;
  funder_id: string | null;
  status: OppStatus | null;
  source: string | null;
  source_type: string | null;
}

const DEFAULT_LIMIT = 50;
const GOOD_THRESHOLD = 70;
const FAIR_THRESHOLD = 40;

/**
 * Score data quality for the organization's open opportunities. Never throws.
 */
export async function checkDataQuality(
  options: QualityCheckOptions,
): Promise<QualityCheckResult> {
  const limit = options.limit ?? DEFAULT_LIMIT;

  let query = options.client
    .from("opportunities")
    .select(
      "id, name, category, description, amount_min, amount_max, deadline, url, eligibility_requirements, funder_id, status, source, source_type",
    )
    .eq("organization_id", options.organizationId)
    .neq("status", "closed" as OppStatus)
    .limit(limit);

  if (options.opportunityIds && options.opportunityIds.length > 0) {
    query = query.in("id", options.opportunityIds);
  }

  const { data } = await query;
  const rows = (data ?? []) as OpportunityQualityRow[];

  const scored: QualityScore[] = rows.map(scoreRow);
  let goodCount = 0;
  let fairCount = 0;
  let poorCount = 0;
  for (const s of scored) {
    if (s.grade === "good") goodCount++;
    else if (s.grade === "fair") fairCount++;
    else poorCount++;
  }

  return { scored, goodCount, fairCount, poorCount };
}

// --- scoring -----------------------------------------------------------------

function scoreRow(row: OpportunityQualityRow): QualityScore {
  const issues: QualityIssue[] = [];
  let score = 100;

  // --- required fields ---------------------------------------------------------

  if (!row.name || row.name.trim() === "") {
    issues.push({ field: "name", severity: "error", message: "Missing name." });
    score -= 30;
  }

  if (!row.category) {
    issues.push({ field: "category", severity: "error", message: "Missing category." });
    score -= 20;
  }

  if (!row.funder_id) {
    issues.push({
      field: "funder_id",
      severity: "warn",
      message: "Not linked to a funder record.",
    });
    score -= 10;
  }

  // --- important fields --------------------------------------------------------

  if (!row.description || row.description.trim().length < 30) {
    issues.push({
      field: "description",
      severity: "warn",
      message: "Missing or very short description.",
    });
    score -= 8;
  }

  if (row.amount_min === null && row.amount_max === null) {
    issues.push({
      field: "amount",
      severity: "warn",
      message: "No funding amount information.",
    });
    score -= 8;
  }

  if (!row.url) {
    issues.push({
      field: "url",
      severity: "warn",
      message: "No source URL.",
    });
    score -= 8;
  }

  if (!row.eligibility_requirements) {
    issues.push({
      field: "eligibility_requirements",
      severity: "warn",
      message: "No eligibility requirements stated.",
    });
    score -= 6;
  }

  // --- deadline freshness ------------------------------------------------------

  if (row.deadline) {
    const deadline = Date.parse(row.deadline);
    if (Number.isFinite(deadline)) {
      const msUntilDeadline = deadline - Date.now();
      if (msUntilDeadline < 0) {
        issues.push({
          field: "deadline",
          severity: "error",
          message: "Deadline is in the past.",
        });
        score -= 15;
      } else if (msUntilDeadline < 7 * 24 * 60 * 60 * 1000) {
        issues.push({
          field: "deadline",
          severity: "warn",
          message: "Deadline is within 7 days.",
        });
        // No score deduction — urgency is not a quality problem.
      }
    } else {
      issues.push({
        field: "deadline",
        severity: "warn",
        message: "Deadline could not be parsed.",
      });
      score -= 5;
    }
  }

  // --- source attribution ------------------------------------------------------

  if (!row.source && !row.source_type) {
    issues.push({
      field: "source",
      severity: "warn",
      message: "No source attribution.",
    });
    score -= 5;
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const grade: QualityScore["grade"] =
    finalScore >= GOOD_THRESHOLD
      ? "good"
      : finalScore >= FAIR_THRESHOLD
        ? "fair"
        : "poor";

  return {
    opportunityId: row.id,
    score: finalScore,
    grade,
    issues,
  };
}
