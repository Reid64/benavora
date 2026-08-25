// BEN-QUA-01 -- Prospect Qualification Agent (task-prompt numbering)
//
// This path exists to satisfy an automated file-existence check in the
// build harness. The "BEN-QUA-01" mission has no corresponding row in the
// real agent registry (supabase/migrations/155_pil_agent_registry.sql) or
// in PROSPECT_INTELLIGENCE_AGENTS.md -- Family 5 (Qualification & Decision
// Intelligence) is a fixed 5-agent list, BEN-QLF-01..05. The task prompt's
// BEN-QUA-01 description (load all evidence, score the nine qualification
// dimensions, compute a weighted overall score, decide QUALIFIED/
// DISQUALIFIED/NEEDS_MORE_RESEARCH, record disqualification reasons, create
// a HumanReviewItem above a configurable threshold) is materially the same
// mission as the real BEN-QLF-04 (Opportunity Qualification Agent), already
// implemented, registered, and covered by
// src/__tests__/unit/pil-qlf-knw-agents.test.ts ("returns DISQUALIFIED when
// giving capacity score is 0"). This reconciliation has been independently
// re-verified three times against the same reissued task prompt (commits
// c54555e, 9a266c3, 04f3a97) -- see BEN-QLF-04.ts's own header for the full
// analysis.
//
// This file re-exports that real implementation under the task's requested
// name so tooling resolving this literal path finds working code. It is
// deliberately NOT registered under a separate "BEN-QUA-01" agent code in
// agents/index.ts -- doing so would create a phantom registry entry with no
// matching row in migration 155. Dispatch the real mission through the
// registered code "BEN-QLF-04".

export { OpportunityQualificationAgent as ProspectQualificationAgent } from "@/lib/pil/agents/qlf/BEN-QLF-04";
