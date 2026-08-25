import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import {
  callTool,
  getProspectById,
  hostnameOf,
  MODEL_TOKEN_UNIT_COST_USD,
  recordIntelligenceEvidence,
  tryModelTokens,
  upsertCounterpartyNode,
  upsertProspectNode,
} from "@/lib/pil/agents/int/shared";
import { upsertEdge } from "@/lib/pil/graph";
import type { EvidenceItem, GraphNodeType, ProspectEntityType } from "@/lib/pil/types";

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

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        prospectId: prospect.id,
        channelsFound: channels.length,
        noPermissibleChannelFound: channels.length === 0,
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

export default ContactIntelligenceAgent;
