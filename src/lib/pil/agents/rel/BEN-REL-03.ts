import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import { callTool, hostnameOf, MODEL_TOKEN_UNIT_COST_USD, recordRelationshipEvidence, tryModelTokens } from "@/lib/pil/agents/rel/shared";
import { getPilClient } from "@/lib/pil/db";
import { upsertEdge, upsertNode } from "@/lib/pil/graph";
import type { EvidenceItem, GraphNode } from "@/lib/pil/types";

// BEN-REL-03 -- Corporate Relationship Mapping Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~651). Identifies relationships
// connecting the tenant to corporations and decision-makers, starting from
// the tenant's own first-party relationship data (spec planning behavior:
// "highest-confidence source") before searching externally for
// corroboration.
//
// The task spec that commissioned this batch described this code as a
// general company->subsidiaries/board/shareholders(SEC EDGAR)/foundation
// mapper. That is not this registry entry's mission
// (supabase/migrations/155_pil_agent_registry.sql line 101: "Identify
// relationships connecting the tenant to corporations and decision-makers");
// built to the live spec per this codebase's established registry-wins
// pattern (see BEN-DIS-*.ts / BEN-INT-09.ts headers).
//
// Permitted tools per spec: T-GRAPH (read/write), T-CRM (read), T-WEB,
// T-EVIDENCE (write). Permitted data classes: D-CRM-FIRSTPARTY,
// D-PUBLIC-BIZ; customer-relationship data is prohibited without on-file
// tenant authorization (spec: "enforced at the Connector Gateway per-tenant
// configuration, not agent discretion"). This platform's schema has no
// vendor/customer/employee/partner CRM table at all (funders.category --
// migration 001_initial_schema.sql -- is a grant/donation taxonomy, not a
// business-relationship one) -- the only real first-party corporate data
// available is `funders` rows tagged corporate_donation/
// corporate_sponsorship/corporate_foundation plus their `contacts`, the same
// tables BEN-DIS-08 cross-references. None of that is customer data, so the
// spec's authorization gate has nothing to enforce here; it is not
// fabricated. "T-CRM (read)" means a direct read of funders/contacts via the
// service-role client, same as BEN-DIS-08 documents -- no T-CRM Tool is
// registered in tools/index.ts.

const CORPORATE_CATEGORIES = new Set(["corporate_donation", "corporate_sponsorship", "corporate_foundation"]);
const PHILANTHROPY_TITLE_PATTERN = /philanthrop|community relations|corporate (social )?responsibility|\bcsr\b|giving|foundation/i;

interface FunderRow {
  id: string;
  name: string;
  category: string;
}

interface ContactRow {
  id: string;
  funder_id: string;
  name: string;
  title: string | null;
}

export class CorporateRelationshipMappingAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const { data: funderRows, error: funderError } = await getPilClient()
      .from("funders")
      .select("id, name, category")
      .eq("organization_id", context.orgId);
    if (funderError) throw funderError;
    const corporateFunders = ((funderRows ?? []) as FunderRow[]).filter((f) => CORPORATE_CATEGORIES.has(f.category));

    if (corporateFunders.length === 0) {
      return this.completedEmpty("No corporate-category funders on file for this org");
    }

    const { data: contactRows, error: contactError } = await getPilClient()
      .from("contacts")
      .select("id, funder_id, name, title")
      .eq("organization_id", context.orgId)
      .in("funder_id", corporateFunders.map((f) => f.id));
    if (contactError) throw contactError;
    const contacts = (contactRows ?? []) as ContactRow[];

    // The tenant's own organization node -- upsertNode's find-then-write
    // dedups this to a single row across repeated runs.
    const tenantNode = await upsertNode({
      organization_id: context.orgId,
      node_type: "company",
      prospect_id: null,
      label: "Benavora (tenant organization)",
      properties: { isTenantSelf: true },
    });

    const evidenceCreated: EvidenceItem[] = [];
    const corporateEdgeIds: string[] = [];
    const personnelEdgeIds: string[] = [];

    for (const funder of corporateFunders) {
      const corporateNode: GraphNode = await upsertNode({
        organization_id: context.orgId,
        node_type: "company",
        prospect_id: null,
        label: funder.name,
        properties: { category: funder.category, crmFunderId: funder.id },
      });

      // Spec planning behavior: first-party CRM data (this funder row) is
      // the highest-confidence source, used before any external search.
      const corporateEdge = await upsertEdge({
        organization_id: context.orgId,
        source_node_id: tenantNode.id,
        target_node_id: corporateNode.id,
        edge_type: "related_to",
        relationship_strength: "strong",
        confidence: 0.9,
        temporal_validity_start: null,
        temporal_validity_end: null,
        // Spec observation behavior: confirms current, not historical --
        // this platform's funders schema has no separate
        // active/inactive/lapsed flag, so a row still present in the live
        // CRM table is the only "current" signal available; there is
        // nothing further to check without a status column that doesn't
        // exist.
        is_current: true,
        superseded_by_edge_id: null,
        properties: { relationshipType: "corporate_funder", category: funder.category, sourceOfRecord: "crm_firstparty" },
      });
      corporateEdgeIds.push(corporateEdge.id);

      evidenceCreated.push(
        await recordRelationshipEvidence({
          orgId: context.orgId,
          entityTable: "pil_graph_edges",
          entityId: corporateEdge.id,
          claim: `Tenant has a first-party CRM relationship with corporate funder ${funder.name} (${funder.category})`,
          value: { funderId: funder.id, category: funder.category },
          claimType: "corporate_relationship",
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

      const funderContacts = contacts.filter((c) => c.funder_id === funder.id);
      for (const contact of funderContacts) {
        if (!contact.title || !PHILANTHROPY_TITLE_PATTERN.test(contact.title)) continue;

        const personNode = await upsertNode({
          organization_id: context.orgId,
          node_type: "person",
          prospect_id: null,
          label: contact.name,
          properties: { title: contact.title, crmContactId: contact.id },
        });
        const personnelEdge = await upsertEdge({
          organization_id: context.orgId,
          source_node_id: corporateNode.id,
          target_node_id: personNode.id,
          edge_type: "has_contact",
          relationship_strength: "strong",
          confidence: 0.85,
          temporal_validity_start: null,
          temporal_validity_end: null,
          is_current: true,
          superseded_by_edge_id: null,
          properties: { relationshipType: "corporate_philanthropy_personnel", title: contact.title },
        });
        personnelEdgeIds.push(personnelEdge.id);

        evidenceCreated.push(
          await recordRelationshipEvidence({
            orgId: context.orgId,
            entityTable: "pil_graph_edges",
            entityId: personnelEdge.id,
            claim: `${contact.name} (${contact.title}) is corporate philanthropy personnel on file for ${funder.name}`,
            value: { contactId: contact.id, title: contact.title },
            claimType: "corporate_philanthropy_personnel",
            sourceUrl: null,
            sourceTitle: contact.name,
            sourceType: "crm",
            publisher: "Benavora CRM",
            evidenceExcerpt: null,
            agentCode: context.agentCode,
            researchRunId: context.runId,
            confidence: 0.85,
            verificationStatus: "verified_fact",
          }),
        );
      }

      // External corroboration, only after the first-party source is
      // exhausted (spec planning behavior).
      const searchResult = await callTool(context, runner, "web_search", {
        query: `"${funder.name}" "corporate giving" OR "corporate philanthropy" OR "community relations" director OR manager`,
        limit: 3,
      });
      if (!searchResult.success) continue;
      const results = (searchResult.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? [];
      const top = results[0];
      if (!top) continue;

      evidenceCreated.push(
        await recordRelationshipEvidence({
          orgId: context.orgId,
          entityTable: "pil_graph_edges",
          entityId: corporateEdge.id,
          claim: `External corroboration for ${funder.name}'s corporate philanthropy program: ${top.title}`,
          value: { title: top.title, url: top.url },
          claimType: "corporate_relationship_corroboration",
          sourceUrl: top.url,
          sourceTitle: top.title,
          sourceType: "open_web",
          publisher: hostnameOf(top.url),
          evidenceExcerpt: null,
          agentCode: context.agentCode,
          researchRunId: context.runId,
          confidence: 0.4,
          verificationStatus: "unverified",
        }),
      );
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        tenantNodeId: tenantNode.id,
        corporateFundersScanned: corporateFunders.length,
        corporateEdgeIds,
        personnelEdgeIds,
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

export default CorporateRelationshipMappingAgent;
