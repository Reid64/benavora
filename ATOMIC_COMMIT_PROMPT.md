# CLAUDE CODE PROMPT — ATOMIC GOVERNANCE COMMIT 2026-05-23

**Target environment:** Claude Code (CC) on Windows, Tarritrix project root `C:\Users\manag\Documents\Tarritrix`
**Required flag:** `--dangerously-skip-permissions`
**Type:** Autonomous single-prompt execution
**Outcome:** One atomic git commit applying RBAC + A-44 governance synchronization across 7 files + 1 new file

---

## OPERATOR INSTRUCTION (PASTE THIS ENTIRE BLOCK TO CC)

You are Claude Code operating with `--dangerously-skip-permissions` in the Tarritrix project. Execute this prompt autonomously without permission prompts.

**Project root:** `C:\Users\manag\Documents\Tarritrix`
**Branch:** `master`
**Mission:** Apply the 2026-05-23 RBAC Architecture Lock + A-44 Phase 1 Relocation governance synchronization as a single atomic commit modifying 7 files and adding 1 new file.

---

## STEP 1 — PRE-CONDITIONS

Execute the following PowerShell commands sequentially. Abort the entire prompt with a clear error if any fails.

```powershell
cd C:\Users\manag\Documents\Tarritrix

# Confirm clean working tree
git status --porcelain
# Expected: empty output. If output is non-empty, abort with: "Working tree dirty — commit or stash before proceeding."

# Confirm on master branch
git branch --show-current
# Expected: "master". If not, abort with: "Not on master branch — checkout master before proceeding."

# Confirm remote sync
git fetch origin master
git status -uno
# Expected: "Your branch is up to date with 'origin/master'." If behind or ahead, abort with: "Branch out of sync with origin — sync before proceeding."

# Verify governance source files exist
$files = @(
  "BLUEPRINT.md",
  "MASTER_BUILD_SPEC.md",
  "SCHEMA_REGISTRY.md",
  "AGENTS.md",
  "BEHAVIORAL_CONTRACTS.md",
  "STATE_OF_THE_BUILD.md"
)
foreach ($f in $files) {
  if (-not (Test-Path $f)) {
    Write-Error "Missing source file: $f"
    exit 1
  }
}

# Capture pre-commit state for verification
Write-Host "=== PRE-COMMIT STATE ==="
foreach ($f in $files) {
  $lines = (Get-Content $f | Measure-Object -Line).Lines
  Write-Host "$f : $lines lines"
}

# Verify docs/architecture/ directory exists (or create it)
if (-not (Test-Path "docs\architecture")) {
  New-Item -ItemType Directory -Path "docs\architecture" -Force | Out-Null
  Write-Host "Created docs/architecture/ directory"
}
```

If all checks pass, proceed to Step 2. If any fail, abort and report the failure to the operator.

---

## STEP 2 — LOCATE DELTA DOCUMENTS

The operator has uploaded the 8 governance delta documents to the project. Locate them:

```powershell
# Expected delta document locations (operator uploads these as project knowledge):
# - ROLE_HIERARCHY_ARCHITECTURE_SPEC.md (canonical spec, ~1,046 lines)
# - BLUEPRINT_DELTA.md (Document 2)
# - MASTER_BUILD_SPEC_DELTA.md (Document 3)
# - SCHEMA_REGISTRY_DELTA.md (Document 4)
# - AGENTS_DELTA_REV1.md (Document 5, REV 1)
# - BEHAVIORAL_CONTRACTS_DELTA.md (Document 6)
# - STATE_OF_THE_BUILD_DELTA.md (Document 7)
# - GOVERNANCE_SYNC_CHANGE_LOG.md (Document 8, used for verification queries only)

# Search common upload locations
$searchPaths = @(
  ".\governance-deltas\",
  ".\docs\governance-deltas\",
  ".\.governance-staging\",
  "$env:USERPROFILE\Downloads\"
)

$deltaDocs = @{
  "ROLE_HIERARCHY_ARCHITECTURE_SPEC.md" = $null
  "BLUEPRINT_DELTA.md" = $null
  "MASTER_BUILD_SPEC_DELTA.md" = $null
  "SCHEMA_REGISTRY_DELTA.md" = $null
  "AGENTS_DELTA_REV1.md" = $null
  "BEHAVIORAL_CONTRACTS_DELTA.md" = $null
  "STATE_OF_THE_BUILD_DELTA.md" = $null
  "GOVERNANCE_SYNC_CHANGE_LOG.md" = $null
}

foreach ($docName in $deltaDocs.Keys) {
  foreach ($path in $searchPaths) {
    $candidate = Join-Path $path $docName
    if (Test-Path $candidate) {
      $deltaDocs[$docName] = (Resolve-Path $candidate).Path
      break
    }
  }
}

# Report findings
$missing = $deltaDocs.GetEnumerator() | Where-Object { $_.Value -eq $null }
if ($missing.Count -gt 0) {
  Write-Host "MISSING DELTA DOCUMENTS:"
  $missing | ForEach-Object { Write-Host "  - $($_.Key)" }
  Write-Host ""
  Write-Host "Cannot proceed without all 8 delta documents. Ask operator to upload missing files to one of:"
  $searchPaths | ForEach-Object { Write-Host "  - $_" }
  exit 1
}

Write-Host "All 8 delta documents located:"
$deltaDocs.GetEnumerator() | ForEach-Object { Write-Host "  $($_.Key) -> $($_.Value)" }
```

If any delta document is missing, abort and report to operator with the upload location list. Do not proceed without all 8.

---

## STEP 3 — APPLY CHANGES TO BLUEPRINT.md (6 SURGICAL CHANGES)

Read `BLUEPRINT_DELTA.md` and apply the 6 surgical changes specified in its Section 2 through Section 7. Each change has explicit "Lines being replaced" or "Insertion location" plus "Replacement content" or "Content to insert" blocks.

Specific changes to apply:

1. **Change 1 (Sections 2 of BLUEPRINT_DELTA):** REPLACE lines 4096–4114 of BLUEPRINT.md with the A-21/A-44 conflict resolution text from BLUEPRINT_DELTA Section 2.3
2. **Change 2 (Section 3):** INSERT Step 9 after line 2835 of BLUEPRINT.md with the auto A-44 ingestion text from BLUEPRINT_DELTA Section 3.3
3. **Change 3 (Section 4):** REPLACE lines 2837–2864 with the updated pipeline diagram from BLUEPRINT_DELTA Section 4.3
4. **Change 4 (Section 5):** INSERT Section 8.6.5 after line 3438 with role hierarchy + multi-user operations content from BLUEPRINT_DELTA Section 5.3
5. **Change 5 (Section 6):** INSERT Part 10.5 after line 4480 with the A-44 canonical Phase 1 spec from BLUEPRINT_DELTA Section 6.3
6. **Change 6 (Section 7):** INSERT Part 11 at end of file with the RBAC Architecture Lock content from BLUEPRINT_DELTA Section 7.3

**CRITICAL:** Line numbers refer to the PRE-COMMIT BLUEPRINT.md state. After Change 1 modifies line 4096–4114, subsequent insertions referencing higher line numbers in the original file are still correct — apply changes in REVERSE LINE ORDER (last change in file first, first change in file last) to preserve line number stability:

Recommended application order:
- First: Change 6 (INSERT at end of file)
- Then: Change 5 (INSERT after line 4480)
- Then: Change 1 (REPLACE lines 4096–4114)
- Then: Change 4 (INSERT after line 3438)
- Then: Change 3 (REPLACE lines 2837–2864)
- Last: Change 2 (INSERT after line 2835)

Verify after applying:
```powershell
$lines = (Get-Content BLUEPRINT.md | Measure-Object -Line).Lines
Write-Host "BLUEPRINT.md post-commit: $lines lines (expected ~4,961, tolerance ±50)"

# Critical content checks
$checks = @(
  @{Pattern="PART 11: RBAC ARCHITECTURE LOCK"; Expected=1; Name="Part 11 heading"}
  @{Pattern="Part 10\.5: A-44 CLIENT KNOWLEDGE INGESTION"; Expected=1; Name="Part 10.5 heading"}
  @{Pattern="A-21 Client Site Ingestion \(Phase 1 Mandatory\)"; Expected=0; Name="Old A-21 conflict text removed"}
)
foreach ($check in $checks) {
  $count = (Select-String -Path BLUEPRINT.md -Pattern $check.Pattern).Count
  if ($count -ne $check.Expected) {
    Write-Error "BLUEPRINT.md verification failed: $($check.Name) — expected $($check.Expected), got $count"
    git checkout BLUEPRINT.md
    exit 1
  }
}
Write-Host "BLUEPRINT.md verification: PASS"
```

---

## STEP 4 — APPLY CHANGES TO MASTER_BUILD_SPEC.md (13 SURGICAL CHANGES)

Read `MASTER_BUILD_SPEC_DELTA.md` and apply the 13 surgical changes specified in Sections 2 through 14 of that document.

Apply in reverse line order (highest line numbers first) to preserve line stability:

- Change 13: INSERT Section 25 after line 1140 (end of file)
- Change 12: REPLACE lines 1025–1036 (exit criteria)
- Change 11: INSERT after line 1010 (Phase 1 Dashboard scope additions)
- Change 10: REPLACE lines 408–421 (9-step wizard)
- Change 9: REPLACE lines 402–406 (page actions with role gating)
- Change 8: REPLACE lines 369–379 (flagged pages queue)
- Change 7: INSERT Tab 7 after line 364
- Change 6: REPLACE lines 281–290 (sidebar nav)
- Change 5: INSERT after line 295 (role-aware rendering rules)
- Change 4: REPLACE lines 292–295 (header role badge)
- Change 3: REPLACE lines 216–222 (authentication flow)
- Change 2: REPLACE lines 52–60 (systems list)
- Change 1: REPLACE lines 24–38 (agent count 14→15)

Verify:
```powershell
$lines = (Get-Content MASTER_BUILD_SPEC.md | Measure-Object -Line).Lines
Write-Host "MASTER_BUILD_SPEC.md post-commit: $lines lines (expected ~1,372, tolerance ±30)"

$checks = @(
  @{Pattern='^### Agents \(15\)'; Expected=1; Name="Agent count 15"}
  @{Pattern="user_roles"; ExpectedMin=10; Name="user_roles references"}
  @{Pattern="Tab 7.*Knowledge Base"; ExpectedMin=2; Name="Tab 7 Knowledge Base"}
  @{Pattern="Section 25.*RBAC AND A-44 PHASE 1"; Expected=1; Name="Section 25"}
)
foreach ($check in $checks) {
  $count = (Select-String -Path MASTER_BUILD_SPEC.md -Pattern $check.Pattern).Count
  $threshold = if ($check.Expected) { $check.Expected } else { $check.ExpectedMin }
  $passed = if ($check.Expected) { $count -eq $check.Expected } else { $count -ge $check.ExpectedMin }
  if (-not $passed) {
    Write-Error "MASTER_BUILD_SPEC.md verification failed: $($check.Name) — expected $threshold, got $count"
    git checkout MASTER_BUILD_SPEC.md
    exit 1
  }
}
Write-Host "MASTER_BUILD_SPEC.md verification: PASS"
```

---

## STEP 5 — APPLY CHANGES TO SCHEMA_REGISTRY.md (9 SURGICAL CHANGES)

Read `SCHEMA_REGISTRY_DELTA.md` and apply the 9 surgical changes from its Sections 2 through 10.

Apply in reverse line order:

- Change 9: INSERT RBAC helper functions and triggers section before line 986
- Change 8: REPLACE lines 784–788 (A-44 Phase 1 designation)
- Change 7: REPLACE lines 493–524 (RLS Verification section)
- Change 6: INSERT MIGRATIONS N+1 THROUGH N+8 section before line 493
- Change 5: REPLACE lines 444–448 (A-21/A-44 conflict resolution)
- Change 4: INSERT notes on 4 RBAC tables before line 296
- Change 3: REPLACE lines 250–251 (operator_actions deprecation note)
- Change 2: INSERT Group 16 inventory after line 208
- Change 1: REPLACE line 48 (table count 80→87)

Verify:
```powershell
$lines = (Get-Content SCHEMA_REGISTRY.md | Measure-Object -Line).Lines
Write-Host "SCHEMA_REGISTRY.md post-commit: $lines lines (expected ~1,684, tolerance ±40)"

$checks = @(
  @{Pattern='^## COMPLETE TABLE INVENTORY \(87 TABLES\)'; Expected=1; Name="Table count 87"}
  @{Pattern="Group 16.*RBAC.*Knowledge Ingestion"; Expected=1; Name="Group 16 heading"}
  @{Pattern="CREATE TABLE user_roles \("; Expected=1; Name="user_roles DDL"}
  @{Pattern="CREATE TABLE user_actions \("; Expected=1; Name="user_actions DDL"}
  @{Pattern="CREATE TABLE role_grant_audit \("; Expected=1; Name="role_grant_audit DDL"}
  @{Pattern="CREATE TABLE client_ingestion_versions \("; Expected=1; Name="client_ingestion_versions DDL"}
  @{Pattern="user_has_operator_role"; ExpectedMin=5; Name="Helper function references"}
)
foreach ($check in $checks) {
  $count = (Select-String -Path SCHEMA_REGISTRY.md -Pattern $check.Pattern).Count
  $threshold = if ($check.Expected) { $check.Expected } else { $check.ExpectedMin }
  $passed = if ($check.Expected) { $count -eq $check.Expected } else { $count -ge $check.ExpectedMin }
  if (-not $passed) {
    Write-Error "SCHEMA_REGISTRY.md verification failed: $($check.Name) — expected $threshold, got $count"
    git checkout SCHEMA_REGISTRY.md
    exit 1
  }
}
Write-Host "SCHEMA_REGISTRY.md verification: PASS"
```

---

## STEP 6 — APPLY CHANGES TO AGENTS.md (8 SURGICAL CHANGES, REV 1)

Read `AGENTS_DELTA_REV1.md` (NOT the V1.0; REV 1 has the corrected shipped agent status). Apply the 8 surgical changes from Sections 2 through 9.

Apply in reverse line order:

- Change 7: REPLACE lines 1320–1370 (Phase 1.5 A-44 entry → cross-reference marker)
- Change 6: REPLACE lines 670–674 (A-21 geographic capabilities)
- Change 5: INSERT A-44 Phase 1 spec after line 585
- Change 4: REPLACE lines 537–554 (A-02 with Contract 73)
- Change 3: REPLACE lines 527–531 (incorporated into Change 2)
- Change 2: REPLACE lines 511–525 (Phase 1 agents 14→15, 7 shipped acknowledged)
- Change 8: INSERT RBAC AWARENESS section before line 504
- Change 1: INSERT 5 RBAC-aware restrictions after line 67

Verify:
```powershell
$lines = (Get-Content AGENTS.md | Measure-Object -Line).Lines
Write-Host "AGENTS.md post-commit: $lines lines (expected ~1,800, tolerance ±30)"

$checks = @(
  @{Pattern='^### Phase 1 Agents \(15\)'; Expected=1; Name="Phase 1 Agents 15"}
  @{Pattern="RBAC AWARENESS FOR BUILD EXECUTORS"; Expected=1; Name="RBAC Awareness section"}
  @{Pattern='^### CRON Jobs \(3\)'; Expected=1; Name="CRON Jobs 3"}
  @{Pattern="A-44 Client Knowledge Ingestion Engine \(RELOCATED"; ExpectedMin=1; Name="A-44 relocation"}
  @{Pattern="A-01 Intake Processor.*SHIPPED"; ExpectedMin=1; Name="A-01 shipped"}
  @{Pattern="A-07 Sitemap Generator.*SHIPPED"; ExpectedMin=1; Name="A-07 shipped"}
)
foreach ($check in $checks) {
  $count = (Select-String -Path AGENTS.md -Pattern $check.Pattern).Count
  $threshold = if ($check.Expected) { $check.Expected } else { $check.ExpectedMin }
  $passed = if ($check.Expected) { $count -eq $check.Expected } else { $count -ge $check.ExpectedMin }
  if (-not $passed) {
    Write-Error "AGENTS.md verification failed: $($check.Name) — expected $threshold, got $count"
    git checkout AGENTS.md
    exit 1
  }
}
Write-Host "AGENTS.md verification: PASS"
```

---

## STEP 7 — APPLY CHANGES TO BEHAVIORAL_CONTRACTS.md (4 CHANGES)

Read `BEHAVIORAL_CONTRACTS_DELTA.md` and apply the 4 changes from Sections 2 through 5.

Apply in reverse order:

- Change 4: INSERT Contract 73 at end of file
- Change 3: INSERT Contract 72 before Contract 73
- Change 2: INSERT Contract 71 after line 1457 (end of Contract 70)
- Change 1: REPLACE lines 1182–1244 (Contract 67 amendment)

Verify:
```powershell
$lines = (Get-Content BEHAVIORAL_CONTRACTS.md | Measure-Object -Line).Lines
Write-Host "BEHAVIORAL_CONTRACTS.md post-commit: $lines lines (expected ~2,065, tolerance ±40)"

$checks = @(
  @{Pattern='^## Contract 71: Role-Based Access Control'; Expected=1; Name="Contract 71"}
  @{Pattern='^## Contract 72: Multi-User Audit Attribution'; Expected=1; Name="Contract 72"}
  @{Pattern='^## Contract 73: Pre-Generation Knowledge Ingestion'; Expected=1; Name="Contract 73"}
  @{Pattern="Contract 67.*AMENDED 2026-05-23"; Expected=1; Name="Contract 67 amendment"}
)
foreach ($check in $checks) {
  $count = (Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern $check.Pattern).Count
  if ($count -ne $check.Expected) {
    Write-Error "BEHAVIORAL_CONTRACTS.md verification failed: $($check.Name) — expected $($check.Expected), got $count"
    git checkout BEHAVIORAL_CONTRACTS.md
    exit 1
  }
}

# Verify no duplicate contract numbers
$contractNums = Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern '^## Contract (\d+):' | ForEach-Object { [int]$_.Matches[0].Groups[1].Value }
$duplicates = $contractNums | Group-Object | Where-Object { $_.Count -gt 1 }
if ($duplicates) {
  Write-Error "BEHAVIORAL_CONTRACTS.md has duplicate contract numbers: $($duplicates.Name -join ',')"
  git checkout BEHAVIORAL_CONTRACTS.md
  exit 1
}

# Verify highest contract is 73
$maxContract = ($contractNums | Measure-Object -Maximum).Maximum
if ($maxContract -ne 73) {
  Write-Error "BEHAVIORAL_CONTRACTS.md highest contract is $maxContract, expected 73"
  git checkout BEHAVIORAL_CONTRACTS.md
  exit 1
}

Write-Host "BEHAVIORAL_CONTRACTS.md verification: PASS (highest contract = $maxContract)"
```

---

## STEP 8 — APPLY CHANGES TO STATE_OF_THE_BUILD.md (5 CHANGES)

Read `STATE_OF_THE_BUILD_DELTA.md` and apply the 5 changes from Sections 2 through 6.

Apply in reverse order:

- Change 5: INSERT session log entry at end of file (after line 4295)
- Change 4: REPLACE lines 98–114 (DAG update with shipped agents + RBAC + A-44)
- Change 3: INSERT P11 priority after line 41
- Change 2: INSERT active governance work block after line 18
- Change 1: REPLACE lines 1–4 (header dates)

**CRITICAL:** Session log entries pre-2026-05-23 are IMMUTABLE per Contract 50. Do NOT modify any historical session log entry. Only APPEND the new 2026-05-23 entry at the end of file.

Verify:
```powershell
$lines = (Get-Content STATE_OF_THE_BUILD.md | Measure-Object -Line).Lines
Write-Host "STATE_OF_THE_BUILD.md post-commit: $lines lines (expected ~4,970, tolerance ±50)"

$checks = @(
  @{Pattern='^\*\*Last updated:\*\* 2026-05-23'; Expected=1; Name="Last updated date"}
  @{Pattern='^## SESSION LOG - 2026-05-23: RBAC Architecture Lock'; Expected=1; Name="New session log"}
  @{Pattern='^### P11.*RBAC.*A-44 Phase 1 Build'; Expected=1; Name="P11 priority"}
  @{Pattern="RBAC Foundation \(Migrations N\+1 through N\+8"; ExpectedMin=1; Name="RBAC Foundation in DAG"}
  # Preserved historical entries
  @{Pattern="Stripe Checkout Flow Production Build"; Expected=1; Name="Historical Stripe entry preserved"}
  @{Pattern="G2 Silent-Failure Bug Fix"; Expected=1; Name="Historical G2 entry preserved"}
  @{Pattern="Auth Security Hardening"; Expected=1; Name="Historical auth entry preserved"}
)
foreach ($check in $checks) {
  $count = (Select-String -Path STATE_OF_THE_BUILD.md -Pattern $check.Pattern).Count
  $threshold = if ($check.Expected) { $check.Expected } else { $check.ExpectedMin }
  $passed = if ($check.Expected) { $count -eq $check.Expected } else { $count -ge $check.ExpectedMin }
  if (-not $passed) {
    Write-Error "STATE_OF_THE_BUILD.md verification failed: $($check.Name) — expected $threshold, got $count"
    git checkout STATE_OF_THE_BUILD.md
    exit 1
  }
}
Write-Host "STATE_OF_THE_BUILD.md verification: PASS"
```

---

## STEP 9 — COPY ROLE_HIERARCHY_ARCHITECTURE_SPEC.md INTO REPOSITORY

```powershell
# Copy the canonical spec file from delta location to repository path
$sourceSpec = $deltaDocs["ROLE_HIERARCHY_ARCHITECTURE_SPEC.md"]
$targetSpec = "docs\architecture\ROLE_HIERARCHY_ARCHITECTURE_SPEC.md"

Copy-Item -Path $sourceSpec -Destination $targetSpec -Force

# Verify
if (-not (Test-Path $targetSpec)) {
  Write-Error "Failed to copy ROLE_HIERARCHY_ARCHITECTURE_SPEC.md to docs/architecture/"
  exit 1
}

$specLines = (Get-Content $targetSpec | Measure-Object -Line).Lines
Write-Host "docs/architecture/ROLE_HIERARCHY_ARCHITECTURE_SPEC.md: $specLines lines (expected ~1,046, tolerance ±30)"

$specChecks = @(
  @{Pattern='^# TARRITRIX 1\.0 — ROLE HIERARCHY ARCHITECTURE'; Expected=1; Name="Spec heading"}
  @{Pattern='^## 3\. PERMISSION MATRIX'; Expected=1; Name="Section 3 Permission Matrix"}
  @{Pattern="master_admin"; ExpectedMin=20; Name="master_admin references"}
)
foreach ($check in $specChecks) {
  $count = (Select-String -Path $targetSpec -Pattern $check.Pattern).Count
  $threshold = if ($check.Expected) { $check.Expected } else { $check.ExpectedMin }
  $passed = if ($check.Expected) { $count -eq $check.Expected } else { $count -ge $check.ExpectedMin }
  if (-not $passed) {
    Write-Error "ROLE_HIERARCHY_ARCHITECTURE_SPEC.md verification failed: $($check.Name) — expected $threshold, got $count"
    Remove-Item $targetSpec -Force
    exit 1
  }
}
Write-Host "ROLE_HIERARCHY_ARCHITECTURE_SPEC.md verification: PASS"
```

---

## STEP 10 — RUN CONSOLIDATED CROSS-FILE VERIFICATION

Per GOVERNANCE_SYNC_CHANGE_LOG.md Section 5, run the consolidated verification queries:

```powershell
Write-Host ""
Write-Host "=== CROSS-FILE VERIFICATION ==="

# A-44 phase consistency — no Phase 1.5 references except deliberate cross-reference markers
$filesToCheck = @("BLUEPRINT.md", "MASTER_BUILD_SPEC.md", "SCHEMA_REGISTRY.md", "BEHAVIORAL_CONTRACTS.md")
foreach ($f in $filesToCheck) {
  $phaseRefs = Select-String -Path $f -Pattern 'A-44.*Phase 1\.5' | Where-Object { $_.Line -notmatch "RELOCATED|cross-reference|former|historical" }
  if ($phaseRefs) {
    Write-Error "$f has unmarked Phase 1.5 references to A-44:"
    $phaseRefs | ForEach-Object { Write-Host "  Line $($_.LineNumber): $($_.Line)" }
    exit 1
  }
}
Write-Host "A-44 phase consistency: PASS"

# Contract 71/72/73 referenced in all relevant files
$contractFiles = @("BLUEPRINT.md", "MASTER_BUILD_SPEC.md", "AGENTS.md", "SCHEMA_REGISTRY.md", "STATE_OF_THE_BUILD.md")
foreach ($f in $contractFiles) {
  $count = (Select-String -Path $f -Pattern 'Contract 7[123]').Count
  if ($count -lt 3) {
    Write-Error "$f has only $count Contract 71/72/73 references (expected >= 3)"
    exit 1
  }
}
Write-Host "Contract 71/72/73 cross-references: PASS"

# Migration N+1 through N+8 referenced in expected files
$migrationFiles = @("BLUEPRINT.md", "MASTER_BUILD_SPEC.md", "AGENTS.md", "SCHEMA_REGISTRY.md", "STATE_OF_THE_BUILD.md", "BEHAVIORAL_CONTRACTS.md")
foreach ($f in $migrationFiles) {
  $count = (Select-String -Path $f -Pattern 'Migration N\+[1-8]').Count
  if ($count -lt 3) {
    Write-Error "$f has only $count Migration N+1..N+8 references (expected >= 3)"
    exit 1
  }
}
Write-Host "Migration N+1 through N+8 cross-references: PASS"

# ROLE_HIERARCHY_ARCHITECTURE_SPEC.md cross-references resolve
$specRefFiles = @("BLUEPRINT.md", "MASTER_BUILD_SPEC.md", "SCHEMA_REGISTRY.md", "AGENTS.md", "BEHAVIORAL_CONTRACTS.md", "STATE_OF_THE_BUILD.md")
foreach ($f in $specRefFiles) {
  $count = (Select-String -Path $f -Pattern 'ROLE_HIERARCHY_ARCHITECTURE_SPEC\.md').Count
  if ($count -lt 1) {
    Write-Error "$f has zero references to ROLE_HIERARCHY_ARCHITECTURE_SPEC.md (expected >= 1)"
    exit 1
  }
}
Write-Host "ROLE_HIERARCHY_ARCHITECTURE_SPEC.md cross-references: PASS"

# Constitutional contracts preserved
$constitutionalContracts = @("Contract 6", "Contract 9", "Contract 18", "Contract 45")
foreach ($c in $constitutionalContracts) {
  $found = Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern "^## $c`:" -SimpleMatch:$false
  if (-not $found) {
    Write-Error "Constitutional contract $c not found in BEHAVIORAL_CONTRACTS.md"
    exit 1
  }
}
Write-Host "Constitutional contracts preserved: PASS"

Write-Host ""
Write-Host "=== ALL VERIFICATION QUERIES PASSED ==="
```

If any verification fails, abort the commit and report the failure. Roll back uncommitted changes via `git checkout` for each affected file.

---

## STEP 11 — RUN EXISTING CI VERIFICATION (DEFENSE-IN-DEPTH)

```powershell
# Run TypeScript check (catches any tsc breakage; expect clean since we modified only governance .md files)
pnpm tsc 2>&1 | Tee-Object -Variable tscOut
if ($LASTEXITCODE -ne 0) {
  Write-Error "pnpm tsc failed — should not happen on pure governance changes. Investigate."
  Write-Host $tscOut
  # Roll back all modified files
  git checkout BLUEPRINT.md MASTER_BUILD_SPEC.md SCHEMA_REGISTRY.md AGENTS.md BEHAVIORAL_CONTRACTS.md STATE_OF_THE_BUILD.md
  Remove-Item docs\architecture\ROLE_HIERARCHY_ARCHITECTURE_SPEC.md -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-Host "pnpm tsc: PASS"

# Run existing verify:ci (does NOT yet include the 3 new RBAC verification scripts — those ship in P11)
pnpm verify:ci 2>&1 | Tee-Object -Variable verifyOut
if ($LASTEXITCODE -ne 0) {
  Write-Error "pnpm verify:ci failed — investigate before commit."
  Write-Host $verifyOut
  git checkout BLUEPRINT.md MASTER_BUILD_SPEC.md SCHEMA_REGISTRY.md AGENTS.md BEHAVIORAL_CONTRACTS.md STATE_OF_THE_BUILD.md
  Remove-Item docs\architecture\ROLE_HIERARCHY_ARCHITECTURE_SPEC.md -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-Host "pnpm verify:ci: PASS"
```

---

## STEP 12 — GIT COMMIT

If all verifications pass, create the atomic commit:

```powershell
git add BLUEPRINT.md MASTER_BUILD_SPEC.md SCHEMA_REGISTRY.md AGENTS.md BEHAVIORAL_CONTRACTS.md STATE_OF_THE_BUILD.md
git add docs/architecture/ROLE_HIERARCHY_ARCHITECTURE_SPEC.md

# Verify exactly 7 files staged
$staged = git diff --cached --name-only
$stagedCount = ($staged | Measure-Object -Line).Lines
if ($stagedCount -ne 7) {
  Write-Error "Expected 7 staged files, got $stagedCount:"
  $staged | ForEach-Object { Write-Host "  $_" }
  git reset HEAD
  exit 1
}
Write-Host "7 files staged:"
$staged | ForEach-Object { Write-Host "  $_" }

# Commit with full message
$commitMessage = @"
chore(governance): RBAC architecture lock + A-44 Phase 1 relocation (2026-05-23)

Synchronizes 7 governance files with 2026-05-23 architectural decisions:
- Multi-user RBAC: master_admin / senior_admin / va roles
- A-44 Client Knowledge Ingestion relocated to Phase 1
- New Contracts 71 (RBAC enforcement), 72 (audit attribution), 73 (A-02 prerequisite)
- Contract 67 amended with role-based ownership semantics
- A-21/A-44 documentation conflict resolved

Changes:
- BLUEPRINT.md: +461 lines (6 surgical changes)
- MASTER_BUILD_SPEC.md: +230 lines (13 surgical changes)
- SCHEMA_REGISTRY.md: +690 lines (9 surgical changes; Tables 84-87 added)
- AGENTS.md: +325 lines (8 surgical changes; A-44 Phase 1 spec)
- BEHAVIORAL_CONTRACTS.md: +607 lines (Contracts 71/72/73 + Contract 67 amendment)
- STATE_OF_THE_BUILD.md: +675 lines (session log + DAG update + P11 priority)
- docs/architecture/ROLE_HIERARCHY_ARCHITECTURE_SPEC.md: +1,050 lines (NEW)

Total: +4,038 lines across 7 files

Refs: ROLE_HIERARCHY_ARCHITECTURE_SPEC.md (canonical source)

Approved-by: Reid Whitesides (operator)
"@

git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) {
  Write-Error "git commit failed"
  exit 1
}

$commitHash = git rev-parse HEAD
Write-Host ""
Write-Host "=== COMMIT APPLIED ==="
Write-Host "Commit hash: $commitHash"
git log -1 --stat
```

---

## STEP 13 — POST-COMMIT REPORT

```powershell
Write-Host ""
Write-Host "=== POST-COMMIT REPORT ==="
Write-Host ""
Write-Host "File line counts (post-commit):"
$postCommitFiles = @(
  "BLUEPRINT.md",
  "MASTER_BUILD_SPEC.md",
  "SCHEMA_REGISTRY.md",
  "AGENTS.md",
  "BEHAVIORAL_CONTRACTS.md",
  "STATE_OF_THE_BUILD.md",
  "docs\architecture\ROLE_HIERARCHY_ARCHITECTURE_SPEC.md"
)
foreach ($f in $postCommitFiles) {
  $lines = (Get-Content $f | Measure-Object -Line).Lines
  Write-Host "  $f : $lines lines"
}

Write-Host ""
Write-Host "Commit:"
git log -1 --format="  %H%n  %s%n  Author: %an%n  Date: %ad"

Write-Host ""
Write-Host "=== NEXT ACTIONS FOR OPERATOR ==="
Write-Host "1. Verify commit applied: git log -1"
Write-Host "2. Re-upload the 6 modified governance files to Claude project knowledge so subsequent Claude sessions read post-commit state"
Write-Host "3. Push commit to origin when ready: git push origin master"
Write-Host "4. After push: begin P11 Work Item 1 (Migrations N+1 through N+8 generation) in next CC session"
Write-Host ""
Write-Host "ATOMIC GOVERNANCE COMMIT 2026-05-23 — COMPLETE"
```

---

## ROLLBACK INSTRUCTIONS (IF COMMIT FAILS POST-VERIFICATION)

If any issue is discovered AFTER the commit applies but BEFORE push to origin:

```powershell
# Reset to pre-commit state (commit is removed entirely)
git reset --hard HEAD~1

# Verify all files restored to pre-commit state
git status
git log -1
```

If the commit has already been pushed and rollback is needed:

```powershell
# Create a revert commit (preserves history, undoes changes)
git revert HEAD --no-edit
git push origin master
```

Report rollback completion to operator with explanation of what failed and what next action is needed.

---

## OPERATOR ABORT INSTRUCTIONS

If CC encounters any condition not handled by this prompt, abort with:

```powershell
# Restore all files to pre-commit state
git checkout BLUEPRINT.md MASTER_BUILD_SPEC.md SCHEMA_REGISTRY.md AGENTS.md BEHAVIORAL_CONTRACTS.md STATE_OF_THE_BUILD.md
Remove-Item docs\architecture\ROLE_HIERARCHY_ARCHITECTURE_SPEC.md -Force -ErrorAction SilentlyContinue

Write-Host "ABORTED. All files restored to pre-commit state. Operator intervention required."
```

Report the specific failure reason to the operator with file paths and line numbers where applicable.

---

**END OF ATOMIC COMMIT PROMPT.**
**This prompt is autonomous. CC executes all steps without further operator interaction unless a verification fails.**
