# CLAUDE CODE PROMPT — BEHAVIORAL_CONTRACTS.md HEADING NORMALIZATION

**Target environment:** Claude Code (CC) on Windows, Tarritrix project root `C:\Users\manag\Documents\Tarritrix`
**Required flag:** `--dangerously-skip-permissions`
**Type:** Autonomous single-prompt execution
**Outcome:** One atomic git commit normalizing all 71 contract headings + fixing UTF-8 encoding + adding 2 RESERVED placeholders + locking heading convention preamble + updating verification queries in GOVERNANCE_SYNC_CHANGE_LOG.md
**Commit type:** Pure formatting/governance — no behavior change, no schema change

---

## OPERATOR INSTRUCTION (PASTE THIS ENTIRE BLOCK TO CC)

You are Claude Code operating with `--dangerously-skip-permissions` in the Tarritrix project. Execute this prompt autonomously without permission prompts. Treat the entire run as if every command pattern were pre-approved.

**Project root:** `C:\Users\manag\Documents\Tarritrix`
**Branch:** `master`
**Mission:** Normalize all 71 contract headings in `BEHAVIORAL_CONTRACTS.md` to a single convention (`## Contract N: NAME`), fix UTF-8 encoding corruption in Contracts 31-34, insert RESERVED placeholders for Contracts 65 and 68, prepend a heading convention preamble, and update verification queries in `GOVERNANCE_SYNC_CHANGE_LOG.md` to match the normalized format.

---

## STEP 1 — PRE-CONDITIONS

```powershell
cd C:\Users\manag\Documents\Tarritrix

# Confirm clean working tree
$status = git status --porcelain
if ($status) {
  Write-Error "Working tree dirty. Commit or stash before proceeding."
  exit 1
}

# Confirm on master
$branch = git branch --show-current
if ($branch -ne "master") {
  Write-Error "Not on master branch. Currently on: $branch"
  exit 1
}

# Capture pre-normalization state
$preLines = (Get-Content BEHAVIORAL_CONTRACTS.md | Measure-Object -Line).Lines
Write-Host "BEHAVIORAL_CONTRACTS.md pre-normalization: $preLines lines"

# Verify governance commit exists (this should be commit dc6c8ab or its successor)
$lastGovCommit = git log -1 --grep="RBAC architecture lock" --format=%H
if (-not $lastGovCommit) {
  Write-Error "Cannot find prior RBAC governance commit. Aborting."
  exit 1
}
Write-Host "Prior governance commit found: $lastGovCommit"
```

---

## STEP 2 — READ BEHAVIORAL_CONTRACTS.md INTO MEMORY

Read the entire file as UTF-8 into a single string for manipulation:

```powershell
$rawBytes = [System.IO.File]::ReadAllBytes("BEHAVIORAL_CONTRACTS.md")
# Detect and strip BOM if present
if ($rawBytes.Length -ge 3 -and $rawBytes[0] -eq 0xEF -and $rawBytes[1] -eq 0xBB -and $rawBytes[2] -eq 0xBF) {
  $rawBytes = $rawBytes[3..($rawBytes.Length - 1)]
  Write-Host "BOM detected and stripped"
}

# Decode as UTF-8
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$content = $utf8NoBom.GetString($rawBytes)

Write-Host "File loaded. Character count: $($content.Length)"
```

---

## STEP 3 — FIX UTF-8 ENCODING CORRUPTION (Contracts 31-34)

The garbled `â€"` (three bytes: 0xC3 0xA2, 0xE2 0x80 0x9C, displayed as â€") represents an em-dash `—` (U+2014) that was double-encoded. Find and replace:

```powershell
# Replace the corrupted three-character sequence with proper em-dash
$mojibake = [char]0x00E2 + [char]0x20AC + [char]0x201D  # â€" sequence
$emDash = [char]0x2014  # —

$beforeCount = ([regex]::Matches($content, [regex]::Escape($mojibake))).Count
$content = $content.Replace($mojibake, $emDash)
$afterCount = ([regex]::Matches($content, [regex]::Escape($mojibake))).Count

Write-Host "UTF-8 mojibake fix: replaced $beforeCount occurrences (verified $afterCount remaining)"

if ($afterCount -ne 0) {
  Write-Error "Mojibake remains after replacement. Aborting."
  exit 1
}
```

---

## STEP 4 — NORMALIZE ALL CONTRACT HEADINGS

Apply the following surgical replacements. Each is anchored at the start of a line to avoid accidental matches in body text.

### 4.1 Normalize uppercase `## CONTRACT N: NAME` to `## Contract N: NAME` (Contracts 1-30)

```powershell
# Pattern: ^## CONTRACT N: NAME  →  ## Contract N: NAME
# Match: ## CONTRACT followed by space, digits, colon
$pattern1 = '(?m)^## CONTRACT (\d+):'
$replacement1 = '## Contract $1:'

$matches1 = [regex]::Matches($content, $pattern1).Count
$content = [regex]::Replace($content, $pattern1, $replacement1)
Write-Host "Normalized $matches1 headings: ## CONTRACT → ## Contract (Contracts 1-30 range)"
```

### 4.2 Normalize em-dash separator to colon (Contracts 31-34, 36-37)

After the UTF-8 fix in Step 3, em-dashes are now proper `—`. Replace headings using em-dash with colon format.

```powershell
# Pattern: ^## Contract N — NAME  →  ## Contract N: NAME
$pattern2 = "(?m)^## Contract (\d+) $emDash "
$replacement2 = '## Contract $1: '

$matches2 = [regex]::Matches($content, $pattern2).Count
$content = [regex]::Replace($content, $pattern2, $replacement2)
Write-Host "Normalized $matches2 headings: em-dash → colon (Contracts 31-37 range)"
```

### 4.3 Normalize hyphen separator to colon (Contract 35)

```powershell
# Pattern: ^## Contract N - NAME  →  ## Contract N: NAME
$pattern3 = '(?m)^## Contract (\d+) - '
$replacement3 = '## Contract $1: '

$matches3 = [regex]::Matches($content, $pattern3).Count
$content = [regex]::Replace($content, $pattern3, $replacement3)
Write-Host "Normalized $matches3 headings: hyphen → colon (Contract 35)"
```

### 4.4 Promote ### CONTRACT N to ## Contract N (Contracts 38-58)

Two-step: promote h3 to h2, then normalize uppercase to title case and em-dash to colon.

```powershell
# Pattern: ^### CONTRACT N — NAME  →  ## Contract N: NAME
$pattern4 = "(?m)^### CONTRACT (\d+) $emDash "
$replacement4 = '## Contract $1: '

$matches4 = [regex]::Matches($content, $pattern4).Count
$content = [regex]::Replace($content, $pattern4, $replacement4)
Write-Host "Normalized $matches4 headings: ### CONTRACT N — → ## Contract N: (Contracts 38-58 range)"

# Catch any remaining ### CONTRACT N - (hyphen) variants
$pattern5 = '(?m)^### CONTRACT (\d+) - '
$replacement5 = '## Contract $1: '

$matches5 = [regex]::Matches($content, $pattern5).Count
$content = [regex]::Replace($content, $pattern5, $replacement5)
Write-Host "Normalized $matches5 headings: ### CONTRACT N - → ## Contract N: (hyphen variant)"
```

### 4.5 Verify no remaining variant patterns

```powershell
# Confirm no ### CONTRACT patterns remain (excluding sub-section headings within contract body)
$remainingH3 = [regex]::Matches($content, '(?m)^### CONTRACT \d+').Count
if ($remainingH3 -gt 0) {
  Write-Error "Found $remainingH3 remaining ### CONTRACT patterns. Investigate before proceeding."
  exit 1
}

# Confirm no ## CONTRACT (uppercase) patterns remain
$remainingUpper = [regex]::Matches($content, '(?m)^## CONTRACT \d+').Count
if ($remainingUpper -gt 0) {
  Write-Error "Found $remainingUpper remaining ## CONTRACT (uppercase) patterns. Investigate before proceeding."
  exit 1
}

# Confirm no em-dash or hyphen separators remain in Contract headings
$remainingDash = [regex]::Matches($content, "(?m)^## Contract \d+ ($emDash|-) ").Count
if ($remainingDash -gt 0) {
  Write-Error "Found $remainingDash remaining em-dash/hyphen separators in Contract headings. Investigate."
  exit 1
}

# Count total normalized headings
$normalizedCount = [regex]::Matches($content, '(?m)^## Contract \d+:').Count
Write-Host "Total normalized Contract headings: $normalizedCount (expected: 71 pre-RESERVED, 73 post-RESERVED)"
```

---

## STEP 5 — INSERT RESERVED PLACEHOLDERS FOR CONTRACTS 65 AND 68

Find Contract 64 (line ~1125 pre-normalization) and Contract 66 (line ~1154). Insert Contract 65 RESERVED between them. Find Contract 67 (line ~1182) and Contract 69 (line ~1249). Insert Contract 68 RESERVED between them.

Strategy: Locate by Contract heading, insert RESERVED block immediately before the next Contract heading.

```powershell
$contract65Placeholder = @"
## Contract 65: RESERVED

**Status:** Reserved slot. No active rule.

**Note:** This contract number is reserved for future use. The numbering gap between Contract 64 (Service Role Grant Enforcement) and Contract 66 (Integration Smoke Test as Blocking Gate) was created during prior governance sessions. The RESERVED designation prevents future Claude/CC sessions from incorrectly assuming the number is available for reuse.

---

"@

$contract68Placeholder = @"
## Contract 68: RESERVED

**Status:** Reserved slot. No active rule.

**Note:** This contract number is reserved for future use. The numbering gap between Contract 67 (Resource Ownership Verification, amended 2026-05-23) and Contract 69 (INSERT Error Capture Required) was created during prior governance sessions. The RESERVED designation prevents future Claude/CC sessions from incorrectly assuming the number is available for reuse.

---

"@

# Insert Contract 65 RESERVED before Contract 66 heading
$pattern65 = '(?m)^## Contract 66:'
$replacement65 = $contract65Placeholder + '## Contract 66:'

if (-not ($content -match $pattern65)) {
  Write-Error "Cannot locate Contract 66 heading for Contract 65 RESERVED insertion. Aborting."
  exit 1
}
$content = [regex]::Replace($content, $pattern65, [System.Text.RegularExpressions.Regex]::Escape($replacement65) -replace '\\(.)', '$1', 1)
# Use literal-safe replacement
$content = $content -replace '(?m)^## Contract 66:', ($contract65Placeholder.TrimEnd("`r","`n") + "`r`n`r`n## Contract 66:")

# Insert Contract 68 RESERVED before Contract 69 heading
$pattern68 = '(?m)^## Contract 69:'
if (-not ($content -match $pattern68)) {
  Write-Error "Cannot locate Contract 69 heading for Contract 68 RESERVED insertion. Aborting."
  exit 1
}
$content = $content -replace '(?m)^## Contract 69:', ($contract68Placeholder.TrimEnd("`r","`n") + "`r`n`r`n## Contract 69:")

# Verify both placeholders inserted
$contract65Check = [regex]::Matches($content, '(?m)^## Contract 65: RESERVED').Count
$contract68Check = [regex]::Matches($content, '(?m)^## Contract 68: RESERVED').Count

if ($contract65Check -ne 1) {
  Write-Error "Contract 65 RESERVED insertion failed. Found $contract65Check occurrences."
  exit 1
}
if ($contract68Check -ne 1) {
  Write-Error "Contract 68 RESERVED insertion failed. Found $contract68Check occurrences."
  exit 1
}
Write-Host "RESERVED placeholders inserted: Contract 65 and Contract 68"
```

---

## STEP 6 — PREPEND HEADING CONVENTION PREAMBLE

Insert a preamble immediately after the existing file header (after the first existing top-level heading). The preamble documents the locked heading convention and instructs future contract additions to follow it.

```powershell
$preamble = @"

## HEADING CONVENTION (LOCKED 2026-05-23)

**All contracts in this document MUST follow this exact heading format:**

``````
## Contract N: NAME
``````

**Format rules:**
- Heading level: exactly `##` (h2). Do NOT use `###` (h3) for contract headings.
- Word "Contract": title case ("Contract"), NOT uppercase ("CONTRACT") or lowercase ("contract").
- Contract number: integer, no leading zeros, followed immediately by a colon.
- Separator after the colon: single space character.
- Name: the contract's title in title case.

**Examples of CORRECT headings:**
- ``## Contract 1: The Six Laws``
- ``## Contract 73: Pre-Generation Knowledge Ingestion Requirement``
- ``## Contract 65: RESERVED``

**Examples of INCORRECT headings (do not use):**
- ``## CONTRACT 1: THE SIX LAWS`` (uppercase)
- ``### CONTRACT 38 — REAL-DATA BINDING`` (h3 with em-dash)
- ``## Contract 35 - Vendor Dependency Management`` (hyphen separator)
- ``## Contract 31 — Personalized Demo Engine Protection`` (em-dash separator)

**Sub-section headings within a contract body** (h3 level and deeper) are unaffected by this convention — they can use any format that fits the content.

**RESERVED contract slots** use the format ``## Contract N: RESERVED`` followed by a brief explanatory note. RESERVED slots prevent future Claude/CC sessions from incorrectly assuming the number is available for reuse.

**Numbering gaps** are documented as RESERVED slots when discovered. Genuine deletions of contracts (rare, requires governance synchronization) also leave RESERVED placeholders to preserve historical numbering.

**Enforcement:** A verification grep pattern ``^## Contract \d+:`` should match every contract heading in this document, returning a count equal to the total contracts (including RESERVED slots). The pattern ``^### CONTRACT`` should return zero matches.

**Normalization commit:** This convention was locked and applied platform-wide via the BEHAVIORAL_CONTRACTS.md heading normalization commit dated 2026-05-23. Prior governance sessions used four different heading formats; the normalization standardizes them.

---

"@

# Locate the existing file header. The original file starts with the heading text directly.
# Insert the preamble after the first line break following the document title.
# We insert immediately after the first ## heading we find that is NOT a Contract heading,
# OR if no such heading exists, after the very first line.

# Strategy: insert after the file's title block. Look for "## Contract 1:" and insert preamble before it.
$firstContractPattern = '(?m)^## Contract 1:'
if ($content -match $firstContractPattern) {
  $content = $content -replace '(?m)^## Contract 1:', ($preamble.TrimEnd("`r","`n") + "`r`n`r`n## Contract 1:")
  Write-Host "Heading convention preamble inserted before Contract 1"
} else {
  Write-Error "Cannot locate Contract 1 heading for preamble insertion. Aborting."
  exit 1
}

# Verify preamble present
if ($content -notmatch 'HEADING CONVENTION \(LOCKED 2026-05-23\)') {
  Write-Error "Preamble insertion verification failed."
  exit 1
}
Write-Host "Preamble verification: PASS"
```

---

## STEP 7 — WRITE NORMALIZED FILE AS UTF-8 (NO BOM)

```powershell
# Write file as UTF-8 without BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
  "$PWD\BEHAVIORAL_CONTRACTS.md",
  $content,
  $utf8NoBom
)
Write-Host "File written as UTF-8 (no BOM)"

# Verify no BOM in written file
$writtenBytes = [System.IO.File]::ReadAllBytes("BEHAVIORAL_CONTRACTS.md")
if ($writtenBytes[0] -eq 0xEF -and $writtenBytes[1] -eq 0xBB -and $writtenBytes[2] -eq 0xBF) {
  Write-Error "BOM detected in written file. Encoding fix failed."
  exit 1
}
Write-Host "BOM check: PASS (no BOM)"

# Verify line count
$postLines = (Get-Content BEHAVIORAL_CONTRACTS.md | Measure-Object -Line).Lines
Write-Host "BEHAVIORAL_CONTRACTS.md post-normalization: $postLines lines (was $preLines)"
```

---

## STEP 8 — POST-NORMALIZATION VERIFICATION

```powershell
Write-Host ""
Write-Host "=== POST-NORMALIZATION VERIFICATION ==="

# Total contract count must be 73 (71 original + 2 RESERVED added)
$totalContracts = (Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern '^## Contract \d+:').Count
if ($totalContracts -ne 73) {
  Write-Error "Expected 73 normalized Contract headings, found $totalContracts"
  git checkout BEHAVIORAL_CONTRACTS.md
  exit 1
}
Write-Host "Total Contract headings: $totalContracts ✓"

# No ### CONTRACT patterns remain (contract-level, not sub-section)
$remainingH3 = (Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern '^### CONTRACT \d+').Count
if ($remainingH3 -gt 0) {
  Write-Error "$remainingH3 ### CONTRACT patterns remain. Normalization incomplete."
  git checkout BEHAVIORAL_CONTRACTS.md
  exit 1
}
Write-Host "Remaining ### CONTRACT headings: 0 ✓"

# No ## CONTRACT (uppercase) patterns remain
$remainingUpper = (Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern '^## CONTRACT \d+').Count
if ($remainingUpper -gt 0) {
  Write-Error "$remainingUpper ## CONTRACT (uppercase) patterns remain. Normalization incomplete."
  git checkout BEHAVIORAL_CONTRACTS.md
  exit 1
}
Write-Host "Remaining ## CONTRACT (uppercase) headings: 0 ✓"

# No mojibake remains
$mojibakePattern = [char]0x00E2 + [char]0x20AC + [char]0x201D
$remainingMojibake = (Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern ([regex]::Escape($mojibakePattern))).Count
if ($remainingMojibake -gt 0) {
  Write-Error "$remainingMojibake mojibake sequences remain in file."
  git checkout BEHAVIORAL_CONTRACTS.md
  exit 1
}
Write-Host "Remaining UTF-8 mojibake: 0 ✓"

# All four constitutional contracts findable with normalized pattern
$constitutional = @(6, 9, 18, 45)
foreach ($n in $constitutional) {
  $found = Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern "^## Contract ${n}:"
  if (-not $found) {
    Write-Error "Constitutional Contract $n not found with normalized pattern"
    git checkout BEHAVIORAL_CONTRACTS.md
    exit 1
  }
}
Write-Host "All 4 constitutional contracts findable with normalized pattern: ✓"

# RESERVED placeholders present
$reserved65 = (Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern '^## Contract 65: RESERVED').Count
$reserved68 = (Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern '^## Contract 68: RESERVED').Count
if ($reserved65 -ne 1 -or $reserved68 -ne 1) {
  Write-Error "RESERVED placeholders missing: Contract 65 = $reserved65, Contract 68 = $reserved68"
  git checkout BEHAVIORAL_CONTRACTS.md
  exit 1
}
Write-Host "RESERVED placeholders (65 and 68): ✓"

# Heading convention preamble present
$preamble = Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern 'HEADING CONVENTION \(LOCKED 2026-05-23\)'
if (-not $preamble) {
  Write-Error "Heading convention preamble missing"
  git checkout BEHAVIORAL_CONTRACTS.md
  exit 1
}
Write-Host "Heading convention preamble present: ✓"

# Numbering continuity check (1 through 73 with no gaps)
$contracts = Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern '^## Contract (\d+):' | ForEach-Object {
  [int]$_.Matches[0].Groups[1].Value
} | Sort-Object -Unique

$expectedSet = 1..73
$missing = $expectedSet | Where-Object { $contracts -notcontains $_ }
if ($missing.Count -gt 0) {
  Write-Error "Numbering gaps remain: $($missing -join ', ')"
  git checkout BEHAVIORAL_CONTRACTS.md
  exit 1
}
$extras = $contracts | Where-Object { $expectedSet -notcontains $_ }
if ($extras.Count -gt 0) {
  Write-Error "Unexpected contract numbers found: $($extras -join ', ')"
  git checkout BEHAVIORAL_CONTRACTS.md
  exit 1
}
Write-Host "Contract numbering continuous 1-73 with no gaps: ✓"

Write-Host ""
Write-Host "=== ALL VERIFICATIONS PASSED ==="
```

---

## STEP 9 — UPDATE GOVERNANCE_SYNC_CHANGE_LOG.md VERIFICATION QUERIES

The Section 5 verification queries in GOVERNANCE_SYNC_CHANGE_LOG.md (if it exists in the repo) currently assume the heading patterns that existed before this normalization. Update them to match the new convention.

```powershell
$changeLogPath = "GOVERNANCE_SYNC_CHANGE_LOG.md"

if (Test-Path $changeLogPath) {
  $changeLogContent = Get-Content $changeLogPath -Raw

  # Add an addendum at the end documenting the normalization
  $addendum = @"


---

## ADDENDUM (2026-05-23 POST-COMMIT): HEADING NORMALIZATION

Following the atomic governance commit, BEHAVIORAL_CONTRACTS.md was normalized in a follow-up atomic commit to address three pre-existing governance hygiene issues:

1. **Heading format inconsistency:** 71 contracts used four different heading conventions. All normalized to ``## Contract N: NAME``.
2. **UTF-8 encoding corruption:** Contracts 31-34 contained mojibake sequences (``â€"``) from prior encoding errors. Fixed to proper em-dash ``—`` (though em-dash is no longer used in headings — it appears only in body text).
3. **Numbering gaps:** Contracts 65 and 68 had no entries. RESERVED placeholders added to prevent future ambiguity.

**Heading convention now locked** via preamble at top of BEHAVIORAL_CONTRACTS.md. All future contracts must follow ``## Contract N: NAME`` format.

**Updated verification queries (supersedes Section 5 queries for BEHAVIORAL_CONTRACTS.md):**

``````bash
# All contracts findable with single pattern
grep -E "^## Contract \d+:" BEHAVIORAL_CONTRACTS.md | wc -l
# Expected: 73 (Contracts 1-73 inclusive, including 65 and 68 RESERVED)

# No legacy heading variants remain
grep -E "^### CONTRACT \d+|^## CONTRACT \d+" BEHAVIORAL_CONTRACTS.md | wc -l
# Expected: 0

# All four constitutional constraints findable
for n in 6 9 18 45; do
  grep -E "^## Contract \${n}:" BEHAVIORAL_CONTRACTS.md
done
# Expected: 4 matches, one per constitutional contract

# Numbering continuity (no gaps)
grep -E "^## Contract (\d+):" BEHAVIORAL_CONTRACTS.md | grep -oE "[0-9]+" | sort -n | uniq | wc -l
# Expected: 73 (continuous from 1 to 73)

# Heading convention preamble present
grep -c "HEADING CONVENTION (LOCKED 2026-05-23)" BEHAVIORAL_CONTRACTS.md
# Expected: 1
``````

"@

  $changeLogContent = $changeLogContent.TrimEnd() + $addendum
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText("$PWD\$changeLogPath", $changeLogContent, $utf8NoBom)
  Write-Host "GOVERNANCE_SYNC_CHANGE_LOG.md addendum appended"
} else {
  Write-Host "GOVERNANCE_SYNC_CHANGE_LOG.md not present in repo — skipping addendum (file may live only in governance staging)"
}
```

---

## STEP 10 — RUN EXISTING CI VERIFICATION

```powershell
pnpm tsc 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "pnpm tsc failed unexpectedly on governance-only changes."
  git checkout BEHAVIORAL_CONTRACTS.md
  if (Test-Path $changeLogPath) { git checkout $changeLogPath }
  exit 1
}
Write-Host "pnpm tsc: PASS"

pnpm verify:ci 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "pnpm verify:ci failed. Investigate before commit."
  git checkout BEHAVIORAL_CONTRACTS.md
  if (Test-Path $changeLogPath) { git checkout $changeLogPath }
  exit 1
}
Write-Host "pnpm verify:ci: PASS"
```

---

## STEP 11 — GIT COMMIT

```powershell
git add BEHAVIORAL_CONTRACTS.md
if (Test-Path $changeLogPath) { git add $changeLogPath }

$staged = git diff --cached --name-only
Write-Host ""
Write-Host "Files staged:"
$staged | ForEach-Object { Write-Host "  $_" }

$commitMessage = @"
chore(governance): normalize BEHAVIORAL_CONTRACTS.md heading conventions (2026-05-23)

Follow-up to commit dc6c8ab (RBAC architecture lock). Addresses three
pre-existing governance hygiene issues surfaced during post-commit
verification:

1. Heading format inconsistency: 71 contracts used 4 different heading
   conventions (## CONTRACT, ## Contract — em-dash, ## Contract - hyphen,
   ### CONTRACT). All normalized to single canonical format:
   '## Contract N: NAME'

2. UTF-8 encoding corruption: Contracts 31-34 contained mojibake
   sequences ('â€"') from prior encoding errors. File now saved as
   UTF-8 without BOM.

3. Numbering gaps: Contracts 65 and 68 had no entries. RESERVED
   placeholders inserted to prevent ambiguity about whether the
   numbers are available for reuse.

Changes:
- BEHAVIORAL_CONTRACTS.md: 71 contract headings normalized, 2 RESERVED
  placeholders inserted, heading convention preamble added at top of
  file, UTF-8 encoding corrected
- GOVERNANCE_SYNC_CHANGE_LOG.md (if present): addendum appended
  documenting the normalization

Net effect: Total contract count goes from 71 → 73 (adding RESERVED
slots). Numbering is now continuous 1-73 with no gaps. All future
contracts must follow the locked heading convention.

No behavior change. No schema change. No code change.

Approved-by: Reid Whitesides (operator)
"@

git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) {
  Write-Error "git commit failed"
  exit 1
}

$commitHash = git rev-parse HEAD
Write-Host ""
Write-Host "=== NORMALIZATION COMMIT APPLIED ==="
Write-Host "Commit hash: $commitHash"
git log -1 --stat
```

---

## STEP 12 — POST-COMMIT REPORT

```powershell
Write-Host ""
Write-Host "=== POST-COMMIT VERIFICATION ==="

# Re-run the constitutional contracts check with normalized pattern
@("Contract 6","Contract 9","Contract 18","Contract 45") | ForEach-Object {
  $name = $_
  $num = $name -replace 'Contract ', ''
  $found = Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern "^## Contract ${num}:"
  Write-Host ("$name : {0}" -f $(if ($found) {'PASS'} else {'FAIL'}))
}

# Total contract count
$totalContracts = (Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern '^## Contract \d+:').Count
Write-Host "Total contracts: $totalContracts (expected: 73)"

# Confirm continuity
$contracts = Select-String -Path BEHAVIORAL_CONTRACTS.md -Pattern '^## Contract (\d+):' | ForEach-Object {
  [int]$_.Matches[0].Groups[1].Value
} | Sort-Object -Unique
$gaps = (1..73) | Where-Object { $contracts -notcontains $_ }
if ($gaps.Count -eq 0) {
  Write-Host "Numbering continuity: PASS (1-73, no gaps)"
} else {
  Write-Host "Numbering continuity: FAIL (missing: $($gaps -join ', '))"
}

Write-Host ""
Write-Host "=== NEXT ACTIONS FOR OPERATOR ==="
Write-Host "1. Re-upload BEHAVIORAL_CONTRACTS.md to Claude project knowledge (and GOVERNANCE_SYNC_CHANGE_LOG.md if present)"
Write-Host "2. Push commit to origin: git push origin master"
Write-Host "3. Proceed to P11.1 Migrations N+1 through N+8 generation"
Write-Host ""
Write-Host "HEADING NORMALIZATION COMMIT — COMPLETE"
```

---

## ROLLBACK INSTRUCTIONS (IF ANYTHING FAILS POST-COMMIT)

```powershell
# Reset to pre-normalization state (commit removed)
git reset --hard HEAD~1
git status
git log -1
```

If the commit has been pushed:

```powershell
git revert HEAD --no-edit
git push origin master
```

---

**END OF NORMALIZATION COMMIT PROMPT.**
**Autonomous. CC executes all steps without further operator interaction unless a verification fails.**
