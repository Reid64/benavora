// Prospect Intelligence Layer (PIL) — TypeScript interfaces mirroring
// supabase/migrations/150-161_pil_*.sql exactly. Column names match the
// live schema verbatim; see PROSPECT_INTELLIGENCE_SCHEMA.md for the design
// rationale behind each table.

export type UUID = string;
export type ISODateTime = string;
export type ISODate = string;

// ---------------------------------------------------------------------------
// Enums (CHECK-constrained text columns)
// ---------------------------------------------------------------------------

export type ProspectEntityType =
  | "individual"
  | "family_foundation"
  | "private_foundation"
  | "community_foundation"
  | "corporate_foundation"
  | "corporation"
  | "executive"
  | "business_owner"
  | "board_member"
  | "trustee"
  | "wealth_holder"
  | "community_leader"
  | "institutional_funder"
  | "other";

export type ProspectStatus = "active" | "archived" | "merged";

export type ProspectSourceOfRecord = "discovery" | "crm_import" | "manual" | "rediscovery";

export type ResolutionCandidateStatus = "match" | "probable_match" | "unresolved" | "not_match";

export type AliasType = "name_variant" | "email" | "org_name" | "ein" | "crm_id" | "external_id";

export type GraphNodeType =
  | "person"
  | "company"
  | "foundation"
  | "board"
  | "nonprofit"
  | "donation"
  | "cause"
  | "geography"
  | "relationship"
  | "contact"
  | "opportunity";

export type GraphEdgeType =
  | "owns"
  | "employed_by"
  | "serves_on_board_of"
  | "trustee_of"
  | "donated_to"
  | "operates_in"
  | "supports_cause"
  | "related_to"
  | "introduces_to"
  | "has_contact"
  | "presents_opportunity";

export type RelationshipStrength = "very_strong" | "strong" | "moderate" | "weak" | "speculative";

export type EvidenceEntityTable = "pil_prospects" | "pil_graph_nodes" | "pil_graph_edges";

export type EvidenceVerificationStatus =
  | "verified_fact"
  | "corroborated_fact"
  | "single_source_fact"
  | "reasoned_inference"
  | "estimate"
  | "unverified"
  | "contradicted"
  | "stale";

export type EvidenceFreshnessStatus = "fresh" | "aging" | "stale";

export type EvidenceInferenceStatus = "direct" | "inferred";

export type EvidenceContradictionStatus = "none" | "contradicted" | "superseded";

export type ContradictionResolutionStatus =
  | "open"
  | "resolved_a"
  | "resolved_b"
  | "resolved_both_stale"
  | "unresolved";

export type ResearchRunStatus = "planning" | "running" | "completed" | "failed" | "cancelled";

export type ResearchLoopPhase =
  | "goal"
  | "observe_state"
  | "plan"
  | "select_tools_or_delegate"
  | "execute"
  | "collect_evidence"
  | "evaluate"
  | "observe_result"
  | "revise_plan"
  | "continue"
  | "escalate"
  | "stop";

export type AgentFamily =
  | "supervisory"
  | "discovery"
  | "prospect_intelligence"
  | "relationship_intelligence"
  | "qualification"
  | "strategy"
  | "knowledge_integrity"
  | "operations_evaluation_learning";

export type AutonomyLevel = "A0" | "A1" | "A2" | "A3" | "A4";

export type AgentRunStatus =
  | "queued"
  | "planning"
  | "running"
  | "observing"
  | "replanning"
  | "completed"
  | "blocked"
  | "failed"
  | "escalated";

export type DelegatedTaskStatus =
  | "pending"
  | "accepted"
  | "running"
  | "completed"
  | "cancelled"
  | "failed"
  | "escalated";

export type SourceType =
  | "open_web"
  | "public_records"
  | "news"
  | "nonprofit_filing"
  | "irs_form_990"
  | "sec_edgar"
  | "corporate_information"
  | "foundation_information"
  | "licensed_database"
  | "permitted_api"
  | "crm"
  | "internal";

export type SourcePermissibilityStatus = "permitted" | "restricted" | "prohibited";

export type CostType = "model_tokens" | "api_call" | "licensed_data" | "browser_automation" | "storage";

export type CostBudgetScopeType = "org" | "agent" | "research_run";

export type CostBudgetPeriod = "daily" | "monthly" | "per_run";

export type AuditActorType = "agent" | "human" | "system";

export type PolicyDecisionOutcome = "allow" | "deny" | "require_human";

export type HumanReviewType =
  | "identity_linkage"
  | "capacity_determination"
  | "policy_exception"
  | "autonomy_increase"
  | "high_impact_action"
  | "critic_block"
  | "contact_outreach_approval";

export type HumanReviewPriority = "low" | "normal" | "high" | "urgent";

export type HumanReviewStatus =
  | "pending"
  | "in_review"
  | "approved"
  | "rejected"
  | "changes_requested"
  | "expired";

export type MonitoringSubscriptionStatus = "active" | "paused";

export type MonitoringTriggerType =
  | "company_sale"
  | "acquisition"
  | "ipo"
  | "executive_appointment"
  | "retirement"
  | "foundation_appointment"
  | "board_appointment"
  | "new_nonprofit_affiliation"
  | "major_charitable_gift"
  | "new_foundation_filing"
  | "corporate_giving_program_launch"
  | "geographic_expansion"
  | "significant_business_event"
  | "philanthropic_announcement";

export type MonitoringEventStatus = "new" | "reviewed" | "actioned" | "dismissed";

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

// pil_prospects
export interface Prospect {
  id: UUID;
  organization_id: UUID;
  entity_type: ProspectEntityType;
  display_name: string;
  canonical_name: string;
  status: ProspectStatus;
  merged_into_prospect_id: UUID | null;
  source_of_record: ProspectSourceOfRecord;
  created_by_agent_id: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// pil_entity_resolution_candidates
export interface ProspectIdentity {
  id: UUID;
  organization_id: UUID;
  prospect_id_a: UUID;
  prospect_id_b: UUID;
  match_score: number | null;
  status: ResolutionCandidateStatus;
  evidence: Record<string, unknown>;
  resolved_by_agent_id: string | null;
  resolved_at: ISODateTime | null;
  created_at: ISODateTime;
}

// pil_entity_aliases
export interface ProspectAlias {
  id: UUID;
  organization_id: UUID;
  prospect_id: UUID;
  alias_type: AliasType;
  alias_value: string;
  source: string | null;
  confidence: number | null;
  created_at: ISODateTime;
}

// pil_graph_nodes
export interface GraphNode {
  id: UUID;
  organization_id: UUID;
  node_type: GraphNodeType;
  prospect_id: UUID | null;
  label: string;
  properties: Record<string, unknown>;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// pil_graph_edges
export interface GraphEdge {
  id: UUID;
  organization_id: UUID;
  source_node_id: UUID;
  target_node_id: UUID;
  edge_type: GraphEdgeType;
  relationship_strength: RelationshipStrength | null;
  confidence: number | null;
  temporal_validity_start: ISODate | null;
  temporal_validity_end: ISODate | null;
  is_current: boolean;
  superseded_by_edge_id: UUID | null;
  properties: Record<string, unknown>;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// pil_evidence
export interface EvidenceItem {
  id: UUID;
  organization_id: UUID;
  entity_id: UUID;
  entity_table: EvidenceEntityTable;
  claim: string;
  value: unknown;
  claim_type: string;
  source_url: string | null;
  source_title: string | null;
  source_type: string;
  publisher: string | null;
  retrieved_at: ISODateTime;
  published_at: ISODateTime | null;
  last_verified_at: ISODateTime | null;
  evidence_excerpt: string | null;
  agent_id: string;
  research_run_id: UUID | null;
  confidence: number;
  verification_status: EvidenceVerificationStatus;
  freshness_status: EvidenceFreshnessStatus;
  inference_status: EvidenceInferenceStatus;
  contradiction_status: EvidenceContradictionStatus;
  lineage: unknown[];
  created_at: ISODateTime;
}

// pil_contradictions
export interface EvidenceContradiction {
  id: UUID;
  organization_id: UUID;
  prospect_id: UUID;
  claim_type: string;
  evidence_id_a: UUID;
  evidence_id_b: UUID;
  resolution_status: ContradictionResolutionStatus;
  resolved_value: unknown;
  investigated_by_agent_id: string | null;
  resolved_at: ISODateTime | null;
  created_at: ISODateTime;
}

// pil_research_runs
export interface ResearchRun {
  id: UUID;
  organization_id: UUID;
  goal_id: UUID | null;
  prospect_id: UUID | null;
  initiating_agent_id: string;
  natural_language_query: string | null;
  structured_plan: Record<string, unknown>;
  status: ResearchRunStatus;
  token_budget: number | null;
  tokens_consumed: number;
  financial_budget: number | null;
  financial_spent: number;
  started_at: ISODateTime | null;
  completed_at: ISODateTime | null;
  created_at: ISODateTime;
}

// pil_research_run_steps
export interface ResearchRunStep {
  id: UUID;
  research_run_id: UUID;
  agent_run_id: UUID | null;
  step_number: number;
  loop_phase: ResearchLoopPhase;
  state_snapshot: Record<string, unknown>;
  decision: string | null;
  created_at: ISODateTime;
}

// pil_agent_registry
export interface AgentDefinition {
  agent_id: string;
  name: string;
  family: AgentFamily;
  mission: string;
  default_autonomy_level: AutonomyLevel;
  human_boundary: string | null;
  cadence: string;
  version: string;
  spec_ref: string;
  active: boolean;
  created_at: ISODateTime;
}

// pil_agent_runs
export interface AgentRun {
  id: UUID;
  organization_id: UUID;
  agent_id: string;
  research_run_id: UUID | null;
  delegated_task_id: UUID | null;
  goal_id: UUID | null;
  status: AgentRunStatus;
  autonomy_level_used: AutonomyLevel | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  tokens_consumed: number;
  cost_usd: number;
  started_at: ISODateTime | null;
  completed_at: ISODateTime | null;
  error: string | null;
  created_at: ISODateTime;
}

// pil_delegated_tasks
export interface DelegatedTask {
  task_id: UUID;
  organization_id: UUID;
  parent_agent_run_id: UUID | null;
  parent_agent_id: string;
  child_agent_id: string;
  objective: string;
  constraints: Record<string, unknown>;
  context_refs: unknown[];
  allowed_tools: string[];
  allowed_data_classes: string[];
  prohibited_data_classes: string[];
  evidence_budget: number | null;
  tool_budget: number | null;
  token_budget: number | null;
  financial_budget: number | null;
  deadline: ISODateTime | null;
  freshness_requirement: string | null;
  minimum_confidence: number | null;
  success_criteria: Record<string, unknown>;
  stop_conditions: Record<string, unknown>;
  escalation_conditions: Record<string, unknown>;
  max_autonomy: AutonomyLevel;
  status: DelegatedTaskStatus;
  child_agent_run_id: UUID | null;
  delegation_depth: number;
  created_at: ISODateTime;
  cancelled_at: ISODateTime | null;
}

// pil_source_registry
export interface Source {
  id: UUID;
  source_key: string;
  source_name: string;
  source_type: SourceType;
  provider: string | null;
  permissibility_status: SourcePermissibilityStatus;
  tos_notes: string | null;
  rate_limit_per_minute: number | null;
  cost_per_call: number | null;
  requires_license: boolean;
  active: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// pil_source_snapshots
export interface SourceSnapshot {
  id: UUID;
  evidence_id: UUID;
  source_url: string;
  snapshot_storage_path: string;
  content_hash: string;
  http_status: number | null;
  captured_at: ISODateTime;
  created_at: ISODateTime;
}

// pil_cost_ledger
export interface CostLedgerEntry {
  id: UUID;
  organization_id: UUID;
  agent_run_id: UUID | null;
  research_run_id: UUID | null;
  delegated_task_id: UUID | null;
  cost_type: CostType;
  provider: string | null;
  units: number;
  unit_cost: number;
  total_cost_usd: number;
  model_name: string | null;
  token_count: number | null;
  occurred_at: ISODateTime;
  created_at: ISODateTime;
}

// pil_cost_budgets
export interface CostBudget {
  id: UUID;
  organization_id: UUID;
  scope_type: CostBudgetScopeType;
  scope_id: string;
  budget_period: CostBudgetPeriod;
  budget_limit_usd: number;
  spent_usd: number;
  alert_threshold_pct: number;
  hard_stop: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// pil_audit_log
export interface AuditLogEntry {
  id: UUID;
  organization_id: UUID;
  actor_type: AuditActorType;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  policy_decision: string | null;
  ip_address: string | null;
  created_at: ISODateTime;
}

// pil_policy_decisions
export interface PolicyDecision {
  id: UUID;
  organization_id: UUID;
  actor_agent_id: string;
  action_requested: string;
  policy_name: string;
  decision: PolicyDecisionOutcome;
  reason: string;
  related_delegated_task_id: UUID | null;
  created_at: ISODateTime;
}

// pil_human_review_queue
export interface HumanReviewItem {
  id: UUID;
  organization_id: UUID;
  review_type: HumanReviewType;
  subject_type: string;
  subject_id: UUID;
  requested_by_agent_id: string | null;
  priority: HumanReviewPriority;
  status: HumanReviewStatus;
  summary: string;
  evidence_refs: unknown[];
  assigned_to_user_id: UUID | null;
  created_at: ISODateTime;
  resolved_at: ISODateTime | null;
}

// pil_monitoring_subscriptions
export interface MonitoringSubscription {
  id: UUID;
  organization_id: UUID;
  prospect_id: UUID;
  trigger_types: string[];
  status: MonitoringSubscriptionStatus;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// pil_monitoring_events
export interface MonitoringEvent {
  id: UUID;
  organization_id: UUID;
  prospect_id: UUID;
  trigger_type: MonitoringTriggerType;
  detected_by_agent_id: string;
  evidence_id: UUID | null;
  impact_assessment: Record<string, unknown>;
  status: MonitoringEventStatus;
  detected_at: ISODateTime;
  created_at: ISODateTime;
}
