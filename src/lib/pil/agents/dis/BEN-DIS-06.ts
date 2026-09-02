import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  callTool,
  findOrCreateProspect,
  hostnameOf,
  MODEL_TOKEN_UNIT_COST_USD,
  parseGoalCriteria,
  recordDiscoveryEvidence,
  recordProspectClassification,
  tryModelTokens,
} from "@/lib/pil/agents/dis/shared";
import { logAction } from "@/lib/pil/audit";
import { upsertEdge, upsertNode } from "@/lib/pil/graph";
import type { EvidenceItem, ProspectEntityType } from "@/lib/pil/types";

// BEN-DIS-06 -- Geographic Funding Discovery Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 2 -- DISCOVERY"). Maps the
// funding landscape within a resolved geographic footprint (state or named
// region) -- foundation_directory matches, community foundations, and local
// corporate/business giving programs.
//
// The task spec that commissioned this batch numbered this agent's mission
// "STEP 2" under the code BEN-DIS-07 and put a different mission
// ("Executive Prospect Discovery") under BEN-DIS-06. The live registry
// (supabase/migrations/155_pil_agent_registry.sql) and
// PROSPECT_INTELLIGENCE_AGENTS.md both assign "Geographic Funding Discovery
// Agent" to BEN-DIS-06 and already have "Executive Prospect Discovery"
// implemented at BEN-DIS-05.ts. Per this codebase's established pattern
// (see BEN-DIS-03.ts/BEN-DIS-04.ts/BEN-DIS-05.ts headers) of trusting live
// registry/spec state over a task-given description when they collide,
// this file implements BEN-DIS-06 exactly as the registry defines it; the
// task's "Executive Prospect Discovery" step is already covered by
// BEN-DIS-05 and is not duplicated here.
//
// Permitted tools per spec: T-WEB, T-990, T-PUBREC, T-GRAPH (write),
// T-EVIDENCE (write). Concrete registry tool keys: web_search,
// irs_990_lookup, entity_lookup (T-PUBREC-equivalent internal lookup
// against foundation_directory, same mapping BEN-DIS-03 uses).
//
// Geographic boundary resolution: entity_lookup's own DB query already
// filters foundation_directory by state when a `location` param is passed
// (tools/entity-lookup.ts's searchFoundationDirectory), so matches sourced
// that way are boundary-confirmed by construction. Candidates surfaced via
// open web search (community foundations, local giving programs) carry no
// crawl-confirmed operating footprint -- per spec's own observation
// behavior ("confirms a candidate's operating footprint, not just a
// mailing address") and failure criteria ("ambiguity silently resolved
// without a note"), those are flagged with a pil_prospect_classifications
// (dimension='geography') row rather than asserted as in-boundary.

interface GeoDiscovery {
  prospectId: string;
  displayName: string;
  confidence: number;
  created: boolean;
  boundaryConfirmed: boolean;
}

export class GeographicFundingDiscoveryAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (context.goal.trim().length === 0) {
      return {
        status: "completed",
        evidence: [],
        conclusions: { skipped: true, reason: "BEN-DIS-06 requires a non-empty goal" },
        delegations: [],
        tokensUsed: 0,
        costUsd: 0,
        error: null,
      };
    }

    const criteria = parseGoalCriteria(context.goal);
    const geoLabel = criteria.stateCode ?? criteria.geography ?? "";
    const evidenceCreated: EvidenceItem[] = [];
    const discoveries: GeoDiscovery[] = [];

    let geographyNode = null as Awaited<ReturnType<typeof upsertNode>> | null;
    if (geoLabel) {
      geographyNode = await upsertNode({
        organization_id: context.orgId,
        node_type: "geography",
        prospect_id: null,
        label: geoLabel,
        properties: { resolvedFrom: criteria.geography, stateCode: criteria.stateCode },
      });
    }

    // 1. foundation_directory matches, boundary-confirmed by the lookup
    // tool's own state filter.
    const lookupResult = await callTool(context, runner, "entity_lookup", {
      name: criteria.cause ?? "foundation",
      type: "foundation",
      location: criteria.stateCode ?? undefined,
    });
    if (lookupResult.success) {
      try {
        const matches = ((lookupResult.data as { matches?: Array<{ source: string; name: string; location: string | null; confidence: number; ein: string | null }> } | null)?.matches ?? []).filter(
          (m) => m.source === "foundation_directory",
        );
        for (const match of matches) {
          await this.recordCandidate(context, runner, {
            orgId: context.orgId,
            displayName: match.name,
            entityType: "private_foundation",
            nodeType: "foundation",
            claim: `Foundation operating in resolved geography ${geoLabel}: ${match.name}`,
            claimType: "geographic_funder_directory_match",
            sourceUrl: null,
            sourceTitle: match.name,
            sourceType: "foundation_information",
            publisher: "IRS Business Master File",
            confidence: match.confidence,
            verificationStatus: "single_source_fact",
            boundaryConfirmed: true,
            geoLabel,
            geographyNode,
            discoveries,
            evidenceCreated,
          });

          // Fund magnitude for the landscape map, when an EIN is available.
          if (match.ein) {
            const nineNinety = await callTool(context, runner, "irs_990_lookup", { ein: match.ein });
            if (nineNinety.success) {
              const data = nineNinety.data as { total_grants_paid: number | null; filing_year: number | null };
              if (data.total_grants_paid != null) {
                const { prospect } = await findOrCreateProspect({
                  orgId: context.orgId,
                  displayName: match.name,
                  entityType: "private_foundation",
                  agentCode: context.agentCode,
                });
                evidenceCreated.push(
                  await recordDiscoveryEvidence({
                    orgId: context.orgId,
                    prospectId: prospect.id,
                    claim: `Total grants paid within resolved geography ${geoLabel} per most recent 990 (${data.filing_year ?? "unknown year"}): ${data.total_grants_paid}`,
                    value: { totalGrantsPaid: data.total_grants_paid, filingYear: data.filing_year, geography: geoLabel },
                    claimType: "geographic_funding_landscape_magnitude",
                    sourceUrl: null,
                    sourceTitle: match.name,
                    sourceType: "irs_form_990",
                    publisher: "IRS Form 990",
                    evidenceExcerpt: null,
                    agentCode: context.agentCode,
                    researchRunId: context.runId,
                    confidence: 0.7,
                    verificationStatus: "corroborated_fact",
                  }),
                );
              }
            }
          }
        }
      } catch (err) {
        // Recovery protocol: an unexpected thrown error while processing
        // this phase's matches must not abort the community-foundation or
        // local-program phases below.
        await logAction({
          organization_id: context.orgId,
          actor_type: "agent",
          actor_id: context.agentCode,
          action: "discovery.geo_phase_failed",
          resource_type: "pil_agent_runs",
          resource_id: context.runId,
          before_state: null,
          after_state: { phase: "foundation_directory", message: err instanceof Error ? err.message : String(err) },
          policy_decision: null,
          ip_address: null,
        });
      }
    }

    // 2. Community foundations serving the area -- open web search only,
    // footprint not crawl-confirmed.
    const communitySearch = await callTool(context, runner, "web_search", {
      query: `community foundation ${geoLabel}`.trim(),
      limit: 10,
    });
    if (communitySearch.success) {
      try {
        const results = ((communitySearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
        for (const item of results) {
          await this.recordCandidate(context, runner, {
            orgId: context.orgId,
            displayName: item.title,
            entityType: "community_foundation",
            nodeType: "foundation",
            claim: `Community foundation serving ${geoLabel}: ${item.title}`,
            claimType: "community_foundation_mention",
            sourceUrl: item.url,
            sourceTitle: item.title,
            sourceType: "open_web",
            publisher: hostnameOf(item.url),
            confidence: 0.4,
            verificationStatus: "unverified",
            boundaryConfirmed: false,
            geoLabel,
            geographyNode,
            discoveries,
            evidenceCreated,
          });
        }
      } catch (err) {
        await logAction({
          organization_id: context.orgId,
          actor_type: "agent",
          actor_id: context.agentCode,
          action: "discovery.geo_phase_failed",
          resource_type: "pil_agent_runs",
          resource_id: context.runId,
          before_state: null,
          after_state: { phase: "community_foundation", message: err instanceof Error ? err.message : String(err) },
          policy_decision: null,
          ip_address: null,
        });
      }
    }

    // 3. Local corporate/business giving programs.
    const localProgramSearch = await callTool(context, runner, "web_search", {
      query: `local giving program OR corporate community grants ${geoLabel}`.trim(),
      limit: 10,
    });
    if (localProgramSearch.success) {
      try {
        const results = ((localProgramSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
        for (const item of results) {
          await this.recordCandidate(context, runner, {
            orgId: context.orgId,
            displayName: item.title,
            entityType: "institutional_funder",
            nodeType: "foundation",
            claim: `Local giving program in ${geoLabel}: ${item.title}`,
            claimType: "local_giving_program_mention",
            sourceUrl: item.url,
            sourceTitle: item.title,
            sourceType: "open_web",
            publisher: hostnameOf(item.url),
            confidence: 0.35,
            verificationStatus: "unverified",
            boundaryConfirmed: false,
            geoLabel,
            geographyNode,
            discoveries,
            evidenceCreated,
          });
        }
      } catch (err) {
        await logAction({
          organization_id: context.orgId,
          actor_type: "agent",
          actor_id: context.agentCode,
          action: "discovery.geo_phase_failed",
          resource_type: "pil_agent_runs",
          resource_id: context.runId,
          before_state: null,
          after_state: { phase: "local_program", message: err instanceof Error ? err.message : String(err) },
          policy_decision: null,
          ip_address: null,
        });
      }
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    const boundaryConfirmedCount = discoveries.filter((d) => d.boundaryConfirmed).length;
    const unconfirmed = discoveries.filter((d) => !d.boundaryConfirmed);
    const sourceDiversityNote = `${boundaryConfirmedCount} boundary-confirmed / ${unconfirmed.length} unconfirmed of ${discoveries.length} total`;
    // Deliberately conservative, documented default (< 3 candidates across
    // all three source phases for a resolved geography) pending a real
    // calibration dataset -- not a magic number. This is the "dense urban
    // data crowds out low-data geography" failure mode the spec names.
    const lowDataGeographyRisk = geoLabel !== "" && discoveries.length < 3;

    const delegations: DelegationRequest[] = [];

    // "May delegate cause-alignment refinement to BEN-DIS-07" (spec).
    if (discoveries.length > 0) {
      delegations.push({
        childAgentCode: "BEN-DIS-07",
        objective: `Refine cause alignment for geographically-discovered prospects: ${discoveries.map((d) => d.prospectId).join(", ")}`,
        maxAutonomy: "A2" as const,
        constraints: { prospectIds: discoveries.map((d) => d.prospectId) },
      });
    }

    // Place canonicalization for boundary-unconfirmed candidates is
    // delegated to deterministic services and BEN-KNW-02 (roster
    // dependency).
    if (unconfirmed.length > 0) {
      delegations.push({
        childAgentCode: "BEN-KNW-02",
        objective: `Canonicalize place/geography for boundary-unconfirmed funding candidates in ${geoLabel}: ${unconfirmed.map((d) => d.prospectId).join(", ")}`,
        maxAutonomy: "A2" as const,
        constraints: { unconfirmedProspectIds: unconfirmed.map((d) => d.prospectId), geoLabel },
      });
    }

    // Critic review (feeds BEN-SUP-05, roster dependency) for every run that
    // discovered at least one candidate.
    if (discoveries.length > 0) {
      delegations.push({
        childAgentCode: "BEN-SUP-05",
        objective: `Critic review for BEN-DIS-06 geographic funding discoveries in ${geoLabel}: ${discoveries.map((d) => d.prospectId).join(", ")}`,
        maxAutonomy: "A2" as const,
        constraints: { prospectIds: discoveries.map((d) => d.prospectId), geoLabel },
      });
    }

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        criteria,
        resolvedGeography: geoLabel || null,
        discoveredProspectIds: discoveries.map((d) => d.prospectId),
        discoveries,
        sourceDiversityNote,
        lowDataGeographyRisk,
      },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private async recordCandidate(
    context: AgentContext,
    _runner: AgentRunner,
    params: {
      orgId: string;
      displayName: string;
      entityType: ProspectEntityType;
      nodeType: "foundation" | "company";
      claim: string;
      claimType: string;
      sourceUrl: string | null;
      sourceTitle: string | null;
      sourceType: string;
      publisher: string | null;
      confidence: number;
      verificationStatus: "single_source_fact" | "unverified";
      boundaryConfirmed: boolean;
      geoLabel: string;
      geographyNode: Awaited<ReturnType<typeof upsertNode>> | null;
      discoveries: GeoDiscovery[];
      evidenceCreated: EvidenceItem[];
    },
  ): Promise<void> {
    const { prospect, created } = await findOrCreateProspect({
      orgId: params.orgId,
      displayName: params.displayName,
      entityType: params.entityType,
      agentCode: context.agentCode,
    });

    const evidence = await recordDiscoveryEvidence({
      orgId: params.orgId,
      prospectId: prospect.id,
      claim: params.claim,
      value: { displayName: params.displayName, geography: params.geoLabel, boundaryConfirmed: params.boundaryConfirmed },
      claimType: params.claimType,
      sourceUrl: params.sourceUrl,
      sourceTitle: params.sourceTitle,
      sourceType: params.sourceType,
      publisher: params.publisher,
      evidenceExcerpt: null,
      agentCode: context.agentCode,
      researchRunId: context.runId,
      confidence: params.confidence,
      verificationStatus: params.verificationStatus,
    });
    params.evidenceCreated.push(evidence);

    const candidateNode = await upsertNode({
      organization_id: params.orgId,
      node_type: params.nodeType,
      prospect_id: prospect.id,
      label: prospect.display_name,
      properties: { boundaryConfirmed: params.boundaryConfirmed },
    });

    if (params.geographyNode) {
      await upsertEdge({
        organization_id: params.orgId,
        source_node_id: candidateNode.id,
        target_node_id: params.geographyNode.id,
        edge_type: "operates_in",
        relationship_strength: params.boundaryConfirmed ? "strong" : "speculative",
        confidence: params.confidence,
        temporal_validity_start: null,
        temporal_validity_end: null,
        is_current: true,
        superseded_by_edge_id: null,
        properties: {},
      });
    }

    // Failure criteria: "Geocoding ambiguity silently resolved without a
    // note in pil_prospect_classifications (dimension='geography')" -- any
    // candidate whose footprint isn't confirmed gets a flagged
    // classification row rather than being silently included in the
    // boundary.
    if (!params.boundaryConfirmed && params.geoLabel) {
      await recordProspectClassification({
        orgId: params.orgId,
        prospectId: prospect.id,
        dimension: "geography",
        value: params.geoLabel,
        confidence: params.confidence,
        evidenceId: evidence.id,
      });
    }

    params.discoveries.push({
      prospectId: prospect.id,
      displayName: prospect.display_name,
      confidence: params.confidence,
      created,
      boundaryConfirmed: params.boundaryConfirmed,
    });
  }
}

export default GeographicFundingDiscoveryAgent;
