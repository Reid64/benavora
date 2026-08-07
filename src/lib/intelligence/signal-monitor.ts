// Signal Monitoring — FEATURE_REGISTRY_v2.md #99 ("LinkedIn + news + 990
// watching"). This pass scopes the feature to NEWS + 990 ONLY.
//
// LinkedIn is explicitly OUT of scope here — not a technical gap, a policy
// decision. LinkedIn scraping carries real ToS/anti-bot enforcement risk
// materially greater than this repo's existing StealthEngine
// (src/lib/scraper/stealth-engine.ts), which targets foundation/nonprofit
// websites, a much lower-risk surface. Do not add LinkedIn scraping here
// without Reid's explicit sign-off. See the `watchLinkedInSignals` stub
// below and STATE_OF_THE_BUILD.md's "Signal Monitoring" session entry for
// the full note. This mirrors how worker/autonomous-orchestrator.ts's own
// header documents what was deliberately not wired and why.
//
// News watching: reuses checkEntityReputation() (reputation-agent.ts,
// AGENTS_v2.md AG-18) unmodified — that function already does the real
// DuckDuckGo-search + Claude-classify + reputation_signals insert for a
// named entity. Nothing new to build for the search/classify step itself;
// this file's only new work is sweeping every funder in an org through it
// in one call and fanning newly-found signals into org-scoped
// reputation_alerts (the same insert shape ReputationIntelligenceAgent's
// nightly wrapper already uses for this exact table pair).
//
// 990 watching: genuinely new. Nothing in this codebase previously diffed
// a foundation's officers/status/financials between checks — the existing
// scripts/enrich-foundations-990.ts (batch CLI) and the interactive
// EnrichmentEngine (src/lib/enrichment/engine.ts) both only *populate*
// foundation_directory once; neither compares a new fetch against a prior
// one. This reuses the real, already-populated foundation_directory columns
// (officers, foundation_type, subsection_code, status — all real, migration
// 058) plus enrichFoundationFromProPublica() (src/lib/sources/
// propublica-990-client.ts, real, already used by
// scripts/enrich-propublica-batch.ts) for revenue/assets/expenses, and
// follows the same read-snapshot -> diff -> classify -> write-snapshot
// SHAPE that src/lib/agents/change-monitor-agent.ts (AG-42) already
// established for its own, differently-scoped platform-wide daily sweep —
// see that file's processFoundationEntity() for the pattern being reused.
// This is a distinct, additive layer, not a duplicate of AG-42:
//   - AG-42 sweeps ALL enriched foundation_directory rows platform-wide,
//     daily, unconditionally, and only diffs officers/foundation_type/
//     subsection_code/status (never financials) into its own
//     enrichment.change_monitor_snapshot key, chaining into out-of-cycle
//     990 re-enrichment.
//   - This module sweeps only the funders a SPECIFIC ORG already tracks in
//     its CRM (best-effort matched to foundation_directory by name — see
//     matchFunderToFoundation below), on-demand (manual trigger), and
//     additionally diffs revenue/assets/expenses/fiscal-period via a fresh
//     ProPublica fetch, into its own, separate
//     enrichment.signal_watch_990_snapshot key (deliberately distinct from
//     AG-42's key so the two snapshots never clobber each other), and
//     writes a queryable, org-visible reputation_signals/reputation_alerts
//     row — something AG-42's foundation branch never does (it only writes
//     to the jsonb blob + agent_decisions, neither of which is a per-org
//     queryable signal).
// Severity here is fully deterministic (officer/status/type change =
// notable-or-material by fixed rule; financial deltas thresholded by
// magnitude) — no Claude call, unlike AG-42's classifyChange(). This is a
// deliberate choice, not a shortcut: every field being diffed here is
// already-structured data (jsonb array diff, string equality, numeric
// percentage), the same "deterministic aggregation doesn't need a language
// model" principle AGENTS_v2.md's AG-10/AG-26 specs already establish for
// comparable structured-diff work. It also sidesteps the separately
// documented, currently-broken local ANTHROPIC_API_KEY
// (project memory: benavora-anthropic-key-invalid-local) for this feature
// entirely — this module never calls callClaude() itself (checkEntityReputation,
// reused for news, does its own Claude calls independently).

import type { SupabaseClient } from "@supabase/supabase-js";

import { checkEntityReputation } from "@/lib/intelligence/reputation-agent";
import { enrichFoundationFromProPublica } from "@/lib/sources/propublica-990-client";

/** Manual, on-demand trigger — bounded per call so one request can't run an
 * unbounded number of DuckDuckGo+Claude+ProPublica calls. Funders beyond
 * this count are reported as skipped in the summary, never silently
 * dropped (see runSignalMonitor's `fundersSkipped`). */
const MAX_FUNDERS_PER_RUN = 15;

type Severity990 = "minor" | "notable" | "material";

interface FunderRow {
  id: string;
  name: string;
}

interface FoundationRow {
  id: string;
  name: string;
  ein: string;
  officers: unknown;
  foundation_type: string | null;
  subsection_code: string | null;
  status: string | null;
  enrichment: Record<string, unknown> | null;
}

interface Signal990Snapshot {
  officers?: unknown;
  foundation_type?: string | null;
  subsection_code?: string | null;
  status?: string | null;
  totrevenue?: number | null;
  totassetsend?: number | null;
  totfuncexpns?: number | null;
  fiscal_period?: number | string | null;
}

interface DetectedField {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  severity: Severity990;
}

export interface SignalMonitorSummary {
  fundersChecked: number;
  fundersSkipped: number;
  newsSignalsFound: number;
  matched990: number;
  signals990Found: number;
  alertsCreated: number;
  errors: string[];
}

function jsonEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return a === b;
  }
}

/** True if `next` differs from `prev` by more than `pct` (e.g. 0.15 = 15%).
 * Either value being null/undefined is never treated as a percentage
 * change — that's a "no prior data" or "no fresh data" case, not a real
 * delta, and is handled by the caller before this is reached. */
function pctChange(prev: number, next: number): number {
  if (prev === 0) return next === 0 ? 0 : 1;
  return Math.abs(next - prev) / Math.abs(prev);
}

/**
 * Best-effort match of an org's `funders` CRM row to a real
 * foundation_directory record, by case-insensitive exact name match only —
 * no fuzzy scoring, deliberately conservative (a false match would attach
 * one funder's 990 signals to a different real-world foundation). Same
 * "documented, may miss, better than guessing" posture as the
 * cross-org name-matching already established in
 * src/lib/agents/grant-dna-agent.ts (`matchedByName`). Returns null on no
 * match or on a query error — a missed match is never treated as a
 * fabricated one.
 */
async function matchFunderToFoundation(
  funderName: string,
  supabase: SupabaseClient,
): Promise<FoundationRow | null> {
  const { data, error } = await supabase
    .from("foundation_directory")
    .select("id, name, ein, officers, foundation_type, subsection_code, status, enrichment")
    .ilike("name", funderName.trim())
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as FoundationRow;
}

/**
 * Diffs one foundation's current officers/foundation_type/subsection_code/
 * status (already-stored DB columns — no fetch needed) plus a fresh
 * ProPublica financial pull against the stored
 * enrichment.signal_watch_990_snapshot, classifies severity deterministically,
 * and — on any real change — writes one reputation_signals row and updates
 * the snapshot. Always updates the snapshot's last-checked state, even when
 * nothing changed, mirroring change-monitor-agent.ts's idempotency
 * convention (a same-day re-run with no real change produces the same
 * final jsonb).
 *
 * Never fabricates financial data: enrichFoundationFromProPublica() returns
 * null both for a genuine "no ProPublica record" case and for a transient
 * fetch/parse failure (it cannot distinguish the two — documented in that
 * file). On null, this function skips the financial-delta comparison for
 * this run entirely rather than guessing, and still performs the
 * officers/status/type diff from already-real DB columns.
 */
async function check990ForFoundation(
  foundation: FoundationRow,
  supabase: SupabaseClient,
): Promise<{ signalId: string | null; error: string | null }> {
  const snapshot = (foundation.enrichment?.["signal_watch_990_snapshot"] ??
    null) as Signal990Snapshot | null;

  const changes: DetectedField[] = [];

  if (snapshot && !jsonEqual(snapshot.officers ?? null, foundation.officers ?? null)) {
    changes.push({
      field: "officers",
      oldValue: snapshot.officers ?? null,
      newValue: foundation.officers ?? null,
      severity: "notable",
    });
  }
  if (
    snapshot &&
    (snapshot.foundation_type ?? null) !== (foundation.foundation_type ?? null)
  ) {
    changes.push({
      field: "foundation_type",
      oldValue: snapshot.foundation_type ?? null,
      newValue: foundation.foundation_type ?? null,
      severity: "material",
    });
  }
  if (
    snapshot &&
    (snapshot.subsection_code ?? null) !== (foundation.subsection_code ?? null)
  ) {
    changes.push({
      field: "subsection_code",
      oldValue: snapshot.subsection_code ?? null,
      newValue: foundation.subsection_code ?? null,
      severity: "material",
    });
  }
  if (snapshot && (snapshot.status ?? null) !== (foundation.status ?? null)) {
    changes.push({
      field: "status",
      oldValue: snapshot.status ?? null,
      newValue: foundation.status ?? null,
      severity: "material",
    });
  }

  const financials = await enrichFoundationFromProPublica(foundation.ein);

  if (snapshot && financials) {
    if (
      typeof snapshot.fiscal_period !== "undefined" &&
      snapshot.fiscal_period !== null &&
      financials.fiscal_period !== null &&
      String(snapshot.fiscal_period) !== String(financials.fiscal_period)
    ) {
      changes.push({
        field: "fiscal_period",
        oldValue: snapshot.fiscal_period,
        newValue: financials.fiscal_period,
        severity: "notable",
      });
    }

    const numericFields: Array<
      [keyof Signal990Snapshot, number | null, string]
    > = [
      ["totrevenue", financials.totrevenue, "revenue"],
      ["totassetsend", financials.totassetsend, "assets"],
      ["totfuncexpns", financials.totfuncexpns, "expenses"],
    ];
    for (const [key, nextValue, label] of numericFields) {
      const prevValue = snapshot[key];
      if (
        typeof prevValue === "number" &&
        typeof nextValue === "number" &&
        pctChange(prevValue, nextValue) >= 0.15
      ) {
        const delta = pctChange(prevValue, nextValue);
        changes.push({
          field: label,
          oldValue: prevValue,
          newValue: nextValue,
          severity: delta >= 0.4 ? "material" : "notable",
        });
      }
    }
  }

  const newSnapshot: Signal990Snapshot = {
    officers: foundation.officers ?? null,
    foundation_type: foundation.foundation_type ?? null,
    subsection_code: foundation.subsection_code ?? null,
    status: foundation.status ?? null,
    totrevenue: financials?.totrevenue ?? snapshot?.totrevenue ?? null,
    totassetsend: financials?.totassetsend ?? snapshot?.totassetsend ?? null,
    totfuncexpns: financials?.totfuncexpns ?? snapshot?.totfuncexpns ?? null,
    fiscal_period: financials?.fiscal_period ?? snapshot?.fiscal_period ?? null,
  };

  const { error: updateError } = await supabase
    .from("foundation_directory")
    .update({
      enrichment: {
        ...(foundation.enrichment ?? {}),
        signal_watch_990_snapshot: newSnapshot,
        signal_watch_990_last_checked_at: new Date().toISOString(),
      },
    })
    .eq("id", foundation.id);

  if (updateError) {
    return {
      signalId: null,
      error: `Failed to update 990-watch snapshot for foundation ${foundation.id}: ${updateError.message}`,
    };
  }

  if (changes.length === 0) return { signalId: null, error: null };

  const severity: Severity990 = changes.some((c) => c.severity === "material")
    ? "material"
    : "notable";
  const headline =
    `990 filing change for ${foundation.name}: ` +
    changes.map((c) => c.field).join(", ");
  const summary = changes
    .map((c) => `${c.field}: ${JSON.stringify(c.oldValue)} -> ${JSON.stringify(c.newValue)}`)
    .join("; ")
    .slice(0, 500);

  const { data: signalRow, error: signalError } = await supabase
    .from("reputation_signals")
    .insert({
      entity_id: foundation.id,
      entity_type: "foundation",
      signal_type: "990_change",
      severity,
      headline: headline.slice(0, 100),
      summary,
      source_url: `https://projects.propublica.org/nonprofits/organizations/${foundation.ein}`,
      signal_date: new Date().toISOString().slice(0, 10),
    })
    .select("id")
    .single();

  if (signalError || !signalRow) {
    return {
      signalId: null,
      error: `Failed to write 990 signal for foundation ${foundation.id}: ${signalError?.message ?? "no row returned"}`,
    };
  }

  return { signalId: (signalRow as { id: string }).id, error: null };
}

/**
 * Deliberately unimplemented — see file header. LinkedIn monitoring is a
 * policy decision pending Reid's explicit sign-off given real ToS/anti-bot
 * enforcement risk, not a technical gap to fill in. Do not build this
 * without that sign-off, and do not stub it with fake/mocked signals —
 * an empty, explicit no-op is more honest than a plausible-looking fake.
 */
export function watchLinkedInSignals(): never {
  throw new Error(
    "LinkedIn signal monitoring is deliberately deferred pending Reid's " +
      "explicit sign-off (ToS/anti-bot risk) — see STATE_OF_THE_BUILD.md's " +
      "Signal Monitoring session entry. Not a bug; do not implement this " +
      "without that sign-off.",
  );
}

/**
 * Runs Signal Monitoring (news + 990 only) for one org: sweeps up to
 * MAX_FUNDERS_PER_RUN of the org's `funders`, reuses checkEntityReputation()
 * for news signals (unmodified — see file header), best-effort matches each
 * funder to a real foundation_directory row for 990 diffing, and fans every
 * newly-created reputation_signals row (news or 990) into an org-scoped
 * reputation_alerts row — the same insert shape
 * ReputationIntelligenceAgent.run() already uses for this exact table pair,
 * so results surface through the existing GET /api/intelligence/reputation
 * endpoint without any change to that route.
 */
export async function runSignalMonitor(
  organizationId: string,
  supabase: SupabaseClient,
): Promise<SignalMonitorSummary> {
  const errors: string[] = [];

  const { data: funderRows, error: fundersError } = await supabase
    .from("funders")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (fundersError) {
    return {
      fundersChecked: 0,
      fundersSkipped: 0,
      newsSignalsFound: 0,
      matched990: 0,
      signals990Found: 0,
      alertsCreated: 0,
      errors: [`Failed to load funders: ${fundersError.message}`],
    };
  }

  const allFunders = (funderRows ?? []) as FunderRow[];
  const funders = allFunders.slice(0, MAX_FUNDERS_PER_RUN);
  const fundersSkipped = allFunders.length - funders.length;

  let newsSignalsFound = 0;
  let matched990 = 0;
  let signals990Found = 0;
  let alertsCreated = 0;

  const newSignalIds: string[] = [];

  for (const funder of funders) {
    try {
      const newsSignals = (await checkEntityReputation(
        funder.id,
        "funder",
        funder.name,
        supabase,
      )) as Array<{ id: string }>;
      newsSignalsFound += newsSignals.length;
      newSignalIds.push(...newsSignals.map((s) => s.id));
    } catch (err) {
      errors.push(
        `News check failed for funder ${funder.id} (${funder.name}): ` +
          (err instanceof Error ? err.message : "unknown error"),
      );
    }

    try {
      const foundation = await matchFunderToFoundation(funder.name, supabase);
      if (foundation) {
        matched990++;
        const { signalId, error } = await check990ForFoundation(foundation, supabase);
        if (error) errors.push(error);
        if (signalId) {
          signals990Found++;
          newSignalIds.push(signalId);
        }
      }
    } catch (err) {
      errors.push(
        `990 watch failed for funder ${funder.id} (${funder.name}): ` +
          (err instanceof Error ? err.message : "unknown error"),
      );
    }
  }

  for (const signalId of newSignalIds) {
    const { error: alertError } = await supabase.from("reputation_alerts").insert({
      org_id: organizationId,
      signal_id: signalId,
      status: "unread",
    });
    if (alertError) {
      errors.push(
        `Failed to create alert for signal ${signalId}: ${alertError.message}`,
      );
      continue;
    }
    alertsCreated++;
  }

  return {
    fundersChecked: funders.length,
    fundersSkipped,
    newsSignalsFound,
    matched990,
    signals990Found,
    alertsCreated,
    errors,
  };
}
