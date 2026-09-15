import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { logAction } from "@/lib/pil/audit";
import {
  callTool,
  findExistingProspect,
  findOrCreateProspect,
  hostnameOf,
  MODEL_TOKEN_UNIT_COST_USD,
  normalizeName,
  parseGoalCriteria,
  recordDiscoveryEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/dis/shared";
import type { EvidenceItem } from "@/lib/pil/types";

// BEN-DIS-02 -- Major Donor Discovery Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 2 -- DISCOVERY"). Like
// BEN-DIS-01 but focused on high-capacity individual donors, and bound by
// the spec's explicit mission rule: "Wealth alone does not establish donor
// propensity." A wealth/capacity signal alone NEVER creates a new
// candidate here -- only a documented giving-behavior signal does; a
// wealth signal only ever augments a prospect that already has one (see
// `flagCapacitySignal` below). This is the agent's own
// "Replanning trigger": a wealth-only candidate with no giving signal is
// reclassified as lower priority, not flagged.
//
// Capacity is never asserted as a number here (spec §6, enforced fully by
// BEN-INT-08) -- this agent only flags candidates for that downstream deep
// research; `capacityThresholdCompensationUsd` below is the configurable
// officer-compensation floor used only to decide whether a 990-sourced
// compensation figure is *worth flagging as a capacity signal at all*, not
// a capacity determination itself.
//
// Output contract (MajorDonorCandidate.v2) requires wealth/capacity/
// propensity/etc to stay separately typed rather than conflated into one
// point-estimate confidence -- `confidenceInterval` below is a fixed,
// documented spread band per signal path, not a statistically fitted
// interval; a real calibration dataset would replace these bands.
//
// False-positive guard (spec: namesake/family/foundation-asset/corporate-
// gift/unpaid-pledge false positives are blocking defects at a stronger
// failure-severity bar than DIS-01's): a "major gift" news mention whose
// subject reads as an organization/foundation/company name is not a
// major-donor INDIVIDUAL candidate -- that belongs to BEN-DIS-04's
// corporate-giving discovery, not this agent, so it is excluded rather than
// flagged (see `looksLikeOrganizationName` below).

const DEFAULT_CAPACITY_THRESHOLD_COMPENSATION_USD = 150_000;
const DISCOVERY_ENTRYPOINT_FOR_DEEP_CAPACITY = "BEN-INT-08";
const CRITIC_REVIEW_AGENT = "BEN-SUP-05";
// p5.2b (2026-09-15): every sibling DIS agent bounds its delegation fan-out
// (e.g. BEN-DIS-05's MAX_DELEGATION_CANDIDATES) -- this agent didn't, and
// AgentRunner.delegate() runs children synchronously/inline, so a run that
// flagged many donors would block on N cascading child runs. Same cap value
// as BEN-DIS-05's own MAX_DELEGATION_CANDIDATES for consistency.
const MAX_DELEGATION_CANDIDATES = 5;

const ORGANIZATION_NAME_PATTERN = /\b(foundation|inc|incorporated|corp|corporation|llc|l\.l\.c\.|trust|fund)\b/i;

/** True when `name` reads as an organization/foundation/company rather than an individual -- see the false-positive guard above. */
function looksLikeOrganizationName(name: string): boolean {
  return ORGANIZATION_NAME_PATTERN.test(name);
}

interface FlaggedDonor {
  prospectId: string;
  displayName: string;
  confidence: number;
  confidenceInterval: [number, number];
  created: boolean;
}

export class MajorDonorDiscoveryAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (context.goal.trim().length === 0) {
      return {
        status: "completed",
        evidence: [],
        conclusions: { skipped: true, reason: "BEN-DIS-02 requires a non-empty goal" },
        delegations: [],
        tokensUsed: 0,
        costUsd: 0,
        error: null,
      };
    }

    const criteria = parseGoalCriteria(context.goal);
    const locationPhrase = [criteria.geography, criteria.cause].filter(Boolean).join(" ");
    const capacityThreshold =
      typeof (context.plan as { capacityThresholdCompensationUsd?: number } | null)?.capacityThresholdCompensationUsd === "number"
        ? (context.plan as { capacityThresholdCompensationUsd: number }).capacityThresholdCompensationUsd
        : DEFAULT_CAPACITY_THRESHOLD_COMPENSATION_USD;

    const flagged: FlaggedDonor[] = [];
    const evidenceCreated: EvidenceItem[] = [];
    const reclassifiedLowerPriority: string[] = [];
    const excludedOrganizationNames: string[] = [];

    // 1. Giving-behavior signal search: a documented major gift is
    // sufficient on its own to flag a candidate for deep capacity research.
    try {
      const givingResult = await callTool(context, runner, "news_search", {
        query: `major gift OR donation commitment ${locationPhrase}`.trim(),
        limit: 10,
      });
      if (givingResult.success) {
        const results = ((givingResult.data as { results?: Array<{ title: string; url: string; publishedAt: string | null; source: string }> } | null)?.results ?? []);
        for (const item of results) {
          if (looksLikeOrganizationName(item.title)) {
            excludedOrganizationNames.push(item.title);
            continue;
          }
          const { prospect, created } = await findOrCreateProspect({
            orgId: context.orgId,
            displayName: item.title,
            entityType: "individual",
            agentCode: context.agentCode,
          });
          const evidence = await recordDiscoveryEvidence({
            orgId: context.orgId,
            prospectId: prospect.id,
            claim: `Documented major gift mention: ${item.title}`,
            value: { title: item.title, url: item.url, publishedAt: item.publishedAt },
            claimType: "documented_major_gift",
            sourceUrl: item.url,
            sourceTitle: item.title,
            sourceType: "news",
            publisher: item.source || hostnameOf(item.url),
            evidenceExcerpt: null,
            agentCode: context.agentCode,
            researchRunId: context.runId,
            confidence: 0.5,
            verificationStatus: "single_source_fact",
          });
          evidenceCreated.push(evidence);
          flagged.push({
            prospectId: prospect.id,
            displayName: prospect.display_name,
            confidence: 0.5,
            confidenceInterval: [0.35, 0.65],
            created,
          });
        }
      }
    } catch (err) {
      await logAction({
        organization_id: context.orgId,
        actor_type: "agent",
        actor_id: context.agentCode,
        action: "discovery.source_failed",
        resource_type: "pil_agent_runs",
        resource_id: context.runId,
        before_state: null,
        after_state: { source: "news_search", message: err instanceof Error ? err.message : String(err) },
        policy_decision: null,
        ip_address: null,
      });
    }

    // 2. Wealth/capacity signal search -- corroborant only, never a
    // standalone flag. Only attaches to a prospect that already exists
    // (from the giving search above, or from prior runs); if no existing
    // prospect matches, the candidate is reclassified lower priority
    // rather than flagged, per the mission rule.
    try {
      const wealthResult = await callTool(context, runner, "web_search", {
        query: `wealthiest OR net worth OR business exit ${locationPhrase}`.trim(),
        limit: 10,
      });
      if (wealthResult.success) {
        const results = ((wealthResult.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
        for (const item of results) {
          const existing = await findExistingProspect(context.orgId, item.title);
          if (!existing) {
            reclassifiedLowerPriority.push(item.title);
            continue;
          }
          const evidence = await recordDiscoveryEvidence({
            orgId: context.orgId,
            prospectId: existing.id,
            claim: `Wealth/capacity signal corroborating an existing candidate: ${item.title}`,
            value: { title: item.title, url: item.url },
            claimType: "capacity_signal",
            sourceUrl: item.url,
            sourceTitle: item.title,
            sourceType: "open_web",
            publisher: hostnameOf(item.url),
            evidenceExcerpt: null,
            agentCode: context.agentCode,
            researchRunId: context.runId,
            confidence: 0.3,
            verificationStatus: "reasoned_inference",
          });
          evidenceCreated.push(evidence);
          if (!flagged.some((f) => f.prospectId === existing.id)) {
            flagged.push({
              prospectId: existing.id,
              displayName: existing.display_name,
              confidence: 0.55,
              confidenceInterval: [0.4, 0.7],
              created: false,
            });
          }
        }
      }
    } catch (err) {
      await logAction({
        organization_id: context.orgId,
        actor_type: "agent",
        actor_id: context.agentCode,
        action: "discovery.source_failed",
        resource_type: "pil_agent_runs",
        resource_id: context.runId,
        before_state: null,
        after_state: { source: "web_search", message: err instanceof Error ? err.message : String(err) },
        policy_decision: null,
        ip_address: null,
      });
    }

    // 3. IRS 990 data for known nonprofits in the cause area -- officer
    // compensation above the configurable threshold is an additional
    // capacity signal on an already-flagged candidate (never a
    // standalone flag, same rule as step 2).
    try {
      const foundationLookup = await callTool(context, runner, "entity_lookup", {
        name: criteria.cause ?? "foundation",
        type: "foundation",
        location: criteria.stateCode ?? undefined,
      });
      if (foundationLookup.success) {
        const matches = ((foundationLookup.data as { matches?: Array<{ source: string; ein: string | null; name: string }> } | null)?.matches ?? []).filter(
          (m) => m.source === "foundation_directory" && m.ein,
        );
        for (const match of matches.slice(0, 5)) {
          const nineNinety = await callTool(context, runner, "irs_990_lookup", { ein: match.ein });
          if (!nineNinety.success) continue;
          const officers = ((nineNinety.data as { officers?: Array<{ name: string | null; compensation: number | null }> } | null)?.officers ?? []);
          for (const officer of officers) {
            if (!officer.name || (officer.compensation ?? 0) < capacityThreshold) continue;
            const officerKey = normalizeName(officer.name);
            const flaggedMatch = flagged.find((f) => normalizeName(f.displayName) === officerKey);
            if (!flaggedMatch) continue;
            const evidence = await recordDiscoveryEvidence({
              orgId: context.orgId,
              prospectId: flaggedMatch.prospectId,
              claim: `High-compensation officer signal at ${match.name}: $${officer.compensation}`,
              value: { foundationName: match.name, ein: match.ein, compensation: officer.compensation },
              claimType: "high_compensation_officer_signal",
              sourceUrl: null,
              sourceTitle: match.name,
              sourceType: "irs_form_990",
              publisher: "IRS Form 990",
              evidenceExcerpt: null,
              agentCode: context.agentCode,
              researchRunId: context.runId,
              confidence: 0.4,
              verificationStatus: "reasoned_inference",
            });
            evidenceCreated.push(evidence);
            flaggedMatch.confidenceInterval = [0.3, 0.55];
          }
        }
      }
    } catch (err) {
      await logAction({
        organization_id: context.orgId,
        actor_type: "agent",
        actor_id: context.agentCode,
        action: "discovery.source_failed",
        resource_type: "pil_agent_runs",
        resource_id: context.runId,
        before_state: null,
        after_state: { source: "entity_lookup", message: err instanceof Error ? err.message : String(err) },
        policy_decision: null,
        ip_address: null,
      });
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    const delegationCandidates = flagged.slice(0, MAX_DELEGATION_CANDIDATES);
    const delegations: DelegationRequest[] = delegationCandidates.map((f) => ({
      childAgentCode: DISCOVERY_ENTRYPOINT_FOR_DEEP_CAPACITY,
      objective: `Assess wealth and philanthropic capacity for prospect ${f.prospectId} (${f.displayName})`,
      maxAutonomy: "A2" as const,
    }));

    if (flagged.length > 0) {
      delegations.push({
        childAgentCode: CRITIC_REVIEW_AGENT,
        objective: `Critic review for BEN-DIS-02 major-donor flags: ${flagged.map((f) => f.prospectId).join(", ")}`,
        maxAutonomy: "A2" as const,
        constraints: { flaggedProspectIds: flagged.map((f) => f.prospectId), capacityThreshold },
      });
    }

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        criteria,
        capacityThreshold,
        flaggedForDeepCapacityResearch: flagged.map((f) => f.prospectId),
        discoveries: flagged,
        reclassifiedLowerPriority,
        excludedOrganizationNames,
      },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }
}

export default MajorDonorDiscoveryAgent;
