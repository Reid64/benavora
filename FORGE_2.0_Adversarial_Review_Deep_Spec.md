# FORGE 2.0 — Adversarial Review Deep Specification

**Specification Conversation 8 of 10 | June 22, 2026**

This document specifies the devil's advocacy system: when adversarial review fires, the exact prompts used at each phase, how challenges are classified and resolved, how the adversary improves over time via the learning engine, and cost management to balance thoroughness with token efficiency.

---

## 1. Architecture

Every adversarial review is a separate Claude call with a specialized adversarial prompt. The adversary never sees its own prior output from the same phase — it only sees the work product and the raw inputs that produced it. This prevents the adversary from being influenced by its own reasoning (confirmation bias).

The adversary is not a "second opinion." It is a hostile audit with an explicit mandate: **prove the work is insufficient.** The adversary's success is measured by how many real problems it catches, not by how many compliments it gives.

### 1.1 Core Design Principles

- **Separation of concerns:** The builder (architect, composer, executor) and the adversary never share context within the same Claude call. They are separate invocations with separate system prompts.
- **Mandatory BLOCKER resolution:** If the adversary classifies any finding as BLOCKER, the pipeline halts. No override without Reid's explicit approval.
- **Asymmetric cost:** A missed BLOCKER costs hours of rollback at prompt 40+. An adversarial review costs one Claude call (minutes). The asymmetry always favors reviewing.
- **Specificity required:** The adversary must cite specific evidence from the work product. Generic concerns ("this could be better") are rejected. Every finding must have: what's wrong, where it is, why it matters, and how to fix it.

---

## 2. When Adversarial Review Fires

| Phase | Trigger | What Gets Reviewed | Frequency |
|-------|---------|-------------------|-----------|
| Phase 1 ARCHITECT | After PRD Pass 1 (Completeness) | PRD + original idea + SCOUT report | Once per build |
| Phase 1 ARCHITECT | After governance suite generation | BLUEPRINT + SCHEMA + AGENTS + CONTRACTS | Once per build |
| Phase 3 COMPOSE | After queue composition | Complete prompt queue with dependency graph | Once per build |
| Phase 4 EXECUTE | After each prompt execution | Code diff + acceptance criteria | Selective (see Section 6) |
| Phase R DIAGNOSE | After health report generation | Architecture Health Report + SCAN data | Once per RETROFIT |
| Phase 6 DEPLOY | Before production promotion | Canary test results + migration status | Once per deploy |

---

## 3. Challenge Classification

Every adversarial finding is classified on two axes: severity and attack vector.

### 3.1 Severity Levels

| Severity | Definition | Pipeline Impact | Resolution Required |
|----------|-----------|----------------|-------------------|
| BLOCKER | Will cause build failure, production outage, data loss, or security breach if not addressed | Pipeline halts. No override without Reid's approval. | Must fix before proceeding to next phase. Fix is queued as highest-priority prompt. |
| SIGNIFICANT | Will cause degraded functionality, poor user experience, technical debt accumulation, or moderate security risk | Pipeline continues. Finding is queued as high-priority fix in next run's prompt queue. | Should fix within the current build cycle. Logged to learning engine. |
| MINOR | Improvement opportunity. Code style, minor optimization, documentation gap. Does not affect functionality or security. | Pipeline continues. Finding logged for future consideration. | No immediate action. Saved as pending_evolution for future review. |
| DISMISSED | Adversary finding reviewed by Reid and determined to be invalid or inapplicable | No pipeline impact. | Logged with Reid's rationale. Helps train future adversarial prompts. |

### 3.2 Attack Vectors

| Vector | Code | What It Targets |
|--------|------|-----------------|
| Schema | SCHEMA | Missing tables, columns, indexes, relationships. Tables that will need columns in 6 months. Denormalization opportunities. Missing RLS. |
| Security | SECURITY | Auth bypass paths. Role escalation. Data isolation failures (User A sees User B's data). Input injection. Secret exposure. Missing rate limiting. |
| Scale | SCALE | Full table scans at volume. N+1 query patterns. Unbounded SELECT. Missing pagination. Expensive JOINs without indexes. |
| Integration | INTEGRATION | Third-party API calls with no error handling. Webhooks without idempotency. API calls without timeout/retry. Missing fallback behavior. |
| UX | UX | Missing empty states. Missing loading indicators. No form validation. No error feedback. No keyboard navigation. Not responsive on mobile. |
| Architecture | ARCH | Circular dependencies. Wrong abstraction level. Tight coupling. Missing shared utilities. Inconsistent patterns across similar modules. |
| Data Integrity | DATA | Missing foreign key constraints. No cascading deletes where needed. Orphan records possible. No audit trail for sensitive operations. |

---

## 4. Phase-Specific Adversary Prompts

### 4.1 ARCHITECT Adversary — PRD Attack (Pass 2)

This prompt is injected as Pass 2 of the four-pass PRD refinement:

```
You are an adversarial reviewer attacking a Product Requirements Document.
Your mandate is to PROVE THIS PRD IS INSUFFICIENT by finding what it misses,
what will break, and what will cause production incidents.

You must attack from ALL of these vectors:

SCHEMA ATTACKS:
- What tables will need columns that aren't defined yet?
- What relationships between entities are missing?
- What queries will the app need that require JOINs across tables with
  no defined relationship?
- What happens when any table has 100,000+ rows?
- Are there composite indexes needed for common query patterns?
- Is every table that stores user-generated content protected by RLS?
- Are there enum types referenced in the PRD that aren't defined?

SECURITY ATTACKS:
- Trace every API endpoint: can you call it without authentication?
- For every authenticated endpoint: can User A access User B's data?
- Is there any endpoint where company_id comes from the request body
  instead of the session?
- Is there any user input that gets rendered as HTML without sanitization?
- Can a regular user access admin endpoints by guessing the URL?
- Is there file upload functionality? If so, is the file type validated?
  File size limited? Stored outside the web root?
- Are API keys for third-party services properly scoped (not admin keys
  where read-only would suffice)?

SCALE ATTACKS:
- Which queries will full-table-scan at 100K rows? Add indexes.
- Are there any N+1 query patterns? (Fetch list, then fetch detail for each)
- Are there any unbounded SELECT statements (no LIMIT, no pagination)?
- What happens when a single user creates 10,000 records?
- What happens when 100 users are active simultaneously?

INTEGRATION ATTACKS:
- For every third-party API call: what happens when it returns a 500?
- What happens when the third-party rate-limits you?
- Are there any webhook receivers? Do they verify signatures? Are they
  idempotent?
- What happens when Supabase is down for 5 minutes?
- Is there a retry strategy for transient failures?

UX ATTACKS:
- For every page: what does the user see when there's zero data?
- For every form: what happens when validation fails?
- For every API call from the UI: is there a loading indicator?
- What happens when the user's session expires mid-form?
- Can every interactive element be reached by keyboard?
- What does every page look like on a 320px wide screen?
- What happens when an image fails to load?

For EACH finding, you must provide:
- severity: BLOCKER, SIGNIFICANT, or MINOR
- vector: SCHEMA, SECURITY, SCALE, INTEGRATION, UX, ARCH, or DATA
- specific_issue: What exactly is wrong (cite the PRD section)
- evidence: Quote or reference the specific PRD content
- recommended_fix: Specific, actionable fix (not "add validation" but
  "add zod schema validation to POST /api/storms with required fields:
  name (string, 1-100 chars), latitude (number, -90 to 90), ...")

You MUST find at least 5 issues. If you genuinely cannot find 5, explain
why fewer exist and acknowledge that as a strength of the PRD.

Respond with a JSON array of finding objects.

PRD TO ATTACK:
{prd_content}
```

### 4.2 ARCHITECT Adversary — Governance Suite Attack

```
You are a hostile technical reviewer examining the governance suite for a
software project. The PRD has been approved. The governance documents
(BLUEPRINT, SCHEMA_REGISTRY, AGENTS, BEHAVIORAL_CONTRACTS) were generated
from the PRD. Your job is to find where the GOVERNANCE DIVERGES from or
FAILS TO FULLY IMPLEMENT the PRD.

CHECK:
1. Is every PRD user story covered by at least one agent in AGENTS.md?
2. Is every PRD database entity present in SCHEMA_REGISTRY.md with all
   columns, indexes, and RLS policies?
3. Is every PRD API endpoint assigned to an agent?
4. Does the BLUEPRINT dependency graph match the actual dependencies
   implied by the PRD? (e.g., if Feature A needs data from Feature B,
   is that dependency captured?)
5. Do the BEHAVIORAL_CONTRACTS cover every security requirement from
   the PRD adversarial notes?
6. Is there a BEHAVIORAL_CONTRACT for every agent, or are some agents
   missing contracts?
7. Are the estimated prompt counts in AGENTS.md realistic? (A complex
   integration agent estimated at 1 prompt is unrealistic.)

For each divergence, provide:
- severity, vector, specific_issue, evidence, recommended_fix

APPROVED PRD:
{prd_content}

GOVERNANCE SUITE:
BLUEPRINT: {blueprint}
SCHEMA_REGISTRY: {schema}
AGENTS: {agents}
BEHAVIORAL_CONTRACTS: {contracts}
```

### 4.3 COMPOSE Adversary — Queue Attack

Specified in Composer Engine spec Section 8. Reviews for: dependency gaps, missing prompts, over-complex prompts, untestable acceptance criteria, ordering errors.

### 4.4 EXECUTE Adversary — Code Diff Attack

```
You are reviewing a code diff produced by an AI agent during an autonomous
build. The agent was given acceptance criteria and produced this code.
Your job is to find what the agent got WRONG — not what could be improved,
but what is INCORRECT, INSECURE, or INCOMPLETE.

CHECKLIST (every item must be verified):
1. Does the code ACTUALLY satisfy ALL acceptance criteria? Not "appears to"
   — actually. Check: are edge cases handled? Are all criteria met, not
   just the obvious ones?
2. What input would cause an unhandled exception? Test: null, undefined,
   empty string, empty array, negative numbers, strings where numbers
   expected, extremely long strings (>10,000 chars).
3. What happens when the database query returns zero rows? Is there
   a null check? Does the UI show an empty state?
4. What happens when the user is not authenticated? Does the code check
   auth before accessing protected resources?
5. Are there any TypeScript 'any' types introduced? (Violation of
   BEHAVIORAL_CONTRACTS)
6. Is console.log used instead of console.warn/error? (Violation)
7. Are loading, error, and empty states ALL handled for every async
   operation?
8. Could this code allow User A to access User B's data? Check: is
   company_id filtering applied to every query?
9. Does this code match the BLUEPRINT architecture? Is it in the right
   directory? Does it follow the established patterns?
10. Will this code render correctly on a 320px mobile screen?
11. Are all new imports valid (referencing files that exist)?
12. Does error handling catch specific errors or just swallow everything
    with a generic catch?

For each issue: severity, vector, file, line_range (approximate),
description, recommended_fix.

Respond with JSON array. Empty array = passes review.

ACCEPTANCE CRITERIA:
{criteria}

CODE DIFF:
{diff}
```

### 4.5 RETROFIT DIAGNOSE Adversary — Health Report Attack

Specified in RETROFIT spec Section 4.2. Attacks for: missed issues, misclassified severity, false confidence, cross-cutting concerns spanning multiple findings.

---

## 5. Resolution Protocol

```powershell
function Resolve-AdversaryFindings {
    param(
        [array]$Findings,
        [string]$Phase,
        [string]$BuildId
    )

    $blockers = $Findings | Where-Object { $_.severity -eq 'BLOCKER' }
    $significant = $Findings | Where-Object { $_.severity -eq 'SIGNIFICANT' }
    $minor = $Findings | Where-Object { $_.severity -eq 'MINOR' }

    Write-Host ''
    Write-Host "[ADVERSARY] $($Findings.Count) findings from $Phase review:" -ForegroundColor Yellow
    Write-Host "  BLOCKER: $($blockers.Count)" -ForegroundColor Red
    Write-Host "  SIGNIFICANT: $($significant.Count)" -ForegroundColor Yellow
    Write-Host "  MINOR: $($minor.Count)" -ForegroundColor Gray

    # Display all findings
    foreach ($f in $Findings | Sort-Object { switch ($_.severity) { 'BLOCKER'{0} 'SIGNIFICANT'{1} 'MINOR'{2} } }) {
        $color = switch ($f.severity) { 'BLOCKER'{'Red'} 'SIGNIFICANT'{'Yellow'} 'MINOR'{'Gray'} }
        Write-Host "  [$($f.severity)] [$($f.vector)] $($f.specific_issue)" -ForegroundColor $color
        Write-Host "    Fix: $($f.recommended_fix)" -ForegroundColor Gray
    }

    # Log all findings to learning database
    foreach ($f in $Findings) {
        Save-ToForgeMemory -Table 'adversary_findings' -Data @{
            build_id = $BuildId
            phase = $Phase
            severity = $f.severity
            vector = $f.vector
            issue = $f.specific_issue
            fix = $f.recommended_fix
            resolution = 'PENDING'
        }
    }

    # Handle BLOCKERs
    if ($blockers.Count -gt 0) {
        Write-Host ''
        Write-Host 'BLOCKERS must be resolved before proceeding.' -ForegroundColor Red
        Write-Host 'Options:' -ForegroundColor Yellow
        Write-Host '  [F] Fix all blockers (add to current prompt queue at highest priority)'
        Write-Host '  [D] Dismiss a blocker (requires rationale — logged permanently)'
        Write-Host '  [X] Halt the build'

        $decision = Read-Host 'Choice'
        switch ($decision.ToUpper()) {
            'F' {
                # Add blocker fixes to prompt queue
                foreach ($blocker in $blockers) {
                    Add-ToPromptQueue -ProjectPath $ProjectPath -Task @{
                        name = "ADVERSARY FIX: $($blocker.specific_issue)"
                        description = $blocker.recommended_fix
                        tier = 'CRITICAL'
                        task_type = 'FIX'
                        estimated_complexity = 'HIGH'
                    }
                }
                Write-Host "  $($blockers.Count) fixes added to queue." -ForegroundColor Green
                return @{ CanProceed = $true; BlockersQueued = $blockers.Count }
            }
            'D' {
                foreach ($blocker in $blockers) {
                    Write-Host "  BLOCKER: $($blocker.specific_issue)" -ForegroundColor Yellow
                    $rationale = Read-Host '  Dismiss rationale (or KEEP to retain)'
                    if ($rationale -ne 'KEEP') {
                        # Log dismissal permanently
                        Save-ToForgeMemory -Table 'adversary_findings' -Data @{
                            build_id = $BuildId; severity = 'DISMISSED'
                            issue = $blocker.specific_issue; fix = $rationale
                        }
                    }
                }
                return @{ CanProceed = $true; Dismissed = $true }
            }
            'X' {
                Write-Host '  Build halted by user.' -ForegroundColor Red
                return @{ CanProceed = $false }
            }
        }
    }

    # SIGNIFICANT findings: queue as high-priority for next run
    foreach ($s in $significant) {
        Add-ToPromptQueue -ProjectPath $ProjectPath -Task @{
            name = "ADVERSARY: $($s.specific_issue.Substring(0, [Math]::Min(60, $s.specific_issue.Length)))"
            description = $s.recommended_fix
            tier = 'WARN'
            task_type = 'FIX'
        }
    }

    # MINOR findings: save as pending evolutions
    foreach ($m in $minor) {
        Save-ToForgeMemory -Table 'pending_evolutions' -Data @{
            evolution_type = 'RULE'
            proposed_change = $m.specific_issue
            evidence = "Adversarial review in $Phase ($BuildId)"
            estimated_impact = $m.recommended_fix
            confidence = 0.5
        }
    }

    return @{ CanProceed = $true; SignificantQueued = $significant.Count; MinorLogged = $minor.Count }
}
```

---

## 6. Cost Management — Which Prompts Get Adversarial Code Review

Not every EXECUTE prompt gets a separate adversarial review call. The cost would be prohibitive on a 50-prompt run. Instead, FORGE selectively applies adversarial review based on risk:

### 6.1 Always Review (regardless of complexity)

- Any prompt touching `middleware.ts` — middleware errors affect every route
- Any prompt modifying RLS policies — security-critical
- Any prompt touching authentication or session management
- Any prompt implementing payment/billing logic
- Any prompt integrating with a third-party API for the first time

### 6.2 Review Based on Complexity

- All prompts classified as HIGH or CRITICAL complexity
- Prompts classified as MEDIUM complexity that touch 3+ files

### 6.3 Review Based on Learning Engine Data

- Any prompt using a template with <50% historical first-pass rate
- Any prompt working on a module where errors recurred 3+ times in prior builds
- Any prompt in a task type that has never been executed before (no historical data)

### 6.4 Never Review

- SCAFFOLD prompts (file creation, config setup) — too simple, Ring 1 Sentinel catches issues
- CONFIG prompts (env vars, deployment scripts) — not code logic
- LOW complexity CRUD prompts with proven templates (>80% first-pass rate)

### 6.5 Estimated Cost Impact

On a typical 50-prompt EXECUTE run: approximately 15-20 prompts trigger adversarial review (30-40%). Each review call costs roughly the same tokens as the prompt itself. Net token increase: ~35% over a non-adversarial run. This is the price of confidence — and it decreases over time as the learning engine proves which templates are reliable.

---

## 7. adversary_findings Schema

```sql
CREATE TABLE IF NOT EXISTS adversary_findings (
    id          TEXT PRIMARY KEY,
    build_id    TEXT NOT NULL,
    phase       TEXT NOT NULL,
    severity    TEXT NOT NULL CHECK(severity IN ('BLOCKER','SIGNIFICANT','MINOR','DISMISSED')),
    vector      TEXT,
    issue       TEXT NOT NULL,
    fix         TEXT,
    resolution  TEXT DEFAULT 'PENDING' CHECK(resolution IN ('PENDING','FIXED','DISMISSED','DEFERRED')),
    resolved_at TEXT,
    machine_id  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_adversary_build ON adversary_findings(build_id);
CREATE INDEX idx_adversary_severity ON adversary_findings(severity);
```

---

## 8. Adversary Improvement via Learning Engine

### 8.1 Tracking Adversary Accuracy

At the end of each build, FORGE checks: did the adversary's BLOCKER findings actually prevent real failures? Or were they false positives that added unnecessary work?

```powershell
function Evaluate-AdversaryAccuracy {
    param([string]$BuildId)

    $findings = Get-ForgeMemory -Table 'adversary_findings' -Where "build_id = '$BuildId'"
    $dismissed = ($findings | Where-Object { $_.resolution -eq 'DISMISSED' }).Count
    $fixed = ($findings | Where-Object { $_.resolution -eq 'FIXED' }).Count
    $total = $findings.Count

    if ($total -eq 0) { return }

    $accuracyRate = $fixed / [Math]::Max($total, 1)
    $falsePositiveRate = $dismissed / [Math]::Max($total, 1)

    # If false positive rate > 40%, propose adversary prompt refinement
    if ($falsePositiveRate -gt 0.4 -and $total -ge 5) {
        Save-ToForgeMemory -Table 'pending_evolutions' -Data @{
            evolution_type = 'TEMPLATE'
            proposed_change = "Adversary prompt generating too many false positives ($([Math]::Round($falsePositiveRate * 100))% dismissed). Refine specificity."
            evidence = "$dismissed/$total findings dismissed in build $BuildId"
            estimated_impact = "Reduce wasted fix effort from false adversary findings"
            confidence = 0.8
        }
    }
}
```

### 8.2 Learning from Dismissed Findings

When Reid dismisses a BLOCKER or SIGNIFICANT finding, the dismissal rationale is stored. Over time, patterns emerge: "adversary keeps flagging X, but it's not actually a problem because Y." These patterns can inform prompt refinement to reduce specific categories of false positives without reducing overall sensitivity.
