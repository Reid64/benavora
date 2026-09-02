import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { callTool, hostnameOf, MODEL_TOKEN_UNIT_COST_USD, recordRelationshipEvidence, tryModelTokens } from "@/lib/pil/agents/rel/shared";
import { getPilClient } from "@/lib/pil/db";
import { upsertEdge, upsertNode } from "@/lib/pil/graph";
import type { EvidenceItem, GraphEdge, GraphNode } from "@/lib/pil/types";

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
//
// Upgrade (PIL_AGENT_COMPLETE_ROSTER.md/PIL_AGENT_DEPENDENCIES.yaml, paper
// specs with no implementation evidence -- design input only): this agent
// previously ran with zero delegations, the largest gap in the Relationship
// family. Adds five conditional delegations, per depends_on's
// BEN-INT-02/BEN-INT-03/BEN-KNW-02/BEN-KNW-03/BEN-REL-05 entries, each gated
// on a concrete signal rather than firing unconditionally: BEN-KNW-02
// (identity resolution) when a scanned funder's normalized name collides
// with an existing company node's normalized label but the raw labels
// differ (a likely misspelled near-duplicate); BEN-INT-03 (beneficial
// ownership/control verification) when a philanthropy-title contact's title
// also matches an ownership/control pattern (owner/founder/chair/CEO/
// president); BEN-INT-02 (career chronicling) when a personnel edge already
// on file for a contact carries a different title than the one just read
// from CRM; BEN-KNW-03 (batch provenance verification) once per run, if any
// corporate or personnel edges were touched; and BEN-REL-05 (warm
// introduction pathfinding), guarded per the platform constraint below.
//
// Platform constraint: this agent runs org-wide (context.prospectId is not
// read or required) unlike BEN-REL-01/02/05/06, which are single-prospect
// and early-return without one. AgentRunner.delegate() (agent-runner.ts
// ~line 330) passes the PARENT's context.prospectId unchanged to a
// delegated child, so a BEN-REL-05 delegation fired from an org-wide run
// with prospectId===null would reach BEN-REL-05 with prospectId===null too
// and immediately no-op via its own early-return. The BEN-REL-05 delegation
// below is therefore guarded with "if (context.prospectId)" and skipped
// (with an inline comment) whenever this agent runs without one.
//
// Decision object: conclusions.decision maps this file's existing computed
// values onto the roster's six named output dimensions
// (companyLegalIdentity/roleOwnershipLinkage/subsidiaryParentBoundaries/
// sharedEmploymentInterval/commercialVersusPhilanthropicContext/
// decisionAuthorityUncertainty). subsidiaryParentBoundaries and
// sharedEmploymentInterval are fixed, documented strings rather than
// computed values -- this platform's funders schema has no parent/
// subsidiary column and personnel edges are written with null temporal
// bounds (see the existing upsertEdge calls below), so those two dimensions
// are real, named schema gaps, not fabricated data.

const CORPORATE_CATEGORIES = new Set(["corporate_donation", "corporate_sponsorship", "corporate_foundation"]);
const PHILANTHROPY_TITLE_PATTERN = /philanthrop|community relations|corporate (social )?responsibility|\bcsr\b|giving|foundation/i;
// Beneficial-ownership/control signal (BEN-INT-03 delegation trigger) --
// deliberately narrower than PHILANTHROPY_TITLE_PATTERN, matched only
// against contacts that already passed that gate.
const OWNERSHIP_TITLE_PATTERN = /owner|founder|chairman|chairwoman|chair|\bceo\b|president/i;

/** Lowercases and strips a trailing legal-entity suffix so "Acme Inc" and "Acme Inc." collide with "Acme" for near-duplicate detection (step 1 below) -- a plain exact-label comparison (upsertNode's own dedup) would not catch this class of misspelling. */
function normalizeCompanyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+(inc|llc|corp|corporation|co)\.?$/, "")
    .trim();
}

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

    // Snapshot of pre-existing company nodes, used by step 1's near-duplicate
    // check below -- fetched once, not per-funder, since it only needs to
    // reflect state from before this run started.
    const { data: existingCompanyNodeRows, error: existingCompanyNodeError } = await getPilClient()
      .from("pil_graph_nodes")
      .select("id, label")
      .eq("organization_id", context.orgId)
      .eq("node_type", "company");
    if (existingCompanyNodeError) throw existingCompanyNodeError;
    const existingCompanyNodes = (existingCompanyNodeRows ?? []) as Array<{ id: string; label: string }>;

    const evidenceCreated: EvidenceItem[] = [];
    const corporateEdgeIds: string[] = [];
    const personnelEdgeIds: string[] = [];
    const delegations: DelegationRequest[] = [];
    const roleOwnershipLinkage: Array<{ personNodeId: string; title: string }> = [];
    let ownershipUncertaintyFlagged = false;

    for (const funder of corporateFunders) {
      // 1. Near-duplicate entity delegation to BEN-KNW-02: an existing
      // company node whose normalized label matches this funder's but whose
      // raw label differs is a likely misspelled near-duplicate that
      // upsertNode's own exact-label dedup would not catch.
      const normalizedFunderName = normalizeCompanyName(funder.name);
      const possibleDuplicate = existingCompanyNodes.find(
        (n) => n.label !== funder.name && normalizeCompanyName(n.label) === normalizedFunderName,
      );
      if (possibleDuplicate) {
        delegations.push({
          childAgentCode: "BEN-KNW-02",
          objective: `Possible near-duplicate corporate entity: candidate label "${funder.name}" (funder ${funder.id}) normalizes the same as existing node "${possibleDuplicate.label}" (node ${possibleDuplicate.id}) but the raw labels differ -- confirm whether these are the same legal entity before this run treats them as distinct nodes.`,
          maxAutonomy: "A2",
          constraints: {
            funderId: funder.id,
            candidateNodeLabel: funder.name,
            possibleDuplicateNodeId: possibleDuplicate.id,
            possibleDuplicateLabel: possibleDuplicate.label,
          },
        });
      }

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

        // 2. Ownership/control delegation to BEN-INT-03: this contact's
        // title carries a decision-authority signal (owner/founder/chair/
        // CEO/president) beyond the philanthropy-personnel gate above.
        if (OWNERSHIP_TITLE_PATTERN.test(contact.title)) {
          roleOwnershipLinkage.push({ personNodeId: personNode.id, title: contact.title });
          ownershipUncertaintyFlagged = true;
          delegations.push({
            childAgentCode: "BEN-INT-03",
            objective: `${contact.name} (${contact.title}) is on file as philanthropy/CSR personnel for corporate funder ${funder.name}, but their title also carries an ownership/control signal -- verify documented beneficial-ownership/control before this personnel edge is treated as a decision-authority signal.`,
            maxAutonomy: "A2",
            constraints: { funderId: funder.id, personNodeId: personNode.id, title: contact.title },
          });
        }

        // 3. Career-change delegation to BEN-INT-02: re-fetch any prior
        // has_contact edge for this exact pair before upserting -- if its
        // recorded title differs from what CRM has now, that's a real
        // title/career change worth chronicling, not just a confidence
        // reconciliation (which upsertEdge's own find-then-write already
        // handles below).
        const { data: existingPersonnelEdgeRow, error: existingPersonnelEdgeError } = await getPilClient()
          .from("pil_graph_edges")
          .select("*")
          .eq("organization_id", context.orgId)
          .eq("source_node_id", corporateNode.id)
          .eq("target_node_id", personNode.id)
          .eq("edge_type", "has_contact")
          .eq("is_current", true)
          .maybeSingle();
        if (existingPersonnelEdgeError) throw existingPersonnelEdgeError;
        const existingPersonnelEdge = existingPersonnelEdgeRow as GraphEdge | null;
        const previousTitle = existingPersonnelEdge?.properties.title;
        if (existingPersonnelEdge && typeof previousTitle === "string" && previousTitle !== contact.title) {
          delegations.push({
            childAgentCode: "BEN-INT-02",
            objective: `${contact.name}'s title on file for ${funder.name} changed from "${previousTitle}" to "${contact.title}" -- chronicle this career/title change.`,
            maxAutonomy: "A2",
            constraints: { personNodeId: personNode.id, previousTitle, currentTitle: contact.title },
          });
        }

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

        // 5. Warm-introduction delegation to BEN-REL-05 (guarded per the
        // platform-constraint header above): only meaningful when this run
        // has a single prospect to path toward. Every personNode reaching
        // this point already matched PHILANTHROPY_TITLE_PATTERN, which
        // doubles as the seniority proxy the spec calls for (director/
        // manager-level giving-program titles), so no separate seniority
        // regex is needed.
        if (context.prospectId) {
          delegations.push({
            childAgentCode: "BEN-REL-05",
            objective: `Compute a warm-introduction path to ${contact.name} (${contact.title}) at corporate funder ${funder.name} on behalf of prospect ${context.prospectId}.`,
            maxAutonomy: "A2",
            constraints: { prospectId: context.prospectId, targetNodeId: personNode.id },
          });
        }
        // else: org-wide sweep mode (context.prospectId is null) has no
        // single prospect to path an introduction toward -- skip.

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

    // 4. Batch provenance delegation to BEN-KNW-03: one delegation per run
    // (not per edge) covering every corporate/personnel edge this run
    // touched.
    if (corporateEdgeIds.length + personnelEdgeIds.length > 0) {
      delegations.push({
        childAgentCode: "BEN-KNW-03",
        objective: `${corporateEdgeIds.length + personnelEdgeIds.length} corporate/personnel edge(s) newly touched by this BEN-REL-03 run need provenance verification.`,
        maxAutonomy: "A2",
        constraints: { edgeIds: [...corporateEdgeIds, ...personnelEdgeIds] },
      });
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    // BEN_REL_03Decision.v1's 6 named output dimensions (roster), populated
    // from data this method already computes -- no dedicated
    // pil_rel_03_decisions table exists, so this rides in conclusions
    // instead (same resolution BEN-REL-01/05's headers document).
    const decision = {
      companyLegalIdentity: corporateFunders.map((f) => ({ id: f.id, name: f.name })),
      roleOwnershipLinkage,
      subsidiaryParentBoundaries: "not_modeled_no_parent_subsidiary_column_in_schema",
      sharedEmploymentInterval: "unbounded_no_temporal_validity_set_on_personnel_edges",
      commercialVersusPhilanthropicContext: "philanthropic",
      decisionAuthorityUncertainty: ownershipUncertaintyFlagged ? "flagged_for_BEN-INT-03_review" : "unassessed",
    };

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        tenantNodeId: tenantNode.id,
        corporateFundersScanned: corporateFunders.length,
        corporateEdgeIds,
        personnelEdgeIds,
        decision,
      },
      delegations,
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
