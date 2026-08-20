// PT-03-005 -- register the 5 findings from PT-03's kanban-transition/auth-flow pass
// (test-evidence/pt-03/kanban-auth.json, findings PT03-KA-F01..F04) and the queue-panel
// error-surfacing finding from the autoapply/donor-discovery pass
// (test-evidence/pt-03/autoapply-donor-journeys.json, finding PT03-004-F01) that were
// captured in their own evidence files but never appended to WIRING_GAP_REGISTER.md.
// Continues numbering from WGR-129 (PT-03's own first row, already registered).
// ASCII only. Node 20 compatible.

import { appendFindingRow } from "./evidence-lib.mjs";

// -- WGR-130: executeTransition() has no server-side/reusable-function enforcement of the
// stage-transition graph; a direct call with an illegal stage-skip target persisted. --
appendFindingRow({
  id: "WGR-130",
  layer: "API/Kanban",
  severity: "P0",
  description:
    "PT03-KA-F02 (test-evidence/pt-03/kanban-auth.json, kanban.enforcement_gap_tests[0]): " +
    "getTransitionRule(discovered, drafting) correctly reports this stage-skip as illegal " +
    "(allowed=false, reason=\"Applications can't skip stages. From 'Discovered' you can only " +
    "advance to 'Eligibility Review'.\"), but executeTransition() (src/components/applications/" +
    "pipeline.ts, ~line 526) itself performs no such check -- it is the pipeline's own exported, " +
    "reusable function, and StageTransitionModal.tsx is the ONLY call site that checks " +
    "getTransitionRule() before invoking it. Calling executeTransition() directly (as any other " +
    "caller -- a future UI surface, a script, an API route -- would have to, since the rule check " +
    "lives in the modal component, not the function) silently persisted the illegal skip: " +
    "applications.stage was written to 'drafting' and a pipeline_history row was created " +
    "recording from_stage='discovered', to_stage='drafting' as if it were a normal, legal " +
    "transition. Confirmed live against a real authenticated org-scoped session, real application " +
    "row (id=24b7e15f-3a0a-4d26-80b0-bedfff6725b5): write_threw=false, write_error=null, " +
    "stage_after='drafting', outcome='PERSISTED'. There is no API route for application-stage " +
    "mutation at all (confirmed by repo-wide search) -- the ONLY server-adjacent code path is " +
    "this one client-callable function, and it enforces nothing itself.",
  evidencePath:
    "test-evidence/pt-03/kanban-auth.json#findings[1] (PT03-KA-F02), " +
    "#kanban.enforcement_gap_tests[0] (executeTransition_direct_bypass), " +
    "#kanban.journeys (12-stage transition_matrix + 3 full journeys, 80 legal transitions " +
    "confirmed persisting correctly, establishing this is a targeted bypass of a real, mostly-" +
    "correct rule set -- not a broken rule set)",
  reproduction:
    "node --import tsx scripts/audit/pt03-005-kanban-auth.mjs against the local pt05-local-stack; " +
    "or independently, with a real authenticated session: call " +
    "executeTransition({supabase, applicationId, fromStage:'discovered', toStage:'drafting'}) " +
    "directly (bypassing StageTransitionModal.tsx's own canConfirm/getTransitionRule() pre-check), " +
    "then `select stage from applications where id=<id>` and `select from_stage,to_stage from " +
    "pipeline_history where application_id=<id> order by created_at desc limit 1` -- both will " +
    "reflect the illegal skip as if it were legal.",
  scopeTag: "CONFIRMED-BROKEN",
});

// -- WGR-131: a raw applications.update({stage}) call, entirely outside executeTransition(),
// persists with no rejection -- RLS and the DB schema provide zero backstop on stage value. --
appendFindingRow({
  id: "WGR-131",
  layer: "Data/RLS",
  severity: "P0",
  description:
    "PT03-KA-F03 (test-evidence/pt-03/kanban-auth.json, kanban.enforcement_gap_tests[1]): a raw " +
    "supabase.from('applications').update({stage:'awarded'}) call -- with NO call to " +
    "executeTransition() at all, i.e. bypassing WGR-130's already-broken enforcement layer " +
    "entirely -- against a 'discovered'-stage row, from a real authenticated session that is a " +
    "genuine member of the row's own organization, persisted with no error. The " +
    "applications_org_isolation RLS policy (migration 001) scopes rows by organization_id only; " +
    "it places no constraint on what value 'stage' may be set to, or on which prior stage value a " +
    "given target is reachable from. There is no CHECK constraint, trigger, or any other " +
    "database-level mechanism enforcing BEHAVIORAL_CONTRACTS Sec6's transition graph. Confirmed " +
    "live: real application row (id=16705441-eee5-46a2-b056-3c65eb94b95e), from='discovered', " +
    "to='awarded' (skipping 10 of the 12 documented stages in one write), supabase_error=null, " +
    "stage_after='awarded', outcome='PERSISTED'. Any authenticated writer-or-above session in the " +
    "org (or a bug in any future UI surface that writes this column directly) can set any " +
    "application straight to any terminal stage from any starting stage with a single REST call.",
  evidencePath:
    "test-evidence/pt-03/kanban-auth.json#findings[2] (PT03-KA-F03), " +
    "#kanban.enforcement_gap_tests[1] (raw_update_bypass)",
  reproduction:
    "node --import tsx scripts/audit/pt03-005-kanban-auth.mjs against the local pt05-local-stack; " +
    "or independently, with a real authenticated org-member session: " +
    "supabase.from('applications').update({stage:'awarded'}).eq('id', <a discovered-stage row " +
    "belonging to the caller's own org>) -- the write succeeds with no error regardless of the " +
    "row's current stage.",
  scopeTag: "CONFIRMED-BROKEN",
});

// -- WGR-132: canMoveToStage()'s owner/admin-only rule for submitted-stage transitions is
// enforced only in the modal's client-side pre-submit check; a viewer-role session's direct
// write persisted the same transition. --
appendFindingRow({
  id: "WGR-132",
  layer: "Frontend/Kanban",
  severity: "P1",
  description:
    "PT03-KA-F01 (test-evidence/pt-03/kanban-auth.json, kanban.enforcement_gap_tests[2]): " +
    "canMoveToStage() says only owner/admin may move an application to 'submitted', but a " +
    "'viewer'-role session's direct executeTransition() call persisted the exact same transition. " +
    "The role gate is enforced only in StageTransitionModal.tsx's client-side canConfirm check -- " +
    "executeTransition() itself, and the database (the same applications_org_isolation RLS policy " +
    "already found role-blind in WGR-131), apply no equivalent check. Confirmed live: real " +
    "application row (id=3ae4666e-d42d-4da8-81da-d4f00509e6a1), canMoveToStage_viewer=false, " +
    "canMoveToStage_owner=true (the rule itself is correctly asymmetric), " +
    "viewer_attempted_write=true, viewer_write_threw=false, viewer_error=null, " +
    "stage_before='ready_for_review', stage_after='submitted', " +
    "outcome='PERSISTED_DESPITE_ROLE_RULE'. Rated P1 rather than P0 (unlike WGR-130/131) because " +
    "the transition itself IS a legal one per the stage graph (ready_for_review -> submitted, " +
    "compliance_check condition) -- the gap is narrower: which role may perform an otherwise-legal " +
    "transition, not whether an illegal one can be forced through at all.",
  evidencePath:
    "test-evidence/pt-03/kanban-auth.json#findings[0] (PT03-KA-F01), " +
    "#kanban.enforcement_gap_tests[2] (role_gate_bypass), " +
    "#kanban.journeys[2] (journey C, step 'role-gate bypass: viewer-role session executes " +
    "ready_for_review -> submitted')",
  reproduction:
    "node --import tsx scripts/audit/pt03-005-kanban-auth.mjs against the local pt05-local-stack; " +
    "or independently: as a real 'viewer'-role session, call executeTransition() directly " +
    "(bypassing StageTransitionModal.tsx's own canMoveToStage() pre-check) on a " +
    "'ready_for_review'-stage application targeting 'submitted' -- the write succeeds despite " +
    "canMoveToStage(role='viewer', ...) itself correctly returning false for this transition.",
  scopeTag: "CONFIRMED-BROKEN",
});

// -- WGR-133: password-reset recovery links are falsely rejected as invalid under `next dev`
// due to a React Strict Mode double-invoke race in the mount effect's code exchange. --
appendFindingRow({
  id: "WGR-133",
  layer: "Auth/PKCE",
  severity: "P0",
  description:
    "PT03-KA-F04 (test-evidence/pt-03/kanban-auth.json, findings[3]; also " +
    "auth_flows.password_reset, outcome='FAIL'): a real, freshly-issued recovery link (not " +
    "expired, not reused, real Mailpit-delivered email) was rejected by /reset-password as " +
    "invalid ('This link is no longer valid'), even though the underlying PKCE code exchange " +
    "genuinely succeeds server-side. Root-caused by direct, temporary instrumentation of " +
    "ResetPasswordPageClient.tsx (added then reverted -- confirmed via `git diff` this repo " +
    "carries no trace of it): its mount useEffect calls " +
    "supabase.auth.exchangeCodeForSession(code) with no idempotency guard (no ref/flag preventing " +
    "a repeat call, no AbortController, no cleanup). Because this app has reactStrictMode: true " +
    "(next.config.mjs), React double-invokes every effect on every mount in `next dev` -- exactly " +
    "the local/branch execution context this audit program runs against. The two invocations race " +
    "for the single-use PKCE code_verifier stored in the sb-127-auth-token-code-verifier cookie: a " +
    "real network response (200, confirmed via response capture) shows the exchange DOES succeed " +
    "and a real session is briefly established, but the losing invocation's own " +
    "exchangeCodeForSession call then fails with AuthPKCECodeVerifierMissingError (the verifier " +
    "was already consumed) and calls setLinkError(true) unconditionally, with no check for " +
    "whether a sibling invocation already succeeded -- so the user is shown a false " +
    "link-is-invalid error for a link that was, in fact, exchanged successfully. Reproduced " +
    "deterministically across three separate diagnostic runs, with the target route pre-warmed to " +
    "rule out a Next.js dev-server first-compile/Fast-Refresh remount as the cause. Not " +
    "independently verified against a production build (`next build && next start`, where Strict " +
    "Mode's double-invoke does not occur) in this session -- registered as a real, currently-" +
    "reproducing `next dev` defect, not asserted as confirmed-impacting in production. Practical " +
    "effect observed live: the /reset-password form was never reachable through the UI (the " +
    "link-invalid error block renders instead), so no new password could be submitted; an " +
    "independent post-hoc check against GoTrue directly confirmed the old password still works " +
    "and the intended new password was never accepted -- the password was genuinely never changed.",
  evidencePath:
    "test-evidence/pt-03/kanban-auth.json#findings[3] (PT03-KA-F04), " +
    "#auth_flows.password_reset (outcome=FAIL, full step-by-step trace including the independent " +
    "GoTrue re-verification), test-evidence/pt-03/screenshots/auth-01-forgot-password-sent.png, " +
    "test-evidence/pt-03/screenshots/auth-02-reset-password-complete.png",
  reproduction:
    "node --import tsx scripts/audit/pt03-005-kanban-auth.mjs against the local pt05-local-stack " +
    "(reactStrictMode: true, next.config.mjs); or independently, under `next dev` only: request a " +
    "real password reset, follow the real recovery link to /reset-password, and observe that a " +
    "genuinely valid, first-use link renders 'This link is no longer valid' due to " +
    "exchangeCodeForSession() being called twice by React's Strict Mode double-invoke of the " +
    "mount effect in ResetPasswordPageClient.tsx.",
  scopeTag: "CONFIRMED-BROKEN",
});

// -- WGR-134: AutoApply's QUEUE mini-panel silently shows "Queue is empty" on a real load
// failure instead of surfacing the error, unlike the Session List table on the same page. --
appendFindingRow({
  id: "WGR-134",
  layer: "Frontend/AutoApply",
  severity: "P3",
  description:
    "PT03-004-F01 (test-evidence/pt-03/autoapply-donor-journeys.json, findings[0]): " +
    "src/app/(dashboard)/autoapply/page.tsx's 'QUEUE' mini-panel (~line 634) shows 'Queue is " +
    "empty.' on any loadQueue() failure (queue.length===0), not just a genuine empty queue -- it " +
    "never checks queueError, unlike the Session List table ~200 lines below on the same page, " +
    "which does check and surface it. Reproduced live this session via a real PGRST200 error " +
    "('Could not find a relationship between submission_queue and funders') from a genuine local-" +
    "schema gap (submission_queue had no FK to funders on this stack, unlike the real migration), " +
    "with a real authenticated session token -- the panel rendered the same 'Queue is empty.' text " +
    "it would show for a genuinely empty queue, giving no indication anything had gone wrong. " +
    "Rated P3 (not the higher severity of the kanban-enforcement findings above) since this is a " +
    "cosmetic error-surfacing gap on a single dashboard widget, not a data-integrity or access-" +
    "control bypass -- the underlying queue data itself is not lost or corrupted, and the fuller " +
    "Session List table on the same page does surface the equivalent failure correctly.",
  evidencePath:
    "test-evidence/pt-03/autoapply-donor-journeys.json#findings[0] (PT03-004-F01)",
  reproduction:
    "code read: src/app/(dashboard)/autoapply/page.tsx lines 632-635 (QUEUE panel, checks only " +
    "queue.length===0) vs lines 835-836 (Session List table, checks queueError explicitly); or " +
    "live: force loadQueue()'s submission_queue-to-funders embedded-select query to fail (e.g. " +
    "temporarily drop the FK on a non-production stack) and observe the QUEUE panel renders " +
    "'Queue is empty.' with no error indication while the Session List table below it does show " +
    "an error state.",
  scopeTag: "CONFIRMED-BROKEN",
});

console.log("PT-03-005: appended WGR-130 through WGR-134 to WIRING_GAP_REGISTER.md.");
