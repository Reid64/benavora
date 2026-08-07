import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireRole } from "@/lib/auth/role-gate";
import { RelationshipBuilderAgent } from "@/lib/agents/relationship-builder-agent";

// GET  /api/funders/[id]/relationship-builder — this one funder's real slice
//      of AG-19 RelationshipBuilderAgent's output
//      (src/lib/agents/relationship-builder-agent.ts): its
//      relationship_recommendations row (Phase A), its agent_decisions rows
//      (Phase A score/recommendation reasoning plus Phase B
//      officer-research/introduction-path decisions, if
//      org_autonomous_config.auto_relationship_enabled is on), and any direct
//      pig_edges connections from this funder's own pig_nodes entry
//      (registry #101, "Relationship Builder UI"). Distinct from the
//      existing /api/funders/[id]/relationship route, which computes a
//      materially different, event-sourced score from
//      funder_relationship_events via relationship-scorer.ts — that route is
//      untouched by this build; both are surfaced side by side on
//      /funders/[id]/relationship.
// POST /api/funders/[id]/relationship-builder — runs RelationshipBuilderAgent
//      ("manual" trigger). AG-19's run() is ORG-SCOPED, not per-funder (see
//      STATE_OF_THE_BUILD.md's "queue-31 preflight" session, 2026-08-07) — a
//      POST here triggers a full pass over every funder in the org (real
//      Claude spend, real writes to funder_relationship_scores/
//      relationship_recommendations/agent_decisions/pig_nodes/pig_edges),
//      then returns this funder's resulting slice. No mock/fallback path: if
//      the agent run itself fails, its real error is returned to the caller.

export const runtime = "nodejs";
export const maxDuration = 300;

const AGENT_ID = "ag-19-relationship";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

interface FunderRow {
  id: string;
  name: string;
}

async function resolveFunder(
  supabase: SupabaseClient,
  organizationId: string,
  funderId: string,
): Promise<FunderRow | null> {
  const { data } = await supabase
    .from("funders")
    .select("id, name")
    .eq("id", funderId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (data as FunderRow | null) ?? null;
}

/**
 * Reads this funder's real slice of AG-19's output. Deliberately a thin,
 * direct read — not a re-implementation of the agent's own BFS traversal
 * (relationship-builder-agent.ts's findIntroductionPaths is private to that
 * file). "Direct connections" below mirrors just the one-hop join AG-19 uses
 * to seed its own traversal (this funder's pig_nodes row + pig_edges
 * touching it) — the full multi-hop chain a queued introduction path
 * actually used is instead read verbatim from that path's own
 * agent_decisions row (decision_type='introduction_path_queued'), whose
 * action_taken text and action_payload already contain the real chain AG-19
 * computed, so it never needs to be re-derived here.
 */
async function loadFunderSlice(
  supabase: SupabaseClient,
  organizationId: string,
  funder: FunderRow,
) {
  const [recRes, decisionsRes, nodeRes] = await Promise.all([
    supabase
      .from("relationship_recommendations")
      .select("id, recommendation_text, urgency, status, created_at")
      .eq("org_id", organizationId)
      .eq("entity_id", funder.id)
      .eq("entity_type", "funder")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("agent_decisions")
      .select(
        "id, decision_type, reasoning, action_taken, action_payload, confidence_score, required_human_review, created_at",
      )
      .eq("org_id", organizationId)
      .eq("agent_id", AGENT_ID)
      .eq("entity_type", "funder")
      .eq("entity_id", funder.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("pig_nodes")
      .select("id")
      .eq("entity_table", "funders")
      .eq("entity_id", funder.id)
      .maybeSingle(),
  ]);

  if (recRes.error || decisionsRes.error) {
    const message =
      recRes.error?.message ?? decisionsRes.error?.message ?? "Unknown error.";
    return {
      funderId: funder.id,
      funderName: funder.name,
      tablesAvailable: false,
      message: `Relationship Builder data is unavailable right now: ${message}`,
      recommendation: null,
      decisions: [],
      hasGraphNode: false,
      directConnections: [],
    };
  }

  const nodeId = (nodeRes.data as { id: string } | null)?.id ?? null;
  let directConnections: Array<{
    relationshipType: string;
    evidence: string | null;
    weight: number | null;
    connectedToLabel: string;
    connectedToType: string | null;
  }> = [];

  if (nodeId) {
    const { data: edgeRows, error: edgesError } = await supabase
      .from("pig_edges")
      .select(
        "id, source_node_id, target_node_id, relationship_type, evidence, weight",
      )
      .or(`source_node_id.eq.${nodeId},target_node_id.eq.${nodeId}`);

    if (!edgesError && edgeRows && edgeRows.length > 0) {
      const otherIds = Array.from(
        new Set(
          edgeRows.map((e) =>
            (e as { source_node_id: string; target_node_id: string })
              .source_node_id === nodeId
              ? (e as { target_node_id: string }).target_node_id
              : (e as { source_node_id: string }).source_node_id,
          ),
        ),
      );

      let labelMap = new Map<string, { label: string; node_type: string }>();
      if (otherIds.length > 0) {
        const { data: otherNodes } = await supabase
          .from("pig_nodes")
          .select("id, label, node_type")
          .in("id", otherIds);
        labelMap = new Map(
          ((otherNodes ?? []) as Array<{
            id: string;
            label: string;
            node_type: string;
          }>).map((n) => [n.id, { label: n.label, node_type: n.node_type }]),
        );
      }

      directConnections = (
        edgeRows as Array<{
          source_node_id: string;
          target_node_id: string;
          relationship_type: string;
          evidence: string | null;
          weight: number | null;
        }>
      ).map((e) => {
        const otherId =
          e.source_node_id === nodeId ? e.target_node_id : e.source_node_id;
        const other = labelMap.get(otherId);
        return {
          relationshipType: e.relationship_type,
          evidence: e.evidence,
          weight: e.weight,
          connectedToLabel: other?.label ?? "Unknown connection",
          connectedToType: other?.node_type ?? null,
        };
      });
    }
  }

  return {
    funderId: funder.id,
    funderName: funder.name,
    tablesAvailable: true,
    message: null as string | null,
    recommendation: recRes.data?.[0] ?? null,
    decisions: decisionsRes.data ?? [],
    hasGraphNode: Boolean(nodeId),
    directConnections,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const funder = await resolveFunder(supabase, organizationId, params.id);
  if (!funder) {
    return jsonError("Funder not found.", "not_found", 404);
  }

  const slice = await loadFunderSlice(supabase, organizationId, funder);
  return NextResponse.json(slice);
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const funder = await resolveFunder(supabase, organizationId, params.id);
  if (!funder) {
    return jsonError("Funder not found.", "not_found", 404);
  }

  const agent = new RelationshipBuilderAgent(organizationId, supabase);
  const result = await agent.run("manual");

  if (!result.success) {
    return jsonError(
      result.errors[0] ?? "Relationship builder run failed.",
      "relationship_builder_run_failed",
      500,
    );
  }

  const slice = await loadFunderSlice(supabase, organizationId, funder);
  return NextResponse.json({
    ...slice,
    runSummary: {
      itemsFound: result.itemsFound,
      itemsProcessed: result.itemsProcessed,
      itemsQueued: result.itemsQueued,
      errors: result.errors,
    },
  });
}
