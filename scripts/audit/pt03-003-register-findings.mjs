// PT-03-003 -- register the real, reproduced finding from PT-03-002's core
// signup-to-deadline journey (test-evidence/pt-03/core-journey.json and
// test-evidence/pt-03/stage4-draft-persistence-diagnostic.json). Continues
// numbering from WGR-128.
// ASCII only. Node 20 compatible.

import { appendFindingRow } from "./evidence-lib.mjs";

appendFindingRow({
  id: "WGR-129",
  layer: "API/AI-Drafts",
  severity: "P0",
  description:
    "PT-03-002 core journey stage 4 (draft generation): POST /api/ai/draft can return a genuine " +
    "HTTP 200 with a full, real generated draft while persisting ZERO rows to draft_versions -- " +
    "confirmed via an isolated diagnostic (test-evidence/pt-03/stage4-draft-persistence-diagnostic.json) " +
    "that called the real, unmodified route directly inside an authenticated Playwright browser " +
    "context (bypassing only the UI's own event handlers, not auth or routing): a real 31727-byte " +
    "grant narrative came back with status 200 in 122365ms, agent_runs recorded " +
    "status='completed' (agent_type='narrative_drafting', duration_ms=117498, tokens_used=7783 -- a " +
    "real, successful, well-under-budget Claude call), yet `select count(*) from draft_versions " +
    "where organization_id=<org>` was 0 both immediately after and on a later re-check. Root cause, " +
    "confirmed by direct code + schema reads: draft_versions.version_number is NOT NULL with no " +
    "column default; 009_draft_versions.sql's own design (see its header comment) is that a BEFORE " +
    "INSERT trigger, trg_set_draft_version_number, assigns it so 'application code never supplies " +
    "it' -- and generateDraft() (src/lib/drafts/generator.ts, insert at ~line 966-993) indeed never " +
    "sets it. That trigger was absent from the local Supabase stack this PT-03 phase runs " +
    "against (pg_trigger for draft_versions returned zero non-internal rows before this session's " +
    "fix) -- the same class of local-schema gap this session's own pt03-002-core-journey.mjs " +
    "already found and fixed once for `programs`/`pipeline_history` (see that script's header " +
    "comment), now fixed a third time for this trigger, applied directly to the local, " +
    "non-production stack only. But the finding is broader than one local-stack gap: " +
    "generateDraft()'s draft_versions insert is deliberately best-effort -- on ANY insert error it " +
    "only console.error()s 'DRAFT VERSION SAVE ERROR' and leaves savedVersion:null, never throwing, " +
    "so /api/ai/draft (route.ts) returns the same 200 + full draftText/confidenceScore regardless " +
    "of whether the DB write actually succeeded. The client, src/app/(dashboard)/draft-generator/" +
    "page.tsx (~line 950, inside handleGenerate()), compounds this: its own comment reads 'The " +
    "draft was already auto-saved to draft_versions by the API' and it never checks " +
    "payload.savedVersion for null before calling setDraftText(...) and letting " +
    "handleGenerateClick() advance the wizard to the Review & Export step (setStep(4)) -- so a " +
    "savedVersion:null response renders identically to a real save, and a page reload loses the " +
    "draft completely (no draft_versions row to restore from; the applications.draft_content " +
    "mirror in generateDraft() at ~line 996-1025 is also a no-op at this point in the journey, " +
    "since it only fires when an applications row already exists, which it does not yet -- Apply " +
    "happens in a later journey stage). Separately, a full end-to-end run of the same stage through " +
    "the real UI (not the isolated diagnostic) hit a second, correlated symptom: an otherwise " +
    "identical draft-generation call was still status='running' in agent_runs (duration_ms and " +
    "tokens_used both still null) after this test's own 480s client-side wait elapsed and the " +
    "harness tore down the dev server -- real, observed latency variance (122s in one case, over " +
    "320s and still in flight in another) against the app's own maxDuration=300 budget, which " +
    "local `next dev` does not enforce but Vercel production does; a kill at that boundary in " +
    "production would terminate generateDraft() before its own catch block could mark agent_runs " +
    "'failed', reproducing the exact stuck-'running'-forever failure mode described (for a prior, " +
    "already-fixed 60s-limit incident) in route.ts's own maxDuration comment -- recoverable today " +
    "only via the existing >2-hour 'Clear Stuck Jobs' admin sweep already documented for a " +
    "different table in WGR-125, and with zero client-side feedback in the interim (draft-generator " +
    "page.tsx's fetch to /api/ai/draft has no AbortController/timeout of its own). 009_draft_versions.sql " +
    "is recorded as fully APPLIED in MIGRATION_AUDIT.md's production structural audit, so " +
    "production's draft_versions table and version_number column almost certainly exist -- but that " +
    "audit's own stated methodology (CREATE TABLE / ADD COLUMN presence) does not cover trigger " +
    "objects, so whether production's trg_set_draft_version_number trigger is itself currently live " +
    "was NOT independently re-verified by this session and is flagged here as a residual gap for a " +
    "future pass, not assumed either way. Regardless of that open question, the silent-swallow-and-200 " +
    "pattern is a real, reproducible robustness gap on its own: any future drift that breaks this " +
    "trigger (a migration rollback, a manual DDL change, a differently-provisioned environment, a " +
    "transient DB error under load) reproduces total, silent draft loss with zero test coverage " +
    "catching it and zero user-facing signal, compounded by the client's unconditional trust in a " +
    "200 response.",
  evidencePath:
    "test-evidence/pt-03/stage4-draft-persistence-diagnostic.json (isolated root-cause reproduction), " +
    "test-evidence/pt-03/core-journey.json#stages[3] (draft) and #findings[0] (PT03-002-F01) " +
    "(full-journey run showing the correlated latency/orphaned-run symptom), " +
    "test-evidence/pt-03/screenshots/04-draft-*.png",
  reproduction:
    "node --import tsx scripts/audit/pt03-002-core-journey.mjs (stage 4) against the local " +
    "pt05-local-stack; or independently, with a real authenticated session: POST /api/ai/draft " +
    "{opportunityId,templateType:'grant_narrative'}, then compare `select count(*) from " +
    "draft_versions where organization_id=<org>` against `select status, duration_ms, tokens_used " +
    "from agent_runs where organization_id=<org> and agent_type='narrative_drafting' order by " +
    "created_at desc limit 1` in the same window; `select tgname from pg_trigger where " +
    "tgrelid='draft_versions'::regclass and not tgisinternal` shows whether " +
    "trg_set_draft_version_number is present on the target database.",
  scopeTag: "CONFIRMED-BROKEN",
});
