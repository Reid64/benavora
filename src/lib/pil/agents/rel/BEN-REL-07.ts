import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import { callTool, hostnameOf, MODEL_TOKEN_UNIT_COST_USD, recordRelationshipEvidence, tryModelTokens } from "@/lib/pil/agents/rel/shared";
import { getPilClient } from "@/lib/pil/db";
import { upsertEdge, upsertNode } from "@/lib/pil/graph";
import type { EvidenceItem, GraphEdge, GraphNode, ProspectEntityType } from "@/lib/pil/types";

// BEN-REL-07 -- Foundation Relationship Mapping Agent.
//
// PROSPECT_INTELLIGENCE_AGENTS.md's Family 4 (Relationship & Graph
// Intelligence) is a fixed 6-agent list, BEN-REL-01 through BEN-REL-06 (see
// that document's own agent-count table and supabase/migrations/
// 155_pil_agent_registry.sql lines 99-104) -- BEN-REL-07/08 do not exist
// there. The task spec that commissioned this batch numbered "Foundation
// Relationship Mapping" step 4 (BEN-REL-04 in the task's own numbering);
// the registry's real BEN-REL-04 is a different mission (Organizational
// Overlap, see BEN-REL-04.ts's header), so this mission went unbuilt when
// REL-01..06 were reconciled against the live registry/spec. Built here as a
// task-directed addition beyond the spec's 6-agent count, registered as the
// fleet's 47th agent by a new pil_agent_registry seed migration -- the same
// resolution this codebase already applied to BEN-SUP-07/08 (see migration
// 163's header for that precedent and the reasoning: AgentRunner.run()'s
// loadAgent() throws AgentNotFoundError for any unregistered agent_id, so an
// implementation with no registry row could never actually execute).
//
// Mission (from the task spec, since no PROSPECT_INTELLIGENCE_AGENTS.md
// section exists to cite): map foundation networks -- trustees, grant
// recipients, associated family members, and co-funders (other foundations
// funding the same causes/organizations) -- using 990 data extensively.
// Trustee discovery duplicates BEN-INT-06 (Foundation Intelligence)'s own
// 990 officer pull deliberately: BEN-INT-06 records officers as prospect
// intelligence evidence, this agent's job is the graph relationship itself
// (trustee_of edges) plus the two things no other agent builds --
// family-member inference and cross-foundation co-funder detection --
// consistent with Family 4's charter ("connecting Family 3's individually-
// correct facts into pathways", PROSPECT_INTELLIGENCE_AGENTS.md line ~606).
// upsertEdge's find-then-write means a trustee_of edge already created by a
// prior BEN-INT-06 run is reconciled, not duplicated.
//
// Grant-recipient edges: irs_990_lookup (tools/irs-990-tool.ts) exposes only
// aggregate total_grants_paid, not a line-item recipient table (that agent's
// own header: "explicitly out of scope"), so recipient-level donated_to
// edges are sourced from a web search for recent grant announcements
// instead -- the same open-web fallback BEN-REL-01 uses when a graph-native
// source doesn't exist.
//
// Co-funder detection is the one piece that is a genuine graph-query
// problem, not a research problem (REL-04's own framing): once this
// foundation's donated_to edges exist, any other foundation-type node with a
// donated_to edge to the same nonprofit target is a co-funder. Depends on
// donated_to edges this agent (and future runs against other foundation
// prospects) accumulates over time -- an empty result on a graph with no
// prior donated_to edges is expected, not a defect (same incremental-sweep
// caveat BEN-REL-04's header documents for its own overlap detection).
//
// Permitted tools: T-990, T-WEB, T-EVIDENCE (write), T-GRAPH (write) -- the
// same set BEN-INT-06 uses for the same underlying data source.

const FOUNDATION_TYPES: ProspectEntityType[] = [
  "family_foundation",
  "private_foundation",
  "community_foundation",
  "corporate_foundation",
];

interface NineNinetyOfficer {
  name: string | null;
  title: string | null;
  compensation: number | null;
}

interface NineNinetyData {
  ein: string | null;
  total_grants_paid: number | null;
  mission: string | null;
  officers: NineNinetyOfficer[];
  filing_year: number | null;
}

function surnameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

function foundationNameMatchesSurname(foundationLabel: string, surname: string): boolean {
  if (!surname) return false;
  return foundationLabel.toLowerCase().split(/\s+/).includes(surname);
}

export class FoundationRelationshipMappingAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-REL-07 requires an existing prospectId");
    }
    const client = getPilClient();
    const { data: prospectRow, error: prospectError } = await client
      .from("pil_prospects")
      .select("*")
      .eq("organization_id", context.orgId)
      .eq("id", context.prospectId)
      .maybeSingle();
    if (prospectError) throw prospectError;
    const prospect = prospectRow as { id: string; entity_type: ProspectEntityType; display_name: string } | null;
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }
    if (!FOUNDATION_TYPES.includes(prospect.entity_type)) {
      return this.completedEmpty(`Prospect ${prospect.id} is entity_type=${prospect.entity_type}, not a foundation type -- skipping`);
    }

    const { data: existingNodeRows, error: nodeError } = await client
      .from("pil_graph_nodes")
      .select("*")
      .eq("organization_id", context.orgId)
      .eq("prospect_id", prospect.id)
      .eq("node_type", "foundation");
    if (nodeError) throw nodeError;
    let foundationNode = ((existingNodeRows ?? []) as GraphNode[])[0] ?? null;
    if (!foundationNode) {
      foundationNode = await upsertNode({
        organization_id: context.orgId,
        node_type: "foundation",
        prospect_id: prospect.id,
        label: prospect.display_name,
        properties: {},
      });
    }

    let ein = typeof foundationNode.properties?.ein === "string" ? (foundationNode.properties.ein as string) : null;
    if (!ein) {
      const lookup = await callTool(context, runner, "entity_lookup", { name: prospect.display_name, type: "foundation" });
      if (lookup.success) {
        ein =
          ((lookup.data as { matches?: Array<{ source: string; ein: string | null }> } | null)?.matches ?? []).find(
            (m) => m.source === "foundation_directory" && m.ein,
          )?.ein ?? null;
      }
    }

    const evidenceCreated: EvidenceItem[] = [];
    const trusteeEdgeIds: string[] = [];
    const familyEdgeIds: string[] = [];
    const grantRecipientEdgeIds: string[] = [];
    const coFunderEdgeIds: string[] = [];
    const trusteeNames: string[] = [];

    if (ein) {
      if (!foundationNode.properties?.ein) {
        foundationNode = await upsertNode({
          organization_id: context.orgId,
          node_type: "foundation",
          prospect_id: prospect.id,
          label: prospect.display_name,
          properties: { ...foundationNode.properties, ein },
        });
      }

      const nineNinety = await callTool(context, runner, "irs_990_lookup", { ein });
      if (nineNinety.success) {
        const data = nineNinety.data as NineNinetyData;

        for (const officer of data.officers) {
          if (!officer.name) continue;
          trusteeNames.push(officer.name);
          const officerNode = await upsertNode({
            organization_id: context.orgId,
            node_type: "person",
            prospect_id: null,
            label: officer.name,
            properties: { title: officer.title },
          });
          const trusteeEdge = await upsertEdge({
            organization_id: context.orgId,
            source_node_id: officerNode.id,
            target_node_id: foundationNode.id,
            edge_type: "trustee_of",
            relationship_strength: "strong",
            confidence: 0.75,
            temporal_validity_start: null,
            temporal_validity_end: null,
            is_current: true,
            superseded_by_edge_id: null,
            properties: { title: officer.title, filingYear: data.filing_year },
          });
          trusteeEdgeIds.push(trusteeEdge.id);

          evidenceCreated.push(
            await recordRelationshipEvidence({
              orgId: context.orgId,
              entityTable: "pil_graph_edges",
              entityId: trusteeEdge.id,
              claim: `Trustee/officer per most recent 990 filing (${data.filing_year ?? "unknown year"}): ${officer.name}${officer.title ? ` (${officer.title})` : ""} at ${prospect.display_name}`,
              value: { name: officer.name, title: officer.title, filingYear: data.filing_year },
              claimType: "foundation_trustee",
              sourceUrl: null,
              sourceTitle: prospect.display_name,
              sourceType: "irs_form_990",
              publisher: "IRS Form 990",
              evidenceExcerpt: null,
              agentCode: context.agentCode,
              researchRunId: context.runId,
              confidence: 0.75,
              verificationStatus: "corroborated_fact",
            }),
          );

          // Associated family members: a trustee whose surname matches a
          // word in the foundation's own name (e.g. "Smith Family
          // Foundation" trustee "John Smith") -- a heuristic, not a fact, so
          // recorded at low confidence and 'speculative' strength.
          const surname = surnameOf(officer.name);
          if (foundationNameMatchesSurname(prospect.display_name, surname)) {
            const familyEdge = await upsertEdge({
              organization_id: context.orgId,
              source_node_id: officerNode.id,
              target_node_id: foundationNode.id,
              edge_type: "related_to",
              relationship_strength: "speculative",
              confidence: 0.35,
              temporal_validity_start: null,
              temporal_validity_end: null,
              is_current: true,
              superseded_by_edge_id: null,
              properties: { relationshipType: "family_member", inferredFrom: "surname_match", surname },
            });
            familyEdgeIds.push(familyEdge.id);
          }
        }

        // Grant recipients: irs_990_lookup exposes only aggregate
        // total_grants_paid, no recipient list -- fall back to a targeted
        // web search for recent grant announcements naming this foundation.
        const grantSearch = await callTool(context, runner, "web_search", {
          query: `"${prospect.display_name}" grant awarded OR "grant recipient" nonprofit`,
          limit: 3,
        });
        if (grantSearch.success) {
          const results = (grantSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? [];
          for (const result of results.slice(0, 3)) {
            const recipientNode = await upsertNode({
              organization_id: context.orgId,
              node_type: "nonprofit",
              prospect_id: null,
              label: result.title,
              properties: { discoveredVia: "grant_announcement_search" },
            });
            const grantEdge = await upsertEdge({
              organization_id: context.orgId,
              source_node_id: foundationNode.id,
              target_node_id: recipientNode.id,
              edge_type: "donated_to",
              relationship_strength: "weak",
              confidence: 0.35,
              temporal_validity_start: null,
              temporal_validity_end: null,
              is_current: true,
              superseded_by_edge_id: null,
              properties: { sourceTitle: result.title },
            });
            grantRecipientEdgeIds.push(grantEdge.id);

            evidenceCreated.push(
              await recordRelationshipEvidence({
                orgId: context.orgId,
                entityTable: "pil_graph_edges",
                entityId: grantEdge.id,
                claim: `Possible grant relationship from ${prospect.display_name}: ${result.title}`,
                value: { title: result.title, url: result.url },
                claimType: "foundation_grant_recipient",
                sourceUrl: result.url,
                sourceTitle: result.title,
                sourceType: "open_web",
                publisher: hostnameOf(result.url),
                evidenceExcerpt: null,
                agentCode: context.agentCode,
                researchRunId: context.runId,
                confidence: 0.35,
                verificationStatus: "unverified",
              }),
            );
          }
        }
      }
    }

    // Co-funders: other foundation-type nodes with a current donated_to
    // edge to a nonprofit this foundation also funds -- a set-intersection
    // over donated_to edges (this foundation's grant-recipient targets),
    // the same graph-query pattern BEN-REL-04 uses for org-wide overlap,
    // scoped to this foundation's own recipients.
    const { data: ownGrantEdgeRows, error: ownGrantError } = await client
      .from("pil_graph_edges")
      .select("*")
      .eq("organization_id", context.orgId)
      .eq("is_current", true)
      .eq("edge_type", "donated_to")
      .eq("source_node_id", foundationNode.id);
    if (ownGrantError) throw ownGrantError;
    const ownGrantTargets = ((ownGrantEdgeRows ?? []) as GraphEdge[]).map((e) => e.target_node_id);

    if (ownGrantTargets.length > 0) {
      const { data: otherGrantEdgeRows, error: otherGrantError } = await client
        .from("pil_graph_edges")
        .select("*")
        .eq("organization_id", context.orgId)
        .eq("is_current", true)
        .eq("edge_type", "donated_to")
        .in("target_node_id", ownGrantTargets)
        .neq("source_node_id", foundationNode.id);
      if (otherGrantError) throw otherGrantError;
      const otherFunderEdges = (otherGrantEdgeRows ?? []) as GraphEdge[];

      const coFunderNodeIds = new Set(otherFunderEdges.map((e) => e.source_node_id));
      for (const coFunderNodeId of coFunderNodeIds) {
        const sharedTargets = otherFunderEdges.filter((e) => e.source_node_id === coFunderNodeId).map((e) => e.target_node_id);
        const coFunderEdge = await upsertEdge({
          organization_id: context.orgId,
          source_node_id: foundationNode.id,
          target_node_id: coFunderNodeId,
          edge_type: "related_to",
          relationship_strength: sharedTargets.length > 1 ? "moderate" : "weak",
          confidence: 0.5,
          temporal_validity_start: null,
          temporal_validity_end: null,
          is_current: true,
          superseded_by_edge_id: null,
          properties: { relationshipType: "co_funder", sharedRecipientNodeIds: sharedTargets },
        });
        coFunderEdgeIds.push(coFunderEdge.id);

        evidenceCreated.push(
          await recordRelationshipEvidence({
            orgId: context.orgId,
            entityTable: "pil_graph_edges",
            entityId: coFunderEdge.id,
            claim: `Co-funder relationship: ${prospect.display_name} and another foundation both fund ${sharedTargets.length} shared recipient organization(s)`,
            value: { sharedRecipientCount: sharedTargets.length },
            claimType: "foundation_co_funder",
            sourceUrl: null,
            sourceTitle: null,
            sourceType: "internal",
            publisher: null,
            evidenceExcerpt: null,
            agentCode: context.agentCode,
            researchRunId: context.runId,
            confidence: 0.5,
            verificationStatus: "reasoned_inference",
          }),
        );
      }
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        prospectId: prospect.id,
        ein,
        trusteeNames,
        trusteeEdgeIds,
        familyEdgeIds,
        grantRecipientEdgeIds,
        coFunderEdgeIds,
      },
      delegations: [],
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private completedEmpty(reason: string): AgentResult {
    return {
      status: "completed",
      evidence: [],
      conclusions: { skipped: true, reason },
      delegations: [],
      tokensUsed: 0,
      costUsd: 0,
      error: null,
    };
  }
}

export default FoundationRelationshipMappingAgent;
