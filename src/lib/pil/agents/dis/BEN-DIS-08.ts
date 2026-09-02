import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { logAction } from "@/lib/pil/audit";
import {
  callTool,
  findExistingProspect,
  hostnameOf,
  MODEL_TOKEN_UNIT_COST_USD,
  normalizeName,
  recordDiscoveryEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/dis/shared";
import { getPilClient } from "@/lib/pil/db";
import { upsertEdge, upsertNode } from "@/lib/pil/graph";
import type { EvidenceItem, GraphNodeType, Prospect, ProspectEntityType } from "@/lib/pil/types";

// BEN-DIS-08 -- Hidden Prospect & CRM Rediscovery Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 2 -- DISCOVERY"). Identifies
// overlooked high-potential prospects already present within Benavora's own
// first-party CRM data (`funders`/`contacts`, migration 001) -- connecting
// every existing CRM record into the PIL graph and flagging records whose
// externally-discoverable profile (board seats, family-office/DAF
// affiliation) materially exceeds what the CRM's own giving-tier field
// reflects.
//
// The task spec that commissioned this batch described this mission as two
// separate agents: "STEP 4 Hidden Prospect Discovery" (BEN-DIS-09: anonymous
// donors, obscure-foundation board members, DAF trustees, family office
// principals, via web_crawl + 990 data) and "STEP 5 Existing CRM Prospect
// Rediscovery" (BEN-DIS-10: query funders/contacts/foundations, dedup via
// entity_lookup, link into the graph). Neither BEN-DIS-09 nor BEN-DIS-10
// exists in the live registry (supabase/migrations/155_pil_agent_registry.sql)
// or PROSPECT_INTELLIGENCE_AGENTS.md -- Family 2 Discovery is a hard-capped
// 8 agents there (BEN-DIS-01..08; see the family's own "| Discovery | 8 |
// BEN-DIS-01 .. BEN-DIS-08 |" summary row). The registry's single BEN-DIS-08
// is explicitly titled "Hidden Prospect & CRM Rediscovery Agent" and its
// spec'd planning behavior already fuses both halves: "Scans existing CRM
// records for external-wealth/board signals (company ownership, foundation
// board seats) not reflected in the CRM's own giving-tier field, then
// verifies externally before flagging." Per this codebase's established
// pattern (see BEN-DIS-03/04/05/06/07 headers) of trusting live
// registry/spec state over a task-given split when they collide, both
// halves are implemented here as one agent, anchored to CRM records exactly
// as the spec's own inputs/outputs describe (never a cold web-only search
// for anonymous donors with no CRM anchor -- that search shape isn't
// supported by this agent's permitted tools, see below).
//
// Permitted tools per spec: T-CRM (read), T-WEB, T-GRAPH (read/write),
// T-EVIDENCE (write). Notably NOT T-990, T-CRAWL, T-NEWS, or T-PUBREC. No
// T-CRM Tool is registered in tools/index.ts (only entity_lookup,
// irs_990_lookup, news_search, web_crawl, web_search exist) -- same
// situation BEN-DIS-04.ts documents for T-EDGAR. "T-CRM (read)" here means a
// direct read of this platform's own `funders`/`contacts` tables via the
// service-role client (getPilClient() -- same admin client db.ts wraps),
// not a call through the Tool/cost-ledger system. Dedup ("checks if a
// pil_prospect already exists") uses shared.ts's findExistingProspect
// directly against pil_prospects, which needs no Tool call either --
// entity_lookup (T-PUBREC) is not in this agent's permitted set.
//
// Human boundary (spec): "no automatic solicitation escalation -- flags
// only, never triggers outreach." This agent never writes to
// funders/contacts and never creates a pil_delegated_tasks row aimed at
// contact/outreach agents.

// CONSTITUTIONAL INVARIANT (spec): "no CRM mutation command exists at all"
// for this agent -- only a separately governed dedicated synchronization
// authority (not itself an agent, no ID given) may ever translate an
// approved governed decision into a CRM mutation. This agent's human
// boundary is "no automatic solicitation escalation -- flags only, never
// triggers outreach." Every getPilClient().from(...) call against either
// table below is a .select(...) read, never an .insert/.update/.delete --
// writes only ever target this agent's own pil_prospects/pil_graph_nodes/
// pil_graph_edges/pil_evidence tables. This must never change.
const READ_ONLY_CRM_TABLES = ["funders", "contacts"] as const;

const HIDDEN_SIGNAL_QUERY_SUFFIX = "board OR trustee OR family office OR donor-advised fund";

interface FunderRow {
  id: string;
  name: string;
  category: string;
  annual_giving_budget: number | null;
}

interface ContactRow {
  id: string;
  funder_id: string;
  name: string;
  title: string | null;
  relationship: string | null;
  last_contacted_at: string | null;
}

function inferFunderEntityType(category: string): ProspectEntityType {
  if (category === "corporate_foundation") return "corporate_foundation";
  if (category === "private_foundation") return "private_foundation";
  if (category === "corporate_donation" || category === "corporate_sponsorship") return "corporation";
  return "institutional_funder";
}

function inferFunderNodeType(category: string): GraphNodeType {
  if (category === "corporate_donation" || category === "corporate_sponsorship") return "company";
  return "foundation";
}

async function findOrCreateCrmProspect(
  orgId: string,
  displayName: string,
  entityType: ProspectEntityType,
  agentCode: string,
): Promise<{ prospect: Prospect; created: boolean }> {
  const existing = await findExistingProspect(orgId, displayName);
  if (existing) return { prospect: existing, created: false };

  const { data, error } = await getPilClient()
    .from("pil_prospects")
    .insert({
      organization_id: orgId,
      entity_type: entityType,
      display_name: displayName,
      canonical_name: normalizeName(displayName),
      status: "active",
      merged_into_prospect_id: null,
      // Spec input: "pil_prospects sourced source_of_record='crm_import'".
      source_of_record: "crm_import",
      created_by_agent_id: agentCode,
    })
    .select("*")
    .single();
  if (error) throw error;
  return { prospect: data as Prospect, created: true };
}

interface RediscoveryFlag {
  prospectId: string;
  displayName: string;
  crmTable: (typeof READ_ONLY_CRM_TABLES)[number];
  crmRecordId: string;
  reason: string;
}

export class HiddenProspectAndCrmRediscoveryAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const evidenceCreated: EvidenceItem[] = [];
    const linkedProspectIds: string[] = [];
    const newlyCreatedProspectIds: string[] = [];
    const reclassificationFlags: RediscoveryFlag[] = [];
    const entityResolutionCandidateProspectIds: string[] = [];

    // Schema gap (live schema, src/types/database.ts): neither `funders` nor
    // `contacts` currently has any consent/suppression/deletion column, so
    // the spec's suppression-precedence and deletion-safe-restore
    // requirements cannot be implemented against real data yet. This is an
    // honest, documented gap rather than a guess at columns that don't
    // exist -- if either table ever gains such a column, rows carrying an
    // active suppression or unresolved-deletion flag must be excluded from
    // CRM-cross-reference and hidden-signal search entirely.
    // READ-ONLY per BEN-DIS-08's constitutional invariant -- see READ_ONLY_CRM_TABLES above. Never .insert/.update/.delete here.
    const { data: funderRows, error: funderError } = await getPilClient()
      .from("funders")
      .select("id, name, category, annual_giving_budget")
      .eq("organization_id", context.orgId);
    if (funderError) throw funderError;
    const funders = (funderRows ?? []) as FunderRow[];

    // Schema gap (live schema, src/types/database.ts): `contacts` likewise
    // has no consent/suppression/deletion column today -- same documented
    // gap as `funders` above.
    // READ-ONLY per BEN-DIS-08's constitutional invariant -- see READ_ONLY_CRM_TABLES above. Never .insert/.update/.delete here.
    const { data: contactRows, error: contactError } = await getPilClient()
      .from("contacts")
      .select("id, funder_id, name, title, relationship, last_contacted_at")
      .eq("organization_id", context.orgId);
    if (contactError) throw contactError;
    const contacts = (contactRows ?? []) as ContactRow[];

    if (funders.length === 0 && contacts.length === 0) {
      return {
        status: "completed",
        evidence: [],
        conclusions: { skipped: true, reason: "BEN-DIS-08 found no funders/contacts rows to scan for org " + context.orgId },
        delegations: [],
        tokensUsed: 0,
        costUsd: 0,
        error: null,
      };
    }

    const funderProspectNodeByFunderId = new Map<string, Awaited<ReturnType<typeof upsertNode>>>();

    for (const funder of funders) {
      try {
      const entityType = inferFunderEntityType(funder.category);
      const nodeType = inferFunderNodeType(funder.category);
      const { prospect, created } = await findOrCreateCrmProspect(context.orgId, funder.name, entityType, context.agentCode);
      if (created) {
        newlyCreatedProspectIds.push(prospect.id);
      } else {
        // The CRM record matched an already-existing pil_prospect (possibly
        // sourced by a different Discovery agent) -- this agent must never
        // assume the match itself; BEN-KNW-02 confirms entity resolution.
        entityResolutionCandidateProspectIds.push(prospect.id);
      }
      linkedProspectIds.push(prospect.id);

      // The CRM record and the pil_prospect as two distinct, explicitly
      // linked graph entities (spec: "links the existing CRM record to the
      // pil_prospect via graph edge"), not just prospect_id on one node.
      const crmRecordNode = await upsertNode({
        organization_id: context.orgId,
        node_type: nodeType,
        prospect_id: null,
        label: `${funder.name} (CRM funder record)`,
        properties: { crmTable: "funders", crmRecordId: funder.id, category: funder.category },
      });
      const prospectNode = await upsertNode({
        organization_id: context.orgId,
        node_type: nodeType,
        prospect_id: prospect.id,
        label: prospect.display_name,
        properties: {},
      });
      await upsertEdge({
        organization_id: context.orgId,
        source_node_id: crmRecordNode.id,
        target_node_id: prospectNode.id,
        edge_type: "related_to",
        relationship_strength: "very_strong",
        confidence: 1,
        temporal_validity_start: null,
        temporal_validity_end: null,
        is_current: true,
        superseded_by_edge_id: null,
        properties: { relationship: "crm_record_of" },
      });
      funderProspectNodeByFunderId.set(funder.id, prospectNode);

      evidenceCreated.push(
        await recordDiscoveryEvidence({
          orgId: context.orgId,
          prospectId: prospect.id,
          claim: `Existing Benavora CRM funder record cross-referenced into the PIL graph: ${funder.name}`,
          value: { crmRecordId: funder.id, category: funder.category, annualGivingBudget: funder.annual_giving_budget },
          claimType: "crm_funder_record",
          sourceUrl: null,
          sourceTitle: funder.name,
          sourceType: "crm",
          publisher: "Benavora CRM",
          evidenceExcerpt: null,
          agentCode: context.agentCode,
          researchRunId: context.runId,
          confidence: 0.9,
          verificationStatus: "verified_fact",
        }),
      );

      // Hidden-signal check -- only a material gap against the CRM's own
      // giving-tier field is flagged (spec observation behavior), never a
      // signal alone.
      if (funder.annual_giving_budget == null) {
        const hiddenSearch = await callTool(context, runner, "web_search", {
          query: `"${funder.name}" ${HIDDEN_SIGNAL_QUERY_SUFFIX}`,
          limit: 3,
        });
        if (hiddenSearch.success) {
          const results = ((hiddenSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
          const top = results[0];
          if (top) {
            evidenceCreated.push(
              await recordDiscoveryEvidence({
                orgId: context.orgId,
                prospectId: prospect.id,
                claim: `Hidden capacity/affiliation signal for CRM funder ${funder.name} not reflected in giving-tier field on file: ${top.title}`,
                value: { title: top.title, url: top.url },
                claimType: "hidden_capacity_signal_flag",
                sourceUrl: top.url,
                sourceTitle: top.title,
                sourceType: "open_web",
                publisher: hostnameOf(top.url),
                evidenceExcerpt: null,
                agentCode: context.agentCode,
                researchRunId: context.runId,
                confidence: 0.35,
                verificationStatus: "unverified",
              }),
            );
            reclassificationFlags.push({
              prospectId: prospect.id,
              displayName: funder.name,
              crmTable: READ_ONLY_CRM_TABLES[0],
              crmRecordId: funder.id,
              reason: "external board/family-office/DAF signal found with no giving amount on file",
            });
          }
        }
      }
      } catch (err) {
        // Recovery protocol: a thrown error while processing one CRM record
        // must not discard the entire sweep -- log it and continue.
        await logAction({
          organization_id: context.orgId,
          actor_type: "agent",
          actor_id: context.agentCode,
          action: "discovery.crm_row_failed",
          resource_type: "pil_agent_runs",
          resource_id: context.runId,
          before_state: null,
          after_state: { crmTable: "funders" as const, crmRecordId: funder.id, message: err instanceof Error ? err.message : String(err) },
          policy_decision: null,
          ip_address: null,
        });
        continue;
      }
    }

    for (const contact of contacts) {
      try {
      const { prospect, created } = await findOrCreateCrmProspect(context.orgId, contact.name, "individual", context.agentCode);
      if (created) {
        newlyCreatedProspectIds.push(prospect.id);
      } else {
        entityResolutionCandidateProspectIds.push(prospect.id);
      }
      linkedProspectIds.push(prospect.id);

      const crmRecordNode = await upsertNode({
        organization_id: context.orgId,
        node_type: "contact",
        prospect_id: null,
        label: `${contact.name} (CRM contact record)`,
        properties: { crmTable: "contacts", crmRecordId: contact.id, title: contact.title },
      });
      const prospectNode = await upsertNode({
        organization_id: context.orgId,
        node_type: "person",
        prospect_id: prospect.id,
        label: prospect.display_name,
        properties: {},
      });
      await upsertEdge({
        organization_id: context.orgId,
        source_node_id: crmRecordNode.id,
        target_node_id: prospectNode.id,
        edge_type: "related_to",
        relationship_strength: "very_strong",
        confidence: 1,
        temporal_validity_start: null,
        temporal_validity_end: null,
        is_current: true,
        superseded_by_edge_id: null,
        properties: { relationship: "crm_record_of" },
      });

      // Reflect the CRM's own funder<->contact relationship in the graph.
      const funderProspectNode = funderProspectNodeByFunderId.get(contact.funder_id);
      if (funderProspectNode) {
        await upsertEdge({
          organization_id: context.orgId,
          source_node_id: funderProspectNode.id,
          target_node_id: prospectNode.id,
          edge_type: "has_contact",
          relationship_strength: "strong",
          confidence: 0.9,
          temporal_validity_start: null,
          temporal_validity_end: null,
          is_current: true,
          superseded_by_edge_id: null,
          properties: {},
        });
      }

      evidenceCreated.push(
        await recordDiscoveryEvidence({
          orgId: context.orgId,
          prospectId: prospect.id,
          claim: `Existing Benavora CRM contact record cross-referenced into the PIL graph: ${contact.name}`,
          value: { crmRecordId: contact.id, title: contact.title, relationship: contact.relationship },
          claimType: "crm_contact_record",
          sourceUrl: null,
          sourceTitle: contact.name,
          sourceType: "crm",
          publisher: "Benavora CRM",
          evidenceExcerpt: null,
          agentCode: context.agentCode,
          researchRunId: context.runId,
          confidence: 0.9,
          verificationStatus: "verified_fact",
        }),
      );

      // Material gap for a contact: cold/unengaged on file but an external
      // wealth/board signal exists.
      const isColdOrUnengaged = contact.relationship === "cold" || contact.relationship == null || !contact.last_contacted_at;
      if (isColdOrUnengaged) {
        const hiddenSearch = await callTool(context, runner, "web_search", {
          query: `"${contact.name}" ${contact.title ?? ""} ${HIDDEN_SIGNAL_QUERY_SUFFIX} OR company owner`.trim(),
          limit: 3,
        });
        if (hiddenSearch.success) {
          const results = ((hiddenSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
          const top = results[0];
          if (top) {
            evidenceCreated.push(
              await recordDiscoveryEvidence({
                orgId: context.orgId,
                prospectId: prospect.id,
                claim: `Hidden capacity/affiliation signal for CRM contact ${contact.name} (recorded as ${contact.relationship ?? "no relationship on file"}): ${top.title}`,
                value: { title: top.title, url: top.url },
                claimType: "hidden_capacity_signal_flag",
                sourceUrl: top.url,
                sourceTitle: top.title,
                sourceType: "open_web",
                publisher: hostnameOf(top.url),
                evidenceExcerpt: null,
                agentCode: context.agentCode,
                researchRunId: context.runId,
                confidence: 0.35,
                verificationStatus: "unverified",
              }),
            );
            reclassificationFlags.push({
              prospectId: prospect.id,
              displayName: contact.name,
              crmTable: READ_ONLY_CRM_TABLES[1],
              crmRecordId: contact.id,
              reason: "external board/family-office/DAF/ownership signal found on a cold or unengaged contact",
            });
          }
        }
      }
      } catch (err) {
        // Recovery protocol: a thrown error while processing one CRM record
        // must not discard the entire sweep -- log it and continue.
        await logAction({
          organization_id: context.orgId,
          actor_type: "agent",
          actor_id: context.agentCode,
          action: "discovery.crm_row_failed",
          resource_type: "pil_agent_runs",
          resource_id: context.runId,
          before_state: null,
          after_state: { crmTable: "contacts" as const, crmRecordId: contact.id, message: err instanceof Error ? err.message : String(err) },
          policy_decision: null,
          ip_address: null,
        });
        continue;
      }
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    // Dependencies (roster): this agent feeds BEN-SUP-05 (critic review of
    // reclassification flags), BEN-KNW-02 (entity-resolution confirmation
    // for CRM records that matched an already-existing prospect), and
    // BEN-KNW-03 (provenance review of this run's CRM-sourced evidence
    // batch). None of these delegations is a CRM mutation -- they are the
    // correct downstream gates before any human eventually acts.
    const delegations: DelegationRequest[] = [];
    if (reclassificationFlags.length > 0) {
      delegations.push({
        childAgentCode: "BEN-SUP-05",
        objective: `Critic review for BEN-DIS-08 hidden-prospect reclassification flags: ${reclassificationFlags.map((f) => f.prospectId).join(", ")}`,
        maxAutonomy: "A2" as const,
        constraints: { reclassificationFlags },
      });
    }
    if (entityResolutionCandidateProspectIds.length > 0) {
      delegations.push({
        childAgentCode: "BEN-KNW-02",
        objective: `Confirm entity-resolution match between existing pil_prospects and newly cross-referenced CRM records: ${entityResolutionCandidateProspectIds.join(", ")}`,
        maxAutonomy: "A2" as const,
        constraints: { candidateProspectIds: entityResolutionCandidateProspectIds },
      });
    }
    if (evidenceCreated.length > 0) {
      delegations.push({
        childAgentCode: "BEN-KNW-03",
        objective: `Provenance review for BEN-DIS-08 CRM-sourced evidence batch (org ${context.orgId})`,
        maxAutonomy: "A2" as const,
        constraints: { evidenceCount: evidenceCreated.length },
      });
    }

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        crmFundersScanned: funders.length,
        crmContactsScanned: contacts.length,
        linkedProspectIds,
        newlyCreatedProspectIds,
        // Reclassification flags only -- never a solicitation trigger
        // (spec's explicit human boundary for this agent).
        reclassificationFlags,
        entityResolutionCandidateProspectIds,
      },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }
}

export default HiddenProspectAndCrmRediscoveryAgent;
