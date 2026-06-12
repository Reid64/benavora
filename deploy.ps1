# ============================================================================
# BENAVORA — Deploy Script
# Implements the FORGE Deployment Protocol (see CLAUDE.md).
# Every step must pass. If ANY step fails, the deploy is ABORTED.
# Never force-push broken code.
#
# Usage:   .\deploy.ps1 "[FORGE] <phase>: <description>"
# ============================================================================

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$CommitMessage = "[FORGE] deploy: routine deployment"
)

$ErrorActionPreference = "Stop"

function Invoke-Gate {
    param(
        [string]$Name,
        [scriptblock]$Action
    )
    Write-Host ""
    Write-Host "==> GATE: $Name" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        Write-Host "XX  GATE FAILED: $Name (exit $LASTEXITCODE). DEPLOY ABORTED." -ForegroundColor Red
        exit 1
    }
    Write-Host "OK  GATE PASSED: $Name" -ForegroundColor Green
}

Write-Host "BENAVORA deploy starting..." -ForegroundColor Yellow

# 1. Type check — must pass (zero TypeScript errors)
Invoke-Gate "Compile (tsc --noEmit)" { pnpm tsc --noEmit }

# 2. Build — must pass
Invoke-Gate "Build (next build)" { pnpm run build }

# 3. Lint — must pass
Invoke-Gate "Lint (next lint)" { pnpm lint }

# 4. Deploy to Vercel production — must succeed
Invoke-Gate "Deploy (vercel --prod)" { vercel --prod }

# 5. End-to-end tests — must pass
Invoke-Gate "Test (playwright)" { npx playwright test --reporter=list }

# 6. Commit + push (only after every gate passed)
Write-Host ""
Write-Host "==> Committing and pushing..." -ForegroundColor Cyan
git add -A
git commit -m $CommitMessage
if ($LASTEXITCODE -ne 0) {
    Write-Host "XX  git commit failed (nothing to commit?). DEPLOY ABORTED." -ForegroundColor Red
    exit 1
}
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "XX  git push failed. DEPLOY ABORTED." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "ALL GATES PASSED. Deploy complete." -ForegroundColor Green
