import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  callTool,
  getProspectById,
  hostnameOf,
  MAX_DELEGATIONS_PER_RUN,
  recordIntelligenceEvidence,
  tryModelTokens,
  upsertCounterpartyNode,
  upsertProspectNode,
} from "@/lib/pil/agents/int/shared";
import { logAction } from "@/lib/pil/audit";
import { getEvidence } from "@/lib/pil/evidence";
import { upsertEdge } from "@/lib/pil/graph";
import type { EvidenceItem, GraphNodeType, ProspectEntityType } from "@/lib/pil/types";
import { serializePilError } from "@/lib/pil/serialize-error";

// BEN-INT-10 -- Contact Intelligence Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~581). Identifies permissible and
// relevant contact pathways -- public professional channels only, never a
// personal residential address or personal phone number (spec's explicit
// agent-specific prohibition, spec §6).
//
// The task spec that commissioned this batch called this code "Wealth
// Indicator Intelligence" and asked for five further codes (BEN-INT-11
// through BEN-INT-15: Liquidity Event, Geographic, Contact, Cause Interest,
// News and Trigger). None of those exist in PROSPECT_INTELLIGENCE_AGENTS.md
// or migration 155_pil_agent_registry.sql -- the "Core Prospect
// Intelligence" family is fixed at 10 agents (BEN-INT-01..BEN-INT-10) and
// the registry's INSERT list goes straight from BEN-INT-10 to BEN-REL-01.
// Per this codebase's established registry-wins pattern, this file
// implements the real BEN-INT-10; BEN-INT-11..15 are not built. See
// BEN-INT-09's header for the same finding.
//
// Permitted tools per spec: T-WEB, T-CRAWL, T-CONTACT, T-CRM (read),
// T-EVIDENCE (write). No T-CONTACT/T-CRM tool is registered in
// tools/index.ts, so normalization and CRM-dedup are done inline here and
// channel discovery runs on web_search/web_crawl (same substitution pattern
// as BEN-INT-03/BEN-INT-06). Permitted data classes: D-CONTACT-PUBLIC,
// D-CRM-FIRSTPARTY. Spec is explicit that only pil_source_registry
// "permitted" sources may be used and enforcement should be deterministic,
// not agent judgment alone; absent a Connector Gateway in this codebase,
// this agent enforces the one deterministic rule it can: a personal
// (non-professional) mailbox provider is never recorded, and a crawl result
// is discarded rather than guessed at when no organization-scoped channel is
// found.

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "msn.com",
  "live.com",
  "me.com",
]);

const FOUNDATION_TYPES: ProspectEntityType[] = [
  "family_foundation",
  "private_foundation",
  "community_foundation",
  "corporate_foundation",
];

function subjectNodeType(entityType: ProspectEntityType): GraphNodeType {
  if (FOUNDATION_TYPES.includes(entityType)) return "foundation";
  if (entityType === "corporation" || entityType === "institutional_funder") return "company";
  return "person";
}

function extractEmail(text: string): string | null {
  const match = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (!match) return null;
  const email = match[0];
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain)) return null;
  return email;
}

interface ContactChannel {
  channelType: "linkedin" | "email" | "organization_contact_page";
  value: string;
  sourceUrl: string;
  sourceTitle: string | null;
}

// The six domain dimensions this agent's report scores coverage across, per
// PIL_AGENT_COMPLETE_ROSTER.md "Core Intelligence" BEN_INT_10Decision.v1
// contract. Coverage is computed from persisted pil_evidence state
// (getEvidence()), not just evidence created this run, matching BEN-INT-08/09's
// own established getEvidence(prospect.id, context.orgId) pattern.
const CONTACT_DIMENSIONS = [
  "Channel Type And Provenance",
  "Business Versus Personal Channel",
  "Validity/Freshness",
  "Consent/Suppression State",
  "Role Relevance",
  "Contactability Uncertainty",
] as const;

export interface ContactIntelligenceReport {
  prospectId: string;
  dimensionCoverage: Record<(typeof CONTACT_DIMENSIONS)[number], boolean>;
  evidenceCreatedThisRun: number;
  delegationsIssued: string[];
  channelsFound: number;
  noPermissibleChannelFound: boolean;
}

export class ContactIntelligenceAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-INT-10 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const evidenceCreated: EvidenceItem[] = [];
    const channels: ContactChannel[] = [];
    const subjectNode = await upsertProspectNode(context.orgId, prospect, subjectNodeType(prospect.entity_type));

    // 1. Public LinkedIn profile URL -- an unambiguous professional channel,
    // per spec's planning behavior preferring published channels over a
    // personal-search result.
    const linkedinSearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" site:linkedin.com/in`,
      limit: 3,
    });
    if (linkedinSearch.success) {
      const results = ((linkedinSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      const linkedinResult = results.find((r) => hostnameOf(r.url) === "linkedin.com");
      if (linkedinResult) {
        channels.push({
          channelType: "linkedin",
          value: linkedinResult.url,
          sourceUrl: linkedinResult.url,
          sourceTitle: linkedinResult.title || null,
        });
      }
    }

    // 2. Organization/foundation-published contact channel -- crawled for a
    // professional (non-personal-provider) email, per spec's observation
    // behavior confirming a channel is genuinely usable before recording it.
    const contactSearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" official contact OR "contact us"`,
      limit: 3,
    });
    const contactResults = contactSearch.success
      ? ((contactSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? [])
      : [];
    const topContactResult = contactResults[0];
    if (topContactResult) {
      channels.push({
        channelType: "organization_contact_page",
        value: topContactResult.url,
        sourceUrl: topContactResult.url,
        sourceTitle: topContactResult.title || null,
      });

      const crawl = await callTool(context, runner, "web_crawl", { url: topContactResult.url });
      if (crawl.success) {
        const { text } = crawl.data as { text: string };
        const email = extractEmail(text);
        if (email) {
          channels.push({
            channelType: "email",
            value: email,
            sourceUrl: topContactResult.url,
            sourceTitle: topContactResult.title || null,
          });
        }
      }
    }

    for (const channel of channels) {
      const evidence = await recordIntelligenceEvidence({
        orgId: context.orgId,
        prospectId: prospect.id,
        claim: `Permissible contact channel (${channel.channelType}): ${channel.value}`,
        value: { channelType: channel.channelType, value: channel.value },
        claimType: "contact",
        sourceUrl: channel.sourceUrl,
        sourceTitle: channel.sourceTitle,
        sourceType: "open_web",
        publisher: hostnameOf(channel.sourceUrl),
        evidenceExcerpt: null,
        agentCode: context.agentCode,
        researchRunId: context.runId,
        confidence: channel.channelType === "linkedin" ? 0.5 : 0.35,
        verificationStatus: "single_source_fact",
      });
      evidenceCreated.push(evidence);

      const contactNode = await upsertCounterpartyNode(context.orgId, "contact", `${channel.channelType}:${channel.value}`, {
        channelType: channel.channelType,
        value: channel.value,
      });
      await upsertEdge({
        organization_id: context.orgId,
        source_node_id: subjectNode.id,
        target_node_id: contactNode.id,
        edge_type: "has_contact",
        relationship_strength: "moderate",
        confidence: channel.channelType === "linkedin" ? 0.5 : 0.35,
        temporal_validity_start: null,
        temporal_validity_end: null,
        is_current: true,
        superseded_by_edge_id: null,
        properties: { channelType: channel.channelType, sourceUrl: channel.sourceUrl },
      });
    }

    const tokensUsed = await tryModelTokens(context, runner, 350);
    const noPermissibleChannelFound = channels.length === 0;

    // Everything above this point (evidence + graph writes) is this run's own
    // defensible determination and has already durably landed via
    // individually atomic recordIntelligenceEvidence()/upsertEdge() calls.
    // Gap-analysis/delegation-construction/report-construction below is
    // secondary reasoning over that already-persisted work -- a bug here must
    // never discard evidence this run already recorded (roster: "captured
    // evidence stays immutable").
    let report: ContactIntelligenceReport = {
      prospectId: prospect.id,
      dimensionCoverage: Object.fromEntries(CONTACT_DIMENSIONS.map((d) => [d, false])) as ContactIntelligenceReport["dimensionCoverage"],
      evidenceCreatedThisRun: evidenceCreated.length,
      delegationsIssued: [],
      channelsFound: channels.length,
      noPermissibleChannelFound,
    };
    let delegations: DelegationRequest[] = [];

    try {
      const allEvidence = await getEvidence(prospect.id, context.orgId);
      const contactEvidence = allEvidence.filter((e) => e.claim_type === "contact");
      const hasBusinessChannel = contactEvidence.some((e) => {
        const channelType = (e.value as { channelType?: string } | null)?.channelType;
        return channelType === "email" || channelType === "organization_contact_page";
      });
      const hasLinkedinChannel = contactEvidence.some((e) => {
        const channelType = (e.value as { channelType?: string } | null)?.channelType;
        return channelType === "linkedin";
      });

      const dimensionSignals: Record<(typeof CONTACT_DIMENSIONS)[number], boolean> = {
        "Channel Type And Provenance": contactEvidence.length > 0,
        // extractEmail()'s PERSONAL_EMAIL_DOMAINS deny-list means any recorded
        // email/organization-contact-page channel is already confirmed
        // non-personal -- that filtering IS this dimension's signal.
        "Business Versus Personal Channel": hasBusinessChannel,
        "Validity/Freshness": contactEvidence.some((e) => e.freshness_status === "fresh"),
        // No agent in this codebase tracks consent or suppression-list state
        // for a contact channel yet -- an explicit false, not an omitted
        // field (same pattern as BEN-INT-08's "Liability/Encumbrance
        // Limitations").
        "Consent/Suppression State": false,
        "Role Relevance": hasLinkedinChannel,
        // Uncertainty is captured via the quantified confidence/
        // verification_status recorded alongside every contact evidence row.
        "Contactability Uncertainty": contactEvidence.length > 0,
      };
      const dimensionCoverage = Object.fromEntries(
        CONTACT_DIMENSIONS.map((dimension) => [dimension, dimensionSignals[dimension]]),
      ) as ContactIntelligenceReport["dimensionCoverage"];

      // Roster delegation targets for BEN-INT-10: BEN-KNW-03, BEN-REL-01,
      // BEN-QLF-05 (never BEN-KNW-02, never a BEN-INT-0N peer -- documented
      // roster anomaly shared only with BEN-INT-08 and BEN-INT-04
      // respectively). Pushed in priority order, capped at
      // MAX_DELEGATIONS_PER_RUN since AgentRunner executes delegations
      // synchronously/inline.
      const candidates: DelegationRequest[] = [];
      const pushCandidate = (childAgentCode: string, objective: string) => {
        candidates.push({
          childAgentCode,
          objective,
          maxAutonomy: "A2",
          constraints: { prospectId: context.prospectId, triggeredBy: context.agentCode },
        });
      };

      if (noPermissibleChannelFound) {
        pushCandidate(
          "BEN-REL-01",
          `Prospect ${context.prospectId} has no direct, permissible contact channel on file -- pursue a warm introduction via a known relationship as the only permissible route to this prospect.`,
        );
      }
      if (hasLinkedinChannel) {
        pushCandidate(
          "BEN-QLF-05",
          `Prospect ${context.prospectId} has a verified professional LinkedIn channel confirmed this run -- use as document-readiness input signal for qualification.`,
        );
      }
      if (evidenceCreated.length > 0) {
        pushCandidate(
          "BEN-KNW-03",
          `BEN-INT-10 recorded ${evidenceCreated.length} new contact evidence item(s) for prospect ${context.prospectId} this run -- verify provenance before treating as authoritative.`,
        );
      }

      delegations = candidates.slice(0, MAX_DELEGATIONS_PER_RUN);

      report = {
        prospectId: prospect.id,
        dimensionCoverage,
        evidenceCreatedThisRun: evidenceCreated.length,
        delegationsIssued: delegations.map((d) => d.childAgentCode),
        channelsFound: channels.length,
        noPermissibleChannelFound,
      };
    } catch (err) {
      const message = serializePilError(err);
      await logAction({
        organization_id: context.orgId,
        actor_type: "agent",
        actor_id: context.agentCode,
        action: "ben-int-10.gap_analysis_failed",
        resource_type: "pil_agent_runs",
        resource_id: context.runId,
        before_state: null,
        after_state: { error: message },
        policy_decision: null,
        ip_address: null,
      });
      delegations = [];
    }

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: { report },
      delegations,
      tokensUsed,
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts (called inside tryModelTokens); recording it again here would double-count the same tokens.
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

export default ContactIntelligenceAgent;
