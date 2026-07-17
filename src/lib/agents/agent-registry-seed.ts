// Static seed data for the `agent_registry` table (migration 094, Pillar 17 -
// Agent Marketplace, AGENTS_v2.md). Used by a one-time/idempotent seed step
// and by the registry API route as a fallback label source. Not a substitute
// for the DB table: `agent_configurations.enabled` per-org state always comes
// from the database, never from this array.

export type AgentPlanRequirement = "starter" | "professional" | "enterprise";
export type AgentTriggerType = "scheduled" | "event" | "manual";

export interface AgentRegistrySeed {
  agent_id: string;
  name: string;
  description: string;
  plan_requirement: AgentPlanRequirement;
  trigger_type: AgentTriggerType;
  schedule_cron?: string;
}

export const AGENT_REGISTRY_SEED: AgentRegistrySeed[] = [
  {
    agent_id: "ag-01",
    name: "Grant Research Agent",
    description:
      "Discovers new grant opportunities from federal and foundation sources. Runs nightly and delivers personalized matches each morning.",
    plan_requirement: "starter",
    trigger_type: "scheduled",
    schedule_cron: "0 8 * * *",
  },
  {
    agent_id: "ag-02",
    name: "Eligibility Scoring Agent",
    description:
      "Scores every opportunity 0-100 for fit with your organization. Considers mission, geography, budget, and track record.",
    plan_requirement: "starter",
    trigger_type: "event",
  },
  {
    agent_id: "ag-05",
    name: "Draft Generator Agent",
    description:
      "Generates complete grant narrative drafts using your Knowledge Base data. Never fabricates information.",
    plan_requirement: "starter",
    trigger_type: "manual",
  },
  {
    agent_id: "ag-13",
    name: "Impact Measurement Agent",
    description:
      "Tracks and reports outcome metrics. Identifies success patterns from awarded grants.",
    plan_requirement: "starter",
    trigger_type: "manual",
  },
  {
    agent_id: "ag-15",
    name: "Grant Probability Agent",
    description:
      "Scores every opportunity with an 11-factor success probability model. Ranks your pipeline by likelihood of winning.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: "0 3 * * *",
  },
  {
    agent_id: "ag-16",
    name: "Digital Twin Builder",
    description:
      "Builds and maintains an AI model of your organization. Enables deeper personalization across all features.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: "0 2 1 * *",
  },
  {
    agent_id: "ag-17",
    name: "Opportunity Discovery Agent",
    description:
      "Wakes up every morning and finds new opportunities matching your mission. You rarely need to search.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: "0 8 * * *",
  },
  {
    agent_id: "ag-18",
    name: "Reputation Intelligence Agent",
    description:
      "Monitors all your funders for legal issues, leadership changes, and financial distress. Warns you before you waste time on problematic relationships.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: "0 4 * * *",
  },
  {
    agent_id: "ag-19",
    name: "Relationship Builder Agent",
    description:
      "Monitors funder signals and tells you exactly when and how to engage. Behaves like a full-time development director.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: "0 5 * * *",
  },
  {
    agent_id: "ag-22",
    name: "Corporate Propensity Agent",
    description:
      "Scores every corporate prospect across 10 donation probability dimensions. Ranks companies by likelihood to donate cash, in-kind, volunteers, and equipment.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: "0 3 * * *",
  },
  {
    agent_id: "ag-24",
    name: "Personalized Outreach Agent",
    description:
      "Generates AI-individualized emails for corporate prospects. Every message references specific known facts about the company.",
    plan_requirement: "professional",
    trigger_type: "manual",
  },
  {
    agent_id: "ag-25",
    name: "Disaster Response Agent",
    description:
      "Monitors FEMA declarations and deploys coordinated response within hours. Surfaces emergency funding and corporate donors automatically.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: "0 */6 * * *",
  },
  {
    agent_id: "ag-26",
    name: "Funding Forecast Agent",
    description:
      "Generates 90-day and 12-month funding forecasts using probability-weighted pipeline data and market trends.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: "0 6 1 * *",
  },
  {
    agent_id: "ag-27",
    name: "Board Meeting Packet Agent",
    description:
      "Generates complete board meeting packets 48 hours before every meeting. Plain language financial summaries and strategic recommendations.",
    plan_requirement: "professional",
    trigger_type: "event",
  },
  {
    agent_id: "ag-28",
    name: "Impact Simulation Agent",
    description:
      "Models what-if scenarios before decisions are made. Shows financial, capacity, and beneficiary impact of any strategic choice.",
    plan_requirement: "enterprise",
    trigger_type: "manual",
  },
  {
    agent_id: "ag-23",
    name: "Relationship Mapper Agent",
    description:
      "Discovers connections between businesses, foundations, board members, and nonprofits. Builds the Philanthropic Intelligence Graph.",
    plan_requirement: "enterprise",
    trigger_type: "scheduled",
    schedule_cron: "0 5 * * 0",
  },
];
