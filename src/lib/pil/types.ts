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

// "application" added by migration 167 for the APP family (BEN-APP-01/02/03)
// -- not one of the original 8 families PROSPECT_INTELLIGENCE_AGENTS.md /
// migration 155 defined. See BEN-APP-01.ts's header for why this family was
// introduced rather than reusing an existing one.
export type AgentFamily =
  | "supervisory"
  | "discovery"
  | "prospect_intelligence"
  | "relationship_intelligence"
  | "qualification"
  | "strategy"
  | "knowledge_integrity"
  | "operations_evaluation_learning"
  | "application";

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

export type CostBudgetScopeType = "org" | "agent" | "research_run" | "orchestration";

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

export type FeatureFlagScopeType = "platform" | "org" | "agent";

// pil_prospect_opportunities.classification (migration 150)
export type ProspectOpportunityClassification =
  | "tier_1_priority"
  | "tier_2_cultivate"
  | "tier_3_monitor"
  | "research_more"
  | "low_probability"
  | "ineligible"
  | "disqualified";

export type ProspectOpportunityTimingStatus = "approach_now" | "cultivate_first" | "monitor" | "defer";

export type ProspectOpportunityStatus = "open" | "closed_won" | "closed_lost";

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

export type BillingPath = "api" | "subscription";

// ai_usage_log (migration 056, extended by 185/186 -- AR-5.1). Single per-call
// cost ledger for the whole platform; supersedes pil_cost_ledger, which is
// now read-only. agent_run_id is the core agent_runs(id) row (Railway
// worker / nightly pipeline); pil_agent_run_id is the PIL agent_runs(id) row
// (src/lib/pil/agent-runner.ts) -- a call is attributable to at most one of
// the two.
export interface CostLedgerEntry {
  id: UUID;
  organization_id: UUID;
  model: string;
  endpoint: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  duration_ms: number | null;
  agent_type: string | null;
  agent_run_id: UUID | null;
  pil_agent_run_id: UUID | null;
  provider: string;
  billing_path: BillingPath;
  created_at: ISODateTime;
}

// cost_budgets (renamed by migration 187 / AR-5.2 from its prior name)
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

// pil_prospect_opportunities (migration 150) -- had no TS interface as of
// PIL-02/PIL-03 (types.ts covers Groups 1-4 up through pil_contradictions but
// skips 1.3/1.4); added here for BEN-QLF-04.
export interface ProspectOpportunity {
  id: UUID;
  organization_id: UUID;
  prospect_id: UUID;
  classification: ProspectOpportunityClassification;
  mission_affinity_score: number | null;
  capacity_estimate_low: number | null;
  capacity_estimate_high: number | null;
  recommended_ask_low: number | null;
  recommended_ask_high: number | null;
  timing_status: ProspectOpportunityTimingStatus | null;
  engagement_strategy: string | null;
  confidence: number | null;
  qualified_by_agent_id: string | null;
  qualified_at: ISODateTime | null;
  status: ProspectOpportunityStatus;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// pil_mission_affinity_assessments (migration 165) -- BEN-QLF-01's
// per-dimension score breakdown (Cause/Population/Program/Geographic
// Alignment, Recency, Counterevidence). Distinct from the single blended
// pil_prospect_opportunities.mission_affinity_score column: this table keeps
// the full "why" behind that number.
export interface MissionAffinityAssessment {
  id: UUID;
  organization_id: UUID;
  prospect_id: UUID;
  opportunity_id: UUID | null;
  cause_alignment_score: number;
  population_alignment_score: number | null;
  program_alignment_score: number;
  geographic_alignment_score: number;
  recency_score: number;
  overall_score: number;
  counterevidence: string[];
  unscored_dimensions: string[];
  evidence_refs: string[];
  confidence: number;
  computed_by_agent_id: string;
  computed_at: ISODateTime;
  created_at: ISODateTime;
}

// pil_funding_eligibility_assessments (migration 165) -- BEN-QLF-02's
// per-dimension pass/fail breakdown (Applicant Class, Tax Status, Geography,
// Program Restrictions, Deadline/Window, Required Prerequisites). Each
// dimension is a nullable boolean: null means no evidence existed either way
// (distinct from an explicit false, which means a real disqualifying fact
// was found). `eligible` follows the same tri-state rule at the aggregate
// level -- see BEN-QLF-02.ts's header comment for the full decision table.
export interface FundingEligibilityAssessment {
  id: UUID;
  organization_id: UUID;
  prospect_id: UUID;
  opportunity_id: UUID | null;
  eligible: boolean | null;
  applicant_class_pass: boolean | null;
  tax_status_pass: boolean | null;
  geography_pass: boolean | null;
  program_restrictions_pass: boolean | null;
  deadline_window_pass: boolean | null;
  prerequisites_pass: boolean | null;
  disqualifying_reasons: string[];
  evidence_refs: string[];
  confidence: number;
  computed_by_agent_id: string;
  computed_at: ISODateTime;
  created_at: ISODateTime;
}

// pil_capacity_propensity_assessments (migration 165) -- BEN-QLF-03's output
// contract. Column groups are deliberately kept separate per the agent's
// mission ("Combine capacity and behavior evidence without conflating
// them") -- capacity_* fields are derived only from BEN-INT-08 wealth
// evidence, propensity_*/giving_pattern_summary/vehicle_use fields only from
// BEN-INT-07 giving-history evidence. Never average a capacity_* field with
// a propensity_* field; cause_relevance_score/uncertainty_notes are shared
// supporting context, not a third blended dimension.
export interface CapacityPropensityAssessment {
  id: UUID;
  organization_id: UUID;
  prospect_id: UUID;
  opportunity_id: UUID | null;
  // --- Capacity dimension (wealth-derived; BEN-INT-08 evidence only) ---
  capacity_estimate_low: number | null;
  capacity_estimate_high: number | null;
  capacity_confidence: number;
  capacity_basis: unknown[];
  // --- Propensity dimension (behavior-derived; BEN-INT-07 evidence only) ---
  propensity_score: number;
  propensity_confidence: number;
  giving_pattern_summary: Record<string, unknown>;
  vehicle_use: unknown[];
  // --- Shared supporting context (not a third blended score) ---
  cause_relevance_score: number;
  uncertainty_notes: string | null;
  evidence_refs: string[];
  computed_by_agent_id: string;
  computed_at: ISODateTime;
  created_at: ISODateTime;
}

// pil_timing_readiness_assessments (migration 165) -- BEN-QLF-05's
// per-dimension timing/readiness breakdown (Application Window, Trigger
// Recency, Relationship Maturity, Tenant Readiness, Document Readiness,
// Staleness And Monitor Conditions). Distinct from the single
// pil_prospect_opportunities.timing_status column (also written by this
// agent): this table keeps the full "why" behind that status, mirroring
// pil_mission_affinity_assessments/pil_funding_eligibility_assessments'
// same detail-table-alongside-blended-column pattern.
export interface TimingReadinessAssessment {
  id: UUID;
  organization_id: UUID;
  prospect_id: UUID;
  opportunity_id: UUID | null;
  timing_status: ProspectOpportunityTimingStatus;
  application_window_open: boolean | null;
  trigger_recency_days: number | null;
  relationship_maturity_score: number | null;
  tenant_readiness_score: number | null;
  document_readiness_score: number | null;
  monitor_conditions: string[];
  staleness_flags: string[];
  unscored_dimensions: string[];
  confidence: number;
  computed_by_agent_id: string;
  computed_at: ISODateTime;
  created_at: ISODateTime;
}

// pil_prospect_digital_twins (migration 150) -- had no TS interface as of
// PIL-02/PIL-03; added here for BEN-KNW-01.
export interface ProspectDigitalTwin {
  id: UUID;
  prospect_id: UUID;
  organization_id: UUID;
  twin_version: number;
  identity: Record<string, unknown>;
  biography: Record<string, unknown>;
  organizations_summary: unknown[];
  companies: unknown[];
  foundations: unknown[];
  giving_history: unknown[];
  wealth_indicators: Record<string, unknown>;
  relationships_summary: unknown[];
  evidence_summary: Record<string, unknown>;
  timeline: unknown[];
  affinity: Record<string, unknown>;
  capacity: Record<string, unknown>;
  opportunities_summary: unknown[];
  research_gaps: unknown[];
  contradictions_summary: unknown[];
  current_strategy: Record<string, unknown>;
  monitoring_events_summary: unknown[];
  completeness_score: number | null;
  last_updated_by_agent_id: string | null;
  updated_at: ISODateTime;
  created_at: ISODateTime;
}

// pil_prospect_dossiers (migration 163)
export interface ProspectDossierRow {
  id: UUID;
  organization_id: UUID;
  prospect_id: UUID;
  research_run_id: UUID | null;
  dossier: Record<string, unknown>;
  narrative_text: string;
  generated_at: ISODateTime;
  version: number;
  created_at: ISODateTime;
}

// pil_feature_flags (migration 163)
export interface FeatureFlag {
  id: UUID;
  flag_key: string;
  scope_type: FeatureFlagScopeType;
  scope_id: string | null;
  enabled: boolean;
  reason: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// BEN-STR-03's fixed 4-stage major-gift cultivation-cycle ladder (roster
// gives no literal stage names -- this is a standard cultivation-cycle
// convention, documented alongside the constant's real use in
// src/lib/pil/agents/str/BEN-STR-03.ts).
export type CultivationStage =
  | "identify_shared_ground"
  | "warm_introduction_or_first_touch"
  | "deepen_engagement"
  | "readiness_reassessment";

export type CultivationPlanStatus = "active" | "completed" | "abandoned" | "superseded";

export interface CultivationMilestone {
  stage: CultivationStage;
  description: string;
  suggestedTimingDays: number;
  completed: boolean;
  action: string;
}

export interface CultivationReassessmentGate {
  stage: CultivationStage;
  reassessmentRequired: boolean;
}

// pil_cultivation_plans (migration 166) -- BEN-STR-03's structured
// multi-step plan output. At most one 'active' row per (organization_id,
// prospect_id); find-then-write via findActivePlan()/upsertPlan() in
// BEN-STR-03.ts, mirroring graph.ts's upsertNode/upsertEdge pattern since
// this table has no natural ON CONFLICT target either.
export interface CultivationPlan {
  id: UUID;
  organization_id: UUID;
  prospect_id: UUID;
  opportunity_id: UUID;
  stages: CultivationStage[];
  milestones: CultivationMilestone[];
  content_evidence_needs: string[];
  reassessment_gates: CultivationReassessmentGate[];
  next_reassessment_at: ISODateTime | null;
  created_by_agent_id: string | null;
  status: CultivationPlanStatus;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// pil_application_profiles (migration 167) -- BEN-APP-01's output contract.
// request_profiles (migration 051, src/types/database.ts) predates PIL and
// lives outside the pil_* namespace; RequestProfile below is a narrow
// hand-mirrored read shape of just the columns BEN-APP-01 needs, not the full
// generated Database["public"]["Tables"]["request_profiles"] type, matching
// this file's own convention of hand-maintained mirrors rather than pulling
// in the generated schema type.
export type RequestType =
  | "monetary"
  | "land"
  | "in_kind"
  | "volunteer"
  | "service"
  | "partnership"
  | "sponsorship"
  | "facility";

export type ApplicationRecommendationStatus = "submit" | "monitor" | "research_more" | "manual_review";

// request_profiles.request_type/target_funder_categories/target_funder_types
// are plain `text`/`text[]` with no CHECK constraint (migration 051) -- this
// is the read-only shape BEN-APP-01 queries, not the full Insert/Update
// surface administrators use to author profiles.
export interface RequestProfile {
  id: UUID;
  organization_id: UUID;
  name: string;
  request_type: string;
  priority: number;
  active: boolean;
  needs_description: string;
  specific_requirements: Record<string, unknown>;
  target_funder_categories: string[] | null;
  target_funder_types: string[] | null;
  pitch_template: string | null;
  form_field_overrides: Record<string, unknown>;
  success_criteria: string | null;
  min_value: number | null;
  max_value: number | null;
  value_unit: string;
  geographic_requirements: Record<string, unknown> | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface ApplicationProfileRiskFactor {
  factor: string;
  mitigation: string;
}

export interface ApplicationProfilePitchParameters {
  emphasis: string[];
  avoid: string[];
  tone: string;
}

export interface ApplicationProfileRelationshipStrategy {
  sequence: number;
  timing: string;
  first_contact: string;
  escalation_path: string[];
}

// pil_application_profiles (migration 167) -- BEN-APP-01's (Application
// Profile Orchestrator) output. One row per (prospect, matched
// request_profile) per run, not one blended row per prospect -- the "Multi-
// profile queuing" requirement (BEN-APP-01.ts's header) needs every matched
// profile's own ranked score preserved, not collapsed into a single row the
// way pil_mission_affinity_assessments/pil_capacity_propensity_assessments/
// pil_timing_readiness_assessments each hold one row per scoring run for a
// single dimension. Append-only like those sibling tables (no UPDATE/DELETE
// policy) -- superseding recommendations are found via
// (organization_id, prospect_id, computed_at DESC), and every row from the
// same execute() call shares one explicit computed_at value so callers can
// group "this run's full ranked set" by exact timestamp equality.
export interface ApplicationProfile {
  id: UUID;
  organization_id: UUID;
  prospect_id: UUID;
  opportunity_id: UUID | null;
  request_type: RequestType;
  request_profile_id: UUID | null;
  success_probability: number;
  recommendation_status: ApplicationRecommendationStatus;
  strategic_reasoning: string;
  field_mappings: Record<string, string>;
  pitch_parameters: ApplicationProfilePitchParameters;
  risk_factors: ApplicationProfileRiskFactor[];
  relationship_strategy: ApplicationProfileRelationshipStrategy;
  evidence_refs: string[];
  confidence: number;
  computed_by_agent_id: string;
  computed_at: ISODateTime;
  created_at: ISODateTime;
}

// pil_priority_scores (migration 168) -- BEN-APP-02's output contract. See
// BEN-APP-02.ts's header for why this is a dedicated table (mirroring
// pil_application_profiles' own migration-167 precedent) rather than the
// task spec's literal pil_prospect_dossiers.priority_score/priority_
// percentile/priority_recommendation columns.
export type PriorityPercentile = "top_10" | "top_25" | "top_50" | "bottom_50";

export type PriorityRecommendation = "submit_now" | "submit_next_quarter" | "monitor" | "research_more";

export interface PriorityScoreBreakdown {
  success_probability: number;
  capacity_contribution: number;
  readiness_score: number;
  effort_efficiency: number;
  strategic_bonus_multiplier: number;
}

export interface PriorityScore {
  id: UUID;
  organization_id: UUID;
  prospect_id: UUID;
  application_profile_id: UUID | null;
  priority_score: number;
  priority_percentile: PriorityPercentile;
  priority_recommendation: PriorityRecommendation;
  score_breakdown: PriorityScoreBreakdown;
  reasoning: string;
  next_step: string;
  evidence_refs: string[];
  computed_by_agent_id: string;
  computed_at: ISODateTime;
  created_at: ISODateTime;
}

// pil_submission_queue (migration 169) -- BEN-APP-03's output contract. See
// that migration's own header for why this dedicated table exists alongside
// (not instead of) the legacy submission_queue table (migration 045) BEN-APP-03
// also writes portal-eligible rows into.
export type SubmissionQueueStatus =
  | "submit_now"
  | "submit_next_30_days"
  | "submit_q2"
  | "needs_more_research"
  | "blocked";

export type SubmissionMethod =
  | "portal_autoapply"
  | "email_draft"
  | "direct_outreach_task"
  | "manual_research_required"
  | "not_applicable";

export interface SubmissionDirectContact {
  method: "email" | "phone" | "mail" | "none";
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

export interface SubmissionQueueItem {
  id: UUID;
  organization_id: UUID;
  prospect_id: UUID;
  application_profile_id: UUID | null;
  priority_score_id: UUID | null;
  funder_id: UUID | null;
  request_profile_id: UUID | null;
  dossier_id: UUID | null;
  form_template_id: UUID | null;
  legacy_submission_queue_id: UUID | null;
  can_submit: boolean;
  should_submit: boolean;
  blockers: string[];
  status: SubmissionQueueStatus;
  submission_method: SubmissionMethod;
  direct_submission: SubmissionDirectContact;
  suggested_ask_amount: number | null;
  personalized_pitch: string | null;
  priority: number;
  scheduled_submission_date: ISODate | null;
  assigned_to: string;
  submission_strategy: string;
  evidence_refs: string[];
  computed_by_agent_id: string;
  computed_at: ISODateTime;
  created_at: ISODateTime;
}

// Narrow hand-mirrored read shapes for legacy (pre-PIL) tables BEN-APP-03
// reads -- same convention RequestProfile above established: only the
// columns this agent actually needs, not the full generated Database type.
export interface FunderRecord {
  id: UUID;
  organization_id: UUID;
  name: string;
  category: string;
  website: string | null;
  giving_portal_url: string | null;
  portal_login_status: string | null;
  preferred_application_method: string | null;
}

export interface ContactRecord {
  id: UUID;
  organization_id: UUID;
  funder_id: UUID;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  preferred_contact_method: string | null;
  relationship: string | null;
}

export interface FormTemplateRecord {
  id: UUID;
  organization_id: UUID;
  funder_id: UUID | null;
  portal_url: string;
  last_verified_at: ISODateTime | null;
  last_used_at: ISODateTime | null;
}

export interface LegacySubmissionQueueRow {
  id: UUID;
  organization_id: UUID;
  funder_id: UUID | null;
  priority: number;
  status: string;
  automation_mode: string;
  scheduled_for: ISODateTime | null;
  created_at: ISODateTime;
}

export interface StaffProfileRecord {
  id: UUID;
  organization_id: UUID;
  email: string;
  full_name: string | null;
  role: "owner" | "admin" | "writer" | "viewer";
}
