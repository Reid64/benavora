import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { getNodesByProspect } from "@/lib/pil/graph";
import { createReviewItem } from "@/lib/pil/human-review";
import { logAction } from "@/lib/pil/audit";
import { CEO_TRANSITION_KEYWORDS, DENIAL_KEYWORDS, hasWarmIntroPath, scanEvidenceForKeywords } from "@/lib/pil/agents/app/BEN-APP-01";
import type {
  ApplicationProfile,
  CapacityPropensityAssessment,
  ContactRecord,
  EvidenceItem,
  FormTemplateRecord,
  FunderRecord,
  GraphEdge,
  GraphNode,
  LegacySubmissionQueueRow,
  MissionAffinityAssessment,
  PriorityScore,
  ProspectDossierRow,
  Prospect,
  ProspectOpportunity,
  RequestProfile,
  StaffProfileRecord,
  SubmissionDirectContact,
  SubmissionMethod,
  SubmissionQueueItem,
  SubmissionQueueStatus,
  TimingReadinessAssessment,
} from "@/lib/pil/types";

// BEN-APP-03 -- Submission Orchestrator
// (pil_agent_registry, migration 169, APP family agent 3 of 3: application /
// recommendation / executor). Mission: BEN-APP-01 decides WHICH request
// type/profile fits a prospect and BEN-APP-02 decides WHEN a tenant's scarce
// outreach capacity should go to it -- this agent is the last mile: for
// every prospect BEN-APP-02 has ranked, run a CAN-we/SHOULD-we/HOW/WHEN/WHO
// gate and turn the answer into a real, actionable queue item. This agent
// never sends an email, places a call, or fills a form itself -- it decides
// the plan and hands portal-eligible work to the real AutoApply pipeline,
// and everything else to a human via pil_human_review_queue.
//
// Scope: org-wide, not per-prospect, for the identical reason BEN-APP-02 is
// org-wide (see that file's own header) -- "for each ranked application
// profile" is inherently a whole-batch sweep, and this agent's own input
// (pil_priority_scores) is itself already a whole-batch output. Unlike
// BEN-APP-02 (one row per prospect per RUN), this agent reads each
// prospect's own latest pil_priority_scores row regardless of which run
// produced it -- "act on the most current rank we have" is the correct
// per-prospect read for an executor, not "only prospects re-ranked in the
// exact same batch."
//
// Output destination -- same migration-167/168 schema-gap precedent
// recurs a third time: the task spec's own literal instruction was "Create
// autoapply_submission_queue items" -- no table by that name exists. Two
// real candidates exist and BOTH are used, for two different jobs (full
// reasoning in migration 169's own header):
//   1. pil_submission_queue (new, this migration) -- this agent's own
//      append-only decision record for EVERY prospect reviewed this run,
//      including the ones that got blocked or need more research. Mirrors
//      pil_application_profiles/pil_priority_scores' identical convention.
//   2. submission_queue (migration 045) -- the REAL, already-wired queue the
//      real FormFillerAgent/AutoApply worker (src/app/api/agents/form-filler,
//      src/app/api/cron/autoapply) actually consumes. Only portal-eligible,
//      immediately-actionable rows (status 'submit_now'/'submit_next_30_days'/
//      'submit_q2' AND submission_method 'portal_autoapply') are also
//      inserted there -- this is the literal "FormFillerAgent reads from
//      this queue" requirement made real rather than simulated inside a
//      pil_ table nothing downstream actually consumes.
//
// CRM funder resolution: pil_prospects has no funder_id column of its own.
// BEN-DIS-08 (CRM Rediscovery, migration ~150+) already establishes the one
// real linkage this schema has between a pil_prospect and a legacy `funders`
// row: a pil_graph_nodes row with prospect_id=null and
// properties={crmTable:"funders", crmRecordId:<funders.id>, category}, joined
// to the prospect's own node via a 'related_to' edge (source=CRM record node,
// target=prospect node). resolveCrmFunder() below is the reader side of that
// same convention (BEN-DIS-08 only ever writes it). No funders row resolves
// for the majority of DIS-01..07-discovered prospects (those were never
// cross-referenced against the legacy CRM) -- that is expected, not a bug;
// this agent degrades to email_draft/direct_outreach_task/manual_research
// paths for those exactly as the literal decision tree specifies.
//
// Can-Submit checklist -- six items, spec-given, applied against real
// columns only (no fabricated signal):
//   1. Organization profile complete -- organizations.mission_statement
//      non-empty AND at least one `programs` row AND at least one `outcomes`
//      row for this org (a whole-org gate, identical for every prospect
//      reviewed this run).
//   2. Matched request_profile -- BEN-APP-01 already guarantees this for
//      every pil_application_profiles row that exists at all; checked
//      defensively anyway.
//   3. Funder data exists (name, category, contact method) -- prospect.
//      display_name/entity_type always supply name/category (self-
//      sufficient, no CRM linkage required for those two), so this collapses
//      to the one genuinely uncertain part: a real contact method (resolved
//      CRM contact email/phone, funder giving_portal_url/website, or a
//      graph-derived warm-introduction path).
//   4. No critical blockers -- BEN-APP-01's own DENIAL_KEYWORDS/
//      CEO_TRANSITION_KEYWORDS evidence-text scan (reused verbatim, not
//      re-implemented), plus a real signal APP-01/02 never checked: the
//      resolved funder's own `portal_login_status` text column containing a
//      suspended/blocked/locked/disabled keyword.
//   5. Capacity indicated > 0 -- a real capacity_estimate_high/confidence >0
//      on either pil_capacity_propensity_assessments or the fallback
//      pil_prospect_opportunities range.
//   6. Affinity indicated (not neutral/negative) -- overall_score (or its
//      opportunity-level fallback) at or above AFFINITY_NOT_NEUTRAL_THRESHOLD;
//      an entirely unassessed affinity is treated as failing this check
//      (this build's "never assume a passing score with zero evidence"
//      discipline), not silently defaulted to a pass.
//
// Should-Submit formula (spec-given, applied literally):
//   success_probability > 0.50 OR (success_probability > 0.35 AND warm_relationship)
//   AND NOT (recent_rejection OR CEO_transition_pending)
// success_probability is BEN-APP-01's own already-computed
// pil_application_profiles.success_probability (never recomputed here --
// this agent acts on the recommendation, it does not re-score it).
// warm_relationship reuses the identical warm-introduction-path signal
// BEN-APP-01/02 both already rely on (hasWarmIntroPath), OR-ed with the
// prospect's own relationship_maturity_score crossing the same 0.7 warm
// threshold BEN-APP-02 uses. recent_rejection/CEO_transition_pending reuse
// BEN-APP-01's exact DENIAL_KEYWORDS/CEO_TRANSITION_KEYWORDS scan -- the spec
// names both signals a second time here (they are also part of the
// can-submit blocker list above); both checks are kept, deliberately
// redundant with the checklist, for literal fidelity to the spec's own
// two separately-stated gates.
//
// Status/timing bucketing: can_submit=false -> 'blocked'. can_submit=true,
// should_submit=false -> 'needs_more_research' (not a hard blocker, just not
// yet worth spending capacity on). Otherwise the underlying BEN-APP-02
// priority_recommendation decides the bucket: 'submit_now' passes through
// as-is; 'submit_next_quarter' splits into 'submit_next_30_days' (priority_
// score >= NEXT_30_DAYS_PRIORITY_SCORE_THRESHOLD) vs 'submit_q2' (below it)
// -- BEN-APP-02's own two-tier enum has no finer split than "next quarter",
// so this agent adds one deterministic, score-driven split on top of a real
// computed number rather than fabricating a third independent timing
// signal. scheduled_submission_date is today / +30 days / +90 days
// respectively, matching those three buckets' own names.
//
// How-to-submit decision tree (spec-given, applied literally): portal_
// autoapply requires BOTH a resolved funder's giving_portal_url AND a
// matching form_templates row (the spec's own "form_templates_exist"
// clause) -- a portal URL alone is not enough to hand a prospect to
// FormFillerAgent, since it has no field mapping to fill blind. Falls
// through email_draft (resolved contact email) -> direct_outreach_task
// (warm-intro path, resolved contact phone, or a funder website to research
// against) -> manual_research_required (spec's own literal fallthrough
// label for "no submission path").
//
// Delegation / human-review wiring: portal-eligible, immediately-actionable
// rows are hard-integrated into the real submission_queue table (see above)
// -- BEN-SUP-05 critic review and the high_impact_action human-review gate
// for the underlying "submit" recommendation were already both satisfied by
// BEN-APP-01 (migration 167); this agent does not re-request either. Every
// email_draft/direct_outreach_task row scheduled for immediate action
// instead creates a pil_human_review_queue item with review_type
// 'contact_outreach_approval' -- a real HumanReviewType (migration 160) no
// other implemented agent has used yet, and an exact fit: "create draft
// email... flag for manual send" / "create outreach task... flag for
// sales/BD team" both literally ARE a human contact-outreach approval. A
// capped BEN-SUP-06 (Research Recovery Investigator) delegation fires for
// prospects that landed on manual_research_required. Finally, this agent
// implements the spec's own "escalate if unsubmitted for > 7 days" rule for
// real -- against the real submission_queue table's own `created_at`/
// `status='pending'`, since that is the only place "actually submitted yet"
// can honestly be read from (pil_submission_queue is append-only and never
// updated after the fact, matching every sibling APP/QLF detail table).

const MODEL_TOKEN_UNIT_COST_USD = 0.00002;
const TOKENS_PER_REVIEWED_PROSPECT = 220;
const MAX_BATCH_SIZE = 200;

const FALLBACK_DIMENSION_SCORE = 0.5;
const WARM_RELATIONSHIP_THRESHOLD = 0.7;
const SHOULD_SUBMIT_HIGH_PROBABILITY_THRESHOLD = 0.5;
const SHOULD_SUBMIT_WARM_PROBABILITY_THRESHOLD = 0.35;
const AFFINITY_NOT_NEUTRAL_THRESHOLD = 40; // 0-100 scale
const NEXT_30_DAYS_PRIORITY_SCORE_THRESHOLD = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const NEXT_30_DAYS_OFFSET_MS = 30 * DAY_MS;
const NEXT_QUARTER_OFFSET_MS = 90 * DAY_MS;
const ESCALATION_STALE_DAYS = 7;

const ASSIGNABLE_STAFF_ROLES = ["owner", "admin", "writer"] as const;
const SUSPENDED_PORTAL_KEYWORDS = ["suspended", "blocked", "locked", "disabled"];

const MAX_MANUAL_RESEARCH_DELEGATIONS = 15;
const MAX_ESCALATION_REMINDER_ITEMS = 20;
const TOP_N_ACTIONS_IN_REPORT = 25;

function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code: unknown }).code) : "";
  const message = "message" in err ? String((err as { message: unknown }).message) : "";
  return code === "42P01" || /relation .* does not exist/i.test(message) || /does not exist/i.test(message);
}

function dateOnlyIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface ResolvedFunderContext {
  funder: FunderRecord | null;
  contact: ContactRecord | null;
  formTemplate: FormTemplateRecord | null;
}

interface LegacyQueueCandidate {
  prospectId: string;
  funderId: string;
  requestProfileId: string | null;
  priority: number;
  scheduledFor: string | null;
  blockers: string[];
}

interface OutreachReviewCandidate {
  prospectId: string;
  funderName: string;
  method: SubmissionMethod;
  contact: SubmissionDirectContact;
  pitch: string | null;
  assignedTo: string;
}

export interface SubmissionAction {
  prospectId: string;
  funderName: string;
  requestProfileName: string | null;
  priority: number;
  status: SubmissionQueueStatus;
  submissionMethod: SubmissionMethod;
  scheduledDate: string | null;
  assignedTo: string;
  reasoning: string;
}

export interface SubmissionOrchestratorReport {
  submissionSummary: {
    totalProspectsReviewed: number;
    readyToSubmit: number;
    submitNow: number;
    submitNext30Days: number;
    submitQ2: number;
    needsMoreResearch: number;
    blockersPreventSubmission: number;
  };
  submissionActions: SubmissionAction[];
  batchCapped: boolean;
  escalatedStaleLegacyQueueItems: number;
}

export class SubmissionOrchestratorAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const allPriorityScores = await this.loadLatestPriorityScorePerProspect(context.orgId);
    if (allPriorityScores.length === 0) {
      return this.completed({ submissionActions: [] }, "Organization has no pil_priority_scores rows to act on yet");
    }

    const batchCapped = allPriorityScores.length > MAX_BATCH_SIZE;
    const batch = [...allPriorityScores].sort((a, b) => b.priority_score - a.priority_score).slice(0, MAX_BATCH_SIZE);
    const prospectIds = batch.map((p) => p.prospect_id);
    const applicationProfileIds = [...new Set(batch.map((p) => p.application_profile_id).filter((id): id is string => id != null))];

    const [prospects, opportunities, applicationProfiles, missionAffinityByProspect, capacityByProspect, timingByProspect, dossierByProspect, staffProfiles, orgProfileComplete] =
      await Promise.all([
        this.loadProspects(context.orgId, prospectIds),
        this.loadOpportunities(context.orgId, prospectIds),
        this.loadApplicationProfiles(context.orgId, applicationProfileIds),
        this.loadLatestByProspect<MissionAffinityAssessment>("pil_mission_affinity_assessments", context.orgId, prospectIds),
        this.loadLatestByProspect<CapacityPropensityAssessment>("pil_capacity_propensity_assessments", context.orgId, prospectIds),
        this.loadLatestByProspect<TimingReadinessAssessment>("pil_timing_readiness_assessments", context.orgId, prospectIds),
        this.loadLatestDossierByProspect(context.orgId, prospectIds),
        this.loadAssignableStaff(context.orgId),
        this.checkOrgProfileComplete(context.orgId),
      ]);

    const requestProfileIds = [...new Set([...applicationProfiles.values()].map((p) => p.request_profile_id).filter((id): id is string => id != null))];
    const requestProfiles = await this.loadRequestProfiles(context.orgId, requestProfileIds);

    const evidenceByProspect = new Map<string, EvidenceItem[]>();
    const nodesByProspect = new Map<string, GraphNode[]>();
    await Promise.all(
      prospectIds.map(async (prospectId) => {
        const [evidence, nodes] = await Promise.all([getEvidence(prospectId, context.orgId), getNodesByProspect(prospectId, context.orgId)]);
        evidenceByProspect.set(prospectId, evidence);
        nodesByProspect.set(prospectId, nodes);
      }),
    );

    const warmIntroByProspect = new Map<string, boolean>();
    const resolvedFunderByProspect = new Map<string, ResolvedFunderContext>();
    await Promise.all(
      prospectIds.map(async (prospectId) => {
        const nodeIds = (nodesByProspect.get(prospectId) ?? []).map((n) => n.id);
        const [warmIntroPath, resolvedFunder] = await Promise.all([
          nodeIds.length > 0 ? hasWarmIntroPath(context.orgId, nodeIds) : Promise.resolve(false),
          this.resolveCrmFunder(context.orgId, nodeIds),
        ]);
        warmIntroByProspect.set(prospectId, warmIntroPath);
        resolvedFunderByProspect.set(prospectId, resolvedFunder);
      }),
    );

    const nowIso = new Date().toISOString();
    const rowsToInsert: Array<Omit<SubmissionQueueItem, "id" | "created_at">> = [];
    const actions: SubmissionAction[] = [];
    const legacyQueueCandidates: LegacyQueueCandidate[] = [];
    const outreachReviewCandidates: OutreachReviewCandidate[] = [];
    const manualResearchProspectIds: string[] = [];

    let readyToSubmit = 0;
    let submitNow = 0;
    let submitNext30 = 0;
    let submitQ2 = 0;
    let needsMoreResearch = 0;
    let blockersPreventSubmission = 0;

    for (let index = 0; index < batch.length; index++) {
      const priorityScore = batch[index]!;
      const prospectId = priorityScore.prospect_id;
      const prospect = prospects.get(prospectId);
      const applicationProfile = priorityScore.application_profile_id ? applicationProfiles.get(priorityScore.application_profile_id) ?? null : null;
      if (!prospect || !applicationProfile) continue; // nothing to act on without both

      const opportunity = opportunities.get(prospectId) ?? null;
      const missionAffinity = missionAffinityByProspect.get(prospectId) ?? null;
      const capacityAssessment = capacityByProspect.get(prospectId) ?? null;
      const timingAssessment = timingByProspect.get(prospectId) ?? null;
      const dossier = dossierByProspect.get(prospectId) ?? null;
      const evidence = evidenceByProspect.get(prospectId) ?? [];
      const warmIntroPath = warmIntroByProspect.get(prospectId) ?? false;
      const resolvedFunder = resolvedFunderByProspect.get(prospectId) ?? { funder: null, contact: null, formTemplate: null };
      const requestProfile = applicationProfile.request_profile_id ? requestProfiles.get(applicationProfile.request_profile_id) ?? null : null;

      const denialFlag = scanEvidenceForKeywords(evidence, DENIAL_KEYWORDS);
      const ceoTransitionFlag = scanEvidenceForKeywords(evidence, CEO_TRANSITION_KEYWORDS);
      const relationship = this.resolveRelationshipDimension(timingAssessment);
      const affinityScore = this.resolveAffinityScore(missionAffinity, opportunity);
      const capacityKnown = this.resolveCapacityKnown(capacityAssessment, opportunity);

      const { canSubmit, blockers } = this.runCanSubmitChecklist({
        orgProfileComplete,
        applicationProfile,
        resolvedFunder,
        warmIntroPath,
        denialFlag,
        ceoTransitionFlag,
        capacityKnown,
        affinityScore,
      });

      const warmRelationship = warmIntroPath || relationship >= WARM_RELATIONSHIP_THRESHOLD;
      const shouldSubmit =
        canSubmit &&
        (applicationProfile.success_probability > SHOULD_SUBMIT_HIGH_PROBABILITY_THRESHOLD ||
          (applicationProfile.success_probability > SHOULD_SUBMIT_WARM_PROBABILITY_THRESHOLD && warmRelationship)) &&
        !denialFlag &&
        !ceoTransitionFlag;

      const status = this.decideStatus({
        canSubmit,
        shouldSubmit,
        priorityRecommendation: priorityScore.priority_recommendation,
        priorityScoreValue: priorityScore.priority_score,
      });
      const scheduledDate = this.decideScheduledDate(status);
      const submissionMethod = this.decideSubmissionMethod(resolvedFunder, warmIntroPath);
      const directSubmission = this.buildDirectSubmission(submissionMethod, resolvedFunder);
      const suggestedAskAmount = this.resolveSuggestedAskAmount(opportunity, capacityAssessment, requestProfile);
      const personalizedPitch = this.buildPersonalizedPitch(prospect, applicationProfile, requestProfile);
      const assignedTo = this.assignStaff(staffProfiles, index, warmIntroPath);
      const submissionStrategy = this.buildSubmissionStrategy({ applicationProfile, resolvedFunder, warmIntroPath, blockers, status });

      switch (status) {
        case "submit_now":
          submitNow++;
          readyToSubmit++;
          break;
        case "submit_next_30_days":
          submitNext30++;
          readyToSubmit++;
          break;
        case "submit_q2":
          submitQ2++;
          readyToSubmit++;
          break;
        case "needs_more_research":
          needsMoreResearch++;
          break;
        case "blocked":
          blockersPreventSubmission++;
          break;
      }

      rowsToInsert.push({
        organization_id: context.orgId,
        prospect_id: prospectId,
        application_profile_id: applicationProfile.id,
        priority_score_id: priorityScore.id,
        funder_id: resolvedFunder.funder?.id ?? null,
        request_profile_id: applicationProfile.request_profile_id,
        dossier_id: dossier?.id ?? null,
        form_template_id: resolvedFunder.formTemplate?.id ?? null,
        legacy_submission_queue_id: null,
        can_submit: canSubmit,
        should_submit: shouldSubmit,
        blockers,
        status,
        submission_method: submissionMethod,
        direct_submission: directSubmission,
        suggested_ask_amount: suggestedAskAmount,
        personalized_pitch: personalizedPitch,
        priority: priorityScore.priority_score,
        scheduled_submission_date: scheduledDate,
        assigned_to: assignedTo,
        submission_strategy: submissionStrategy,
        evidence_refs: evidence.map((e) => e.id),
        computed_by_agent_id: context.agentCode,
        computed_at: nowIso,
      });

      actions.push({
        prospectId,
        funderName: resolvedFunder.funder?.name ?? prospect.display_name,
        requestProfileName: requestProfile?.name ?? null,
        priority: index + 1,
        status,
        submissionMethod,
        scheduledDate,
        assignedTo,
        reasoning: submissionStrategy,
      });

      const readyNow = status === "submit_now" || status === "submit_next_30_days" || status === "submit_q2";
      if (readyNow && submissionMethod === "portal_autoapply" && resolvedFunder.funder) {
        legacyQueueCandidates.push({
          prospectId,
          funderId: resolvedFunder.funder.id,
          requestProfileId: applicationProfile.request_profile_id,
          priority: this.mapToLegacyQueuePriority(priorityScore.priority_score),
          scheduledFor: scheduledDate,
          blockers,
        });
      } else if (status === "submit_now" && (submissionMethod === "email_draft" || submissionMethod === "direct_outreach_task")) {
        outreachReviewCandidates.push({
          prospectId,
          funderName: resolvedFunder.funder?.name ?? prospect.display_name,
          method: submissionMethod,
          contact: directSubmission,
          pitch: personalizedPitch,
          assignedTo,
        });
      } else if (submissionMethod === "manual_research_required" && status !== "blocked" && manualResearchProspectIds.length < MAX_MANUAL_RESEARCH_DELEGATIONS) {
        manualResearchProspectIds.push(prospectId);
      }
    }

    await this.insertSubmissionQueueRows(rowsToInsert);
    const legacyQueueItemsCreated = await this.insertLegacyQueueRows(context.orgId, legacyQueueCandidates);

    let reviewsCreated = 0;
    for (const review of outreachReviewCandidates) {
      await createReviewItem({
        organization_id: context.orgId,
        review_type: "contact_outreach_approval",
        subject_type: "pil_submission_queue",
        subject_id: review.prospectId,
        requested_by_agent_id: context.agentCode,
        priority: "high",
        status: "pending",
        summary: `BEN-APP-03 drafted a ${review.method === "email_draft" ? "email" : "direct outreach"} ask for ${review.funderName}, assigned to ${review.assignedTo}. Contact: ${
          review.contact.contact_email ?? review.contact.contact_phone ?? "unknown"
        }. Pitch: ${review.pitch ?? "(none)"}.`,
        evidence_refs: [],
        assigned_to_user_id: null,
        resolved_at: null,
      });
      reviewsCreated++;
    }

    const delegations: DelegationRequest[] = [];
    if (manualResearchProspectIds.length > 0) {
      delegations.push({
        childAgentCode: "BEN-SUP-06",
        objective: `${manualResearchProspectIds.length} prospect(s) in BEN-APP-03's latest batch have no resolvable submission path (no CRM funder record, contact, or warm-introduction path) -- escalate to manual research.`,
        maxAutonomy: "A2",
        constraints: { prospectIds: manualResearchProspectIds },
      });
    }

    const escalatedStaleLegacyQueueItems = await this.escalateStaleLegacyQueueItems(context);

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "submission_queue.orchestrated",
      resource_type: "pil_submission_queue",
      resource_id: context.runId,
      before_state: null,
      after_state: { totalReviewed: batch.length, submitNow, submitNext30, submitQ2, needsMoreResearch, blockersPreventSubmission },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, batch.length * TOKENS_PER_REVIEWED_PROSPECT);

    const report: SubmissionOrchestratorReport = {
      submissionSummary: {
        totalProspectsReviewed: batch.length,
        readyToSubmit,
        submitNow,
        submitNext30Days: submitNext30,
        submitQ2,
        needsMoreResearch,
        blockersPreventSubmission,
      },
      submissionActions: actions.slice(0, TOP_N_ACTIONS_IN_REPORT),
      batchCapped,
      escalatedStaleLegacyQueueItems,
    };

    return {
      status: "completed",
      evidence: [],
      conclusions: { report, legacyQueueItemsCreated, reviewsCreated },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private runCanSubmitChecklist(params: {
    orgProfileComplete: boolean;
    applicationProfile: ApplicationProfile;
    resolvedFunder: ResolvedFunderContext;
    warmIntroPath: boolean;
    denialFlag: boolean;
    ceoTransitionFlag: boolean;
    capacityKnown: boolean;
    affinityScore: number | null;
  }): { canSubmit: boolean; blockers: string[] } {
    const { orgProfileComplete, applicationProfile, resolvedFunder, warmIntroPath, denialFlag, ceoTransitionFlag, capacityKnown, affinityScore } = params;
    const blockers: string[] = [];

    if (!orgProfileComplete) {
      blockers.push("organization_profile_incomplete");
    }
    if (!applicationProfile.request_profile_id) {
      blockers.push("no_matched_request_profile");
    }
    const contactMethodAvailable =
      !!resolvedFunder.contact?.email || !!resolvedFunder.contact?.phone || !!resolvedFunder.funder?.giving_portal_url || !!resolvedFunder.funder?.website || warmIntroPath;
    if (!contactMethodAvailable) {
      blockers.push("no_contact_method_available");
    }
    if (denialFlag) {
      blockers.push("recent_decline_on_record");
    }
    if (ceoTransitionFlag) {
      blockers.push("leadership_transition_pending");
    }
    const portalStatus = resolvedFunder.funder?.portal_login_status?.toLowerCase() ?? "";
    if (portalStatus && SUSPENDED_PORTAL_KEYWORDS.some((k) => portalStatus.includes(k))) {
      blockers.push("funder_portal_access_suspended");
    }
    if (!capacityKnown) {
      blockers.push("capacity_not_indicated");
    }
    if (affinityScore == null) {
      blockers.push("affinity_not_assessed");
    } else if (affinityScore < AFFINITY_NOT_NEUTRAL_THRESHOLD) {
      blockers.push("affinity_neutral_or_negative");
    }

    return { canSubmit: blockers.length === 0, blockers };
  }

  private decideStatus(params: {
    canSubmit: boolean;
    shouldSubmit: boolean;
    priorityRecommendation: PriorityScore["priority_recommendation"];
    priorityScoreValue: number;
  }): SubmissionQueueStatus {
    const { canSubmit, shouldSubmit, priorityRecommendation, priorityScoreValue } = params;
    if (!canSubmit) return "blocked";
    if (!shouldSubmit) return "needs_more_research";
    if (priorityRecommendation === "submit_now") return "submit_now";
    if (priorityRecommendation === "submit_next_quarter") {
      return priorityScoreValue >= NEXT_30_DAYS_PRIORITY_SCORE_THRESHOLD ? "submit_next_30_days" : "submit_q2";
    }
    // priority_recommendation is 'monitor'/'research_more' -- BEN-APP-02
    // itself only reaches those when a negative signal is present, which
    // should_submit's own NOT(recent_rejection OR CEO_transition_pending)
    // clause already filters out above; kept as a defensive fallback.
    return "needs_more_research";
  }

  private decideScheduledDate(status: SubmissionQueueStatus): string | null {
    const now = Date.now();
    if (status === "submit_now") return dateOnlyIso(new Date(now));
    if (status === "submit_next_30_days") return dateOnlyIso(new Date(now + NEXT_30_DAYS_OFFSET_MS));
    if (status === "submit_q2") return dateOnlyIso(new Date(now + NEXT_QUARTER_OFFSET_MS));
    return null;
  }

  private decideSubmissionMethod(resolvedFunder: ResolvedFunderContext, warmIntroPath: boolean): SubmissionMethod {
    const portalAvailable = !!resolvedFunder.funder?.giving_portal_url && !!resolvedFunder.formTemplate;
    if (portalAvailable) return "portal_autoapply";
    if (resolvedFunder.contact?.email) return "email_draft";
    if (warmIntroPath || resolvedFunder.contact?.phone || resolvedFunder.funder?.website) return "direct_outreach_task";
    return "manual_research_required";
  }

  private buildDirectSubmission(method: SubmissionMethod, resolvedFunder: ResolvedFunderContext): SubmissionDirectContact {
    if (method === "email_draft") {
      return {
        method: "email",
        contact_name: resolvedFunder.contact?.name ?? null,
        contact_email: resolvedFunder.contact?.email ?? null,
        contact_phone: resolvedFunder.contact?.phone ?? null,
      };
    }
    if (method === "direct_outreach_task") {
      return {
        method: resolvedFunder.contact?.phone ? "phone" : "mail",
        contact_name: resolvedFunder.contact?.name ?? null,
        contact_email: resolvedFunder.contact?.email ?? null,
        contact_phone: resolvedFunder.contact?.phone ?? null,
      };
    }
    return { method: "none", contact_name: null, contact_email: null, contact_phone: null };
  }

  private resolveSuggestedAskAmount(opportunity: ProspectOpportunity | null, capacityAssessment: CapacityPropensityAssessment | null, requestProfile: RequestProfile | null): number | null {
    if (opportunity?.recommended_ask_low != null && opportunity?.recommended_ask_high != null) {
      return (opportunity.recommended_ask_low + opportunity.recommended_ask_high) / 2;
    }
    if (capacityAssessment?.capacity_estimate_low != null && capacityAssessment?.capacity_estimate_high != null) {
      return (capacityAssessment.capacity_estimate_low + capacityAssessment.capacity_estimate_high) / 2;
    }
    if (opportunity?.capacity_estimate_low != null && opportunity?.capacity_estimate_high != null) {
      return (opportunity.capacity_estimate_low + opportunity.capacity_estimate_high) / 2;
    }
    if (requestProfile?.min_value != null && requestProfile?.max_value != null) {
      return (requestProfile.min_value + requestProfile.max_value) / 2;
    }
    return requestProfile?.min_value ?? null;
  }

  private buildPersonalizedPitch(prospect: Prospect, applicationProfile: ApplicationProfile, requestProfile: RequestProfile | null): string {
    const { emphasis, avoid, tone } = applicationProfile.pitch_parameters;
    const emphasisText = emphasis.length > 0 ? emphasis.join(", ") : "the organization's general impact";
    const requestText = requestProfile ? ` Frame the ask around "${requestProfile.name}" (${requestProfile.needs_description}).` : "";
    const avoidText = avoid.length > 0 ? ` Avoid referencing: ${avoid.join("; ")}.` : "";
    return `Approach ${prospect.display_name} with a ${tone} tone, emphasizing ${emphasisText}.${requestText}${avoidText}`;
  }

  private assignStaff(staff: StaffProfileRecord[], index: number, warmIntroPath: boolean): string {
    if (staff.length === 0) return "unassigned";
    if (warmIntroPath) {
      const lead = staff.find((s) => s.role === "owner" || s.role === "admin");
      if (lead) return lead.email;
    }
    return staff[index % staff.length]!.email;
  }

  private buildSubmissionStrategy(params: {
    applicationProfile: ApplicationProfile;
    resolvedFunder: ResolvedFunderContext;
    warmIntroPath: boolean;
    blockers: string[];
    status: SubmissionQueueStatus;
  }): string {
    const { applicationProfile, resolvedFunder, warmIntroPath, blockers, status } = params;
    const rs = applicationProfile.relationship_strategy;
    const introText = warmIntroPath
      ? "Warm introduction path available -- lead with the existing relationship rather than a cold approach."
      : "No warm introduction path found -- expect a cold or lightly-cultivated approach.";
    const timingText = rs?.timing ? ` Timing: ${rs.timing}.` : "";
    const escalationText = rs?.escalation_path && rs.escalation_path.length > 0 ? ` Escalation path if stalled: ${rs.escalation_path.join(" -> ")}.` : "";
    const portalText = resolvedFunder.funder?.preferred_application_method ? ` Funder's stated preferred method: ${resolvedFunder.funder.preferred_application_method}.` : "";
    const blockerText = blockers.length > 0 ? ` Outstanding blockers: ${blockers.join("; ")}.` : "";
    return `${introText}${timingText}${escalationText}${portalText}${blockerText} Status: ${status}.`;
  }

  private mapToLegacyQueuePriority(priorityScore: number): number {
    // submission_queue.priority is ascending-urgency (lower number = handled
    // first, per its own idx_submission_queue_priority index and
    // worker_status's ORDER BY priority ASC) while this agent's own
    // priority_score is descending-urgency (higher = more important) --
    // inverted here so a 100-priority_score prospect becomes queue priority
    // 1 (most urgent) and a 0-priority_score prospect becomes 101.
    return Math.max(1, Math.round(101 - priorityScore));
  }

  private resolveRelationshipDimension(timingAssessment: TimingReadinessAssessment | null): number {
    if (timingAssessment?.relationship_maturity_score != null) {
      return Math.max(0, Math.min(1, timingAssessment.relationship_maturity_score / 100));
    }
    return FALLBACK_DIMENSION_SCORE;
  }

  private resolveAffinityScore(missionAffinity: MissionAffinityAssessment | null, opportunity: ProspectOpportunity | null): number | null {
    if (missionAffinity) return missionAffinity.overall_score;
    if (opportunity?.mission_affinity_score != null) return opportunity.mission_affinity_score * 100;
    return null;
  }

  private resolveCapacityKnown(capacityAssessment: CapacityPropensityAssessment | null, opportunity: ProspectOpportunity | null): boolean {
    const capacityHigh = capacityAssessment?.capacity_estimate_high ?? opportunity?.capacity_estimate_high ?? 0;
    const capacityConfidence = capacityAssessment?.capacity_confidence ?? 0;
    return capacityHigh > 0 || capacityConfidence > 0;
  }

  // Reader side of BEN-DIS-08's own CRM-linkage convention: a pil_graph_nodes
  // row (prospect_id=null) carrying properties.crmTable==="funders" and
  // properties.crmRecordId, joined to the prospect's own node via a
  // 'related_to' edge (source=CRM record node, target=prospect node). See
  // this file's header for why -- BEN-DIS-08 is the only writer of this
  // shape today.
  private async resolveCrmFunder(orgId: string, prospectNodeIds: string[]): Promise<ResolvedFunderContext> {
    const empty: ResolvedFunderContext = { funder: null, contact: null, formTemplate: null };
    if (prospectNodeIds.length === 0) return empty;

    const client = getPilClient();
    const { data: edgeRows, error: edgeError } = await client
      .from("pil_graph_edges")
      .select("*")
      .eq("organization_id", orgId)
      .eq("is_current", true)
      .eq("edge_type", "related_to")
      .in("target_node_id", prospectNodeIds);
    if (edgeError) throw edgeError;
    const edges = (edgeRows ?? []) as GraphEdge[];
    if (edges.length === 0) return empty;

    const { data: sourceNodeRows, error: nodeError } = await client
      .from("pil_graph_nodes")
      .select("*")
      .eq("organization_id", orgId)
      .in(
        "id",
        edges.map((e) => e.source_node_id),
      );
    if (nodeError) throw nodeError;
    const crmNode = ((sourceNodeRows ?? []) as GraphNode[]).find((n) => n.properties?.crmTable === "funders" && typeof n.properties?.crmRecordId === "string");
    const funderId = crmNode ? (crmNode.properties.crmRecordId as string) : null;
    if (!funderId) return empty;

    const { data: funderRow, error: funderError } = await client.from("funders").select("*").eq("organization_id", orgId).eq("id", funderId).maybeSingle();
    if (funderError) throw funderError;
    const funder = (funderRow as FunderRecord | null) ?? null;
    if (!funder) return empty;

    const [{ data: contactRows, error: contactError }, { data: templateRows, error: templateError }] = await Promise.all([
      client.from("contacts").select("*").eq("organization_id", orgId).eq("funder_id", funderId),
      client.from("form_templates").select("*").eq("organization_id", orgId).eq("funder_id", funderId).order("last_verified_at", { ascending: false }),
    ]);
    if (contactError) throw contactError;
    if (templateError) throw templateError;
    const contacts = (contactRows ?? []) as ContactRecord[];
    const contact = contacts.find((c) => c.email) ?? contacts[0] ?? null;
    const formTemplate = ((templateRows ?? []) as FormTemplateRecord[])[0] ?? null;

    return { funder, contact, formTemplate };
  }

  private async checkOrgProfileComplete(orgId: string): Promise<boolean> {
    const client = getPilClient();
    const [{ data: orgRow, error: orgError }, { count: programCount, error: programError }, { count: outcomeCount, error: outcomeError }] = await Promise.all([
      client.from("organizations").select("mission_statement").eq("id", orgId).maybeSingle(),
      client.from("programs").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
      client.from("outcomes").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    ]);
    if (orgError) throw orgError;
    if (programError) throw programError;
    if (outcomeError) throw outcomeError;
    const missionPresent = !!(orgRow as { mission_statement: string | null } | null)?.mission_statement?.trim();
    return missionPresent && (programCount ?? 0) > 0 && (outcomeCount ?? 0) > 0;
  }

  private async loadAssignableStaff(orgId: string): Promise<StaffProfileRecord[]> {
    const { data, error } = await getPilClient().from("profiles").select("id, organization_id, email, full_name, role").eq("organization_id", orgId).in("role", ASSIGNABLE_STAFF_ROLES).order(
      "created_at",
      { ascending: true },
    );
    if (error) throw error;
    return (data ?? []) as StaffProfileRecord[];
  }

  private async loadLatestPriorityScorePerProspect(orgId: string): Promise<PriorityScore[]> {
    const { data, error } = await getPilClient().from("pil_priority_scores").select("*").eq("organization_id", orgId).order("computed_at", { ascending: false });
    if (error) throw error;
    const map = new Map<string, PriorityScore>();
    for (const row of (data ?? []) as PriorityScore[]) {
      if (!map.has(row.prospect_id)) map.set(row.prospect_id, row);
    }
    return [...map.values()];
  }

  private async loadProspects(orgId: string, prospectIds: string[]): Promise<Map<string, Prospect>> {
    if (prospectIds.length === 0) return new Map();
    const { data, error } = await getPilClient().from("pil_prospects").select("*").eq("organization_id", orgId).in("id", prospectIds);
    if (error) throw error;
    return new Map(((data ?? []) as Prospect[]).map((p) => [p.id, p]));
  }

  private async loadOpportunities(orgId: string, prospectIds: string[]): Promise<Map<string, ProspectOpportunity>> {
    if (prospectIds.length === 0) return new Map();
    const { data, error } = await getPilClient().from("pil_prospect_opportunities").select("*").eq("organization_id", orgId).in("prospect_id", prospectIds);
    if (error) throw error;
    return new Map(((data ?? []) as ProspectOpportunity[]).map((o) => [o.prospect_id, o]));
  }

  private async loadApplicationProfiles(orgId: string, ids: string[]): Promise<Map<string, ApplicationProfile>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await getPilClient().from("pil_application_profiles").select("*").eq("organization_id", orgId).in("id", ids);
    if (error) throw error;
    return new Map(((data ?? []) as ApplicationProfile[]).map((p) => [p.id, p]));
  }

  private async loadRequestProfiles(orgId: string, ids: string[]): Promise<Map<string, RequestProfile>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await getPilClient().from("request_profiles").select("*").eq("organization_id", orgId).in("id", ids);
    if (error) throw error;
    return new Map(((data ?? []) as RequestProfile[]).map((p) => [p.id, p]));
  }

  private async loadLatestDossierByProspect(orgId: string, prospectIds: string[]): Promise<Map<string, ProspectDossierRow>> {
    if (prospectIds.length === 0) return new Map();
    const { data, error } = await getPilClient()
      .from("pil_prospect_dossiers")
      .select("*")
      .eq("organization_id", orgId)
      .in("prospect_id", prospectIds)
      .order("generated_at", { ascending: false });
    if (error) throw error;
    const map = new Map<string, ProspectDossierRow>();
    for (const row of (data ?? []) as ProspectDossierRow[]) {
      if (!map.has(row.prospect_id)) map.set(row.prospect_id, row);
    }
    return map;
  }

  // Shared "latest row per prospect" reducer, identical to BEN-APP-02's own
  // copy of this helper -- each APP-family file keeps its own small local
  // copy rather than a shared cross-file utility, matching this codebase's
  // established per-file-duplication convention (see isMissingTableError
  // above, and every sibling file's own copy of it).
  private async loadLatestByProspect<T extends { prospect_id: string; computed_at: string }>(table: string, orgId: string, prospectIds: string[]): Promise<Map<string, T>> {
    if (prospectIds.length === 0) return new Map();
    const { data, error } = await getPilClient().from(table).select("*").eq("organization_id", orgId).in("prospect_id", prospectIds).order("computed_at", { ascending: false });
    if (error) throw error;
    const map = new Map<string, T>();
    for (const row of (data ?? []) as T[]) {
      if (!map.has(row.prospect_id)) map.set(row.prospect_id, row);
    }
    return map;
  }

  private async insertSubmissionQueueRows(rows: Array<Omit<SubmissionQueueItem, "id" | "created_at">>): Promise<void> {
    if (rows.length === 0) return;
    try {
      const { error } = await getPilClient().from("pil_submission_queue").insert(rows);
      if (error && !isMissingTableError(error)) throw error;
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
    }
  }

  // Bridges into the REAL AutoApply worker queue (migration 045) -- see this
  // file's header for why this, and not just pil_submission_queue, is
  // required for the "FormFillerAgent reads from this queue" integration to
  // be real. risk_score/risk_factors (migration 052) and request_profile_id
  // (migration 051) are live ALTER TABLE columns on submission_queue that
  // src/types/database.ts's generated snapshot has not caught up to (the
  // same documented generated-types lag BEN-DIS-08 already flagged for
  // funders/contacts) -- writing them here is still writing to real columns.
  private async insertLegacyQueueRows(orgId: string, candidates: LegacyQueueCandidate[]): Promise<number> {
    if (candidates.length === 0) return 0;
    const rows = candidates.map((c) => ({
      organization_id: orgId,
      funder_id: c.funderId,
      priority: c.priority,
      status: "pending",
      automation_mode: "auto",
      scheduled_for: c.scheduledFor ? new Date(c.scheduledFor).toISOString() : null,
      request_profile_id: c.requestProfileId,
      risk_score: c.blockers.length,
      risk_factors: c.blockers,
    }));
    try {
      const { error } = await getPilClient().from("submission_queue").insert(rows);
      if (error && !isMissingTableError(error)) throw error;
      return isMissingTableError(error) ? 0 : rows.length;
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
      return 0;
    }
  }

  private async escalateStaleLegacyQueueItems(context: AgentContext): Promise<number> {
    const staleCutoff = new Date(Date.now() - ESCALATION_STALE_DAYS * DAY_MS).toISOString();
    let rows: LegacySubmissionQueueRow[] = [];
    try {
      const { data, error } = await getPilClient()
        .from("submission_queue")
        .select("id, organization_id, funder_id, priority, status, automation_mode, scheduled_for, created_at")
        .eq("organization_id", context.orgId)
        .eq("status", "pending")
        .lt("created_at", staleCutoff)
        .limit(MAX_ESCALATION_REMINDER_ITEMS);
      if (error) throw error;
      rows = (data ?? []) as LegacySubmissionQueueRow[];
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
      return 0;
    }
    if (rows.length === 0) return 0;

    await createReviewItem({
      organization_id: context.orgId,
      review_type: "high_impact_action",
      subject_type: "submission_queue",
      subject_id: context.runId,
      requested_by_agent_id: context.agentCode,
      priority: "urgent",
      status: "pending",
      summary: `${rows.length} submission_queue item(s) have sat 'pending' for more than ${ESCALATION_STALE_DAYS} days without being submitted -- reassign or confirm whether these should still go out.`,
      evidence_refs: [],
      assigned_to_user_id: null,
      resolved_at: null,
    });
    return rows.length;
  }

  private async tryModelTokens(context: AgentContext, runner: AgentRunner, units: number): Promise<number> {
    if (units <= 0 || !context.tools.includes("T-MODEL")) return 0;
    try {
      await runner.useTool(context, "T-MODEL", { unitCost: MODEL_TOKEN_UNIT_COST_USD, units, costType: "model_tokens" });
      return units;
    } catch {
      return 0;
    }
  }

  private completed(conclusions: Record<string, unknown>, reason: string): AgentResult {
    return {
      status: "completed",
      evidence: [],
      conclusions: { skipped: true, reason, ...conclusions },
      delegations: [],
      tokensUsed: 0,
      costUsd: 0,
      error: null,
    };
  }
}

export default SubmissionOrchestratorAgent;
