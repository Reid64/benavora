# FORGE 2.0 — Deploy Pipeline Deep Specification

**Specification Conversation 7 of 10 | June 22, 2026**

This document specifies Phase 6 DEPLOY: the canary deployment strategy, environment parity verification, Supabase migration application sequencing, health check verification, production rollback protocol, README auto-generation, deploy.ps1 orchestration, and post-deploy learning engine integration.

---

## 1. Deploy Entry Point and Prerequisites

```powershell
forge deploy -ProjectPath 'C:\Users\manag\Documents\Hail-Intel'
```

Deploy only runs after Phase 5 SENTINEL passes all thresholds. The PreDeploy hook chain enforces three gates: Ring 3 Sentinel pass, Six Laws compliance, and environment parity. All three must pass before any deployment action begins.

---

## 2. Pre-Deploy Sequence (Before Any Deployment)

### 2.1 Supabase Migration Application

This is the most critical step and the one most frequently botched. Migrations MUST be applied to production Supabase BEFORE the code that depends on them is deployed to Vercel. The DialStars production outage was caused by this exact sequencing failure.

```powershell
function Apply-ProductionMigrations {
    param([string]$ProjectPath)

    $migrationDir = "$ProjectPath/supabase/migrations"
    if (-not (Test-Path $migrationDir)) {
        Write-Host '[DEPLOY] No migrations directory. Skipping.' -ForegroundColor Gray
        return $true
    }

    # Get list of migrations already applied to production
    $applied = Invoke-SupabaseSQL -Query @"
        SELECT name FROM supabase_migrations.schema_migrations ORDER BY name
"@
    $appliedNames = $applied | ForEach-Object { $_.name }

    # Get all local migration files
    $localMigrations = Get-ChildItem $migrationDir -Filter '*.sql' | Sort-Object Name

    # Find unapplied migrations
    $unapplied = $localMigrations | Where-Object {
        $_.BaseName -notin $appliedNames
    }

    if ($unapplied.Count -eq 0) {
        Write-Host '[DEPLOY] All migrations already applied.' -ForegroundColor Green
        return $true
    }

    Write-Host "[DEPLOY] $($unapplied.Count) unapplied migration(s) found:" -ForegroundColor Yellow
    foreach ($mig in $unapplied) {
        Write-Host "  - $($mig.Name)" -ForegroundColor Gray
    }

    # Safety check: scan for destructive operations
    $destructive = @()
    foreach ($mig in $unapplied) {
        $sql = Get-Content $mig.FullName -Raw
        if ($sql -match 'DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM(?!\s+.*WHERE)') {
            $destructive += $mig.Name
        }
    }

    if ($destructive.Count -gt 0) {
        Write-Host '[DEPLOY] DESTRUCTIVE OPERATIONS DETECTED:' -ForegroundColor Red
        $destructive | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        $confirm = Read-Host 'These migrations contain DROP/TRUNCATE/DELETE. Apply anyway? [Y/N]'
        if ($confirm -ne 'Y') {
            Write-Host '[DEPLOY] Migration aborted by user.' -ForegroundColor Yellow
            return $false
        }
    }

    # Apply each migration in order
    foreach ($mig in $unapplied) {
        $sql = Get-Content $mig.FullName -Raw
        Write-Host "  Applying: $($mig.Name)..." -ForegroundColor Cyan -NoNewline

        try {
            Invoke-SupabaseSQL -Query $sql
            Write-Host ' OK' -ForegroundColor Green
        } catch {
            Write-Host ' FAILED' -ForegroundColor Red
            Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
            Register-Error -ErrorCode 'MIGRATION_FAIL' -FilePath $mig.FullName `
                -ErrorMessage $_.Exception.Message -ErrorCategory 'DEPLOY' `
                -TechStack @('supabase','sql')
            return $false
        }
    }

    # Verify: regenerate TypeScript types from live schema
    Write-Host '[DEPLOY] Regenerating TypeScript types from production schema...' -ForegroundColor Cyan
    & npx supabase gen types typescript --project-id $env:SUPABASE_PROJECT_ID > `
        "$ProjectPath/types/database.types.ts" 2>&1

    Write-Host "[DEPLOY] $($unapplied.Count) migration(s) applied successfully." -ForegroundColor Green
    return $true
}
```

### 2.2 Environment Parity Check

```powershell
function Invoke-EnvParityCheck {
    param([string]$ProjectPath)

    # Source 1: Local env vars
    $localVars = @{}
    $envFile = "$ProjectPath/.env.local"
    if (Test-Path $envFile) {
        Get-Content $envFile | Where-Object { $_ -match '^([^#=]+)=(.*)$' } |
            ForEach-Object { $localVars[$Matches[1].Trim()] = $Matches[2].Trim() }
    }

    # Source 2: Code references (what the app actually needs)
    $codeRefs = Get-ChildItem -Path $ProjectPath -Recurse -Include *.ts,*.tsx |
        Where-Object { $_.FullName -notmatch 'node_modules|.next' } |
        ForEach-Object {
            [regex]::Matches((Get-Content $_.FullName -Raw), 'process\.env\.([A-Z_]+)') |
                ForEach-Object { $_.Groups[1].Value }
        } | Select-Object -Unique

    # Source 3: Vercel production env vars
    $vercelVars = @{}
    try {
        $vercelOutput = & vercel env ls --json --cwd $ProjectPath 2>$null | Out-String
        ($vercelOutput | ConvertFrom-Json) | ForEach-Object { $vercelVars[$_.key] = $true }
    } catch {
        Write-Host '[DEPLOY] Could not query Vercel env vars. Skipping parity check.' -ForegroundColor Yellow
        return $true
    }

    $issues = @()

    # Check 1: Referenced in code but missing from Vercel
    foreach ($var in $codeRefs) {
        if ($var -notin $vercelVars.Keys) {
            $severity = if ($var -match 'NEXT_PUBLIC_') { 'WARN' } else { 'CRITICAL' }
            $issues += @{ Variable = $var; Issue = "Referenced in code but MISSING from Vercel production"; Severity = $severity }
        }
    }

    # Check 2: In local but not in Vercel (may be needed)
    foreach ($var in $localVars.Keys) {
        if ($var -notin $vercelVars.Keys -and $var -in $codeRefs) {
            $issues += @{ Variable = $var; Issue = "In .env.local and referenced in code but MISSING from Vercel"; Severity = 'CRITICAL' }
        }
    }

    # Check 3: In Vercel but not referenced in code (unused)
    foreach ($var in $vercelVars.Keys) {
        if ($var -notin $codeRefs -and $var -notmatch 'VERCEL_|CI|NODE_ENV') {
            $issues += @{ Variable = $var; Issue = "In Vercel production but never referenced in code"; Severity = 'INFO' }
        }
    }

    if ($issues.Count -eq 0) {
        Write-Host '[DEPLOY] Environment parity: PASS' -ForegroundColor Green
        return $true
    }

    $criticalCount = ($issues | Where-Object { $_.Severity -eq 'CRITICAL' }).Count
    Write-Host "[DEPLOY] Environment parity issues ($($issues.Count) total, $criticalCount critical):" -ForegroundColor Yellow
    foreach ($issue in $issues | Sort-Object Severity) {
        $color = switch ($issue.Severity) { 'CRITICAL' { 'Red' } 'WARN' { 'Yellow' } 'INFO' { 'Gray' } }
        Write-Host "  [$($issue.Severity)] $($issue.Variable): $($issue.Issue)" -ForegroundColor $color
    }

    if ($criticalCount -gt 0) {
        Write-Host ''
        Write-Host 'CRITICAL env vars missing. Add them to Vercel before deploying:' -ForegroundColor Red
        $criticalVars = $issues | Where-Object { $_.Severity -eq 'CRITICAL' }
        foreach ($cv in $criticalVars) {
            $value = if ($localVars[$cv.Variable]) { $localVars[$cv.Variable].Substring(0, [Math]::Min(10, $localVars[$cv.Variable].Length)) + '...' } else { '(not in .env.local)' }
            Write-Host "  vercel env add $($cv.Variable) production" -ForegroundColor White
        }
        $override = Read-Host 'Deploy anyway? (NOT RECOMMENDED) [Y/N]'
        return $override -eq 'Y'
    }

    return $true
}
```

---

## 3. Canary Deployment Strategy

FORGE never deploys directly to production. Every deployment follows a canary pattern using Vercel's preview URL infrastructure.

### 3.1 Canary Flow

```powershell
function Invoke-CanaryDeploy {
    param([string]$ProjectPath)

    # Step 1: Build locally first (catch build errors before deploying)
    Write-Host '[DEPLOY] Running production build locally...' -ForegroundColor Cyan
    $buildOutput = & pnpm run build --cwd $ProjectPath 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[DEPLOY] Local build FAILED. Cannot deploy.' -ForegroundColor Red
        Write-Host $buildOutput -ForegroundColor Gray
        return $false
    }

    # Step 2: Deploy to Vercel preview (NOT production)
    Write-Host '[DEPLOY] Deploying to Vercel preview...' -ForegroundColor Cyan
    $deployOutput = & vercel --cwd $ProjectPath 2>&1 | Out-String
    $previewUrl = [regex]::Match($deployOutput, 'https://[^\s]+\.vercel\.app').Value

    if (-not $previewUrl) {
        Write-Host '[DEPLOY] Could not extract preview URL from Vercel output.' -ForegroundColor Red
        Write-Host $deployOutput -ForegroundColor Gray
        return $false
    }

    Write-Host "  Preview URL: $previewUrl" -ForegroundColor Cyan

    # Step 3: Wait for preview to be ready (Vercel builds take 30-120 seconds)
    Write-Host '[DEPLOY] Waiting for preview deployment...' -ForegroundColor Gray
    $ready = $false
    $maxWait = 180  # 3 minutes max
    $waited = 0
    while (-not $ready -and $waited -lt $maxWait) {
        Start-Sleep -Seconds 10
        $waited += 10
        try {
            $health = Invoke-WebRequest -Uri $previewUrl -TimeoutSec 10 -ErrorAction Stop
            if ($health.StatusCode -eq 200) { $ready = $true }
        } catch { }
        Write-Host "  Waiting... ($waited s)" -ForegroundColor Gray
    }

    if (-not $ready) {
        Write-Host '[DEPLOY] Preview deployment did not become ready in 3 minutes.' -ForegroundColor Red
        return $false
    }

    # Step 4: Run Sentinel Ring 3 against the preview URL
    Write-Host '[DEPLOY] Running Sentinel against preview...' -ForegroundColor Cyan
    $sentinel = Invoke-SentinelRing -Ring 'Ring3' -ProjectPath $ProjectPath -BaseUrl $previewUrl

    if (-not $sentinel.AllPassed) {
        Write-Host '[DEPLOY] Sentinel FAILED against preview. Do NOT promote to production.' -ForegroundColor Red
        Write-Host "  Fix the following and re-deploy:" -ForegroundColor Yellow
        foreach ($fail in $sentinel.Results.Values | Where-Object { $_.Status -eq 'FAIL' }) {
            Write-Host "  - $($fail.Name): $($fail.Summary)" -ForegroundColor Red
        }
        return $false
    }

    Write-Host '[DEPLOY] Sentinel PASSED against preview.' -ForegroundColor Green

    # Step 5: Promote to production
    Write-Host '[DEPLOY] Promoting to production...' -ForegroundColor Cyan
    $prodOutput = & vercel --prod --cwd $ProjectPath 2>&1 | Out-String
    $prodUrl = [regex]::Match($prodOutput, 'https://[^\s]+').Value

    # Step 6: Production health check
    Write-Host '[DEPLOY] Production health check...' -ForegroundColor Cyan
    Start-Sleep -Seconds 15  # Give Vercel CDN time to propagate
    try {
        $prodHealth = Invoke-WebRequest -Uri $prodUrl -TimeoutSec 15 -ErrorAction Stop
        if ($prodHealth.StatusCode -eq 200) {
            Write-Host "[DEPLOY] LIVE at $prodUrl" -ForegroundColor Green
            return @{ Success = $true; Url = $prodUrl; PreviewUrl = $previewUrl }
        }
    } catch {
        Write-Host "[DEPLOY] Production health check FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }

    # Step 7: Rollback on failure
    Write-Host '[DEPLOY] ROLLING BACK to previous deployment...' -ForegroundColor Red
    Invoke-ProductionRollback -ProjectPath $ProjectPath
    return @{ Success = $false; RolledBack = $true }
}
```

### 3.2 Production Rollback Protocol

```powershell
function Invoke-ProductionRollback {
    param([string]$ProjectPath)

    # Option 1: Vercel rollback via CLI (redeploy previous commit)
    $previousCommit = git -C $ProjectPath rev-parse HEAD~1
    Write-Host "  Rolling back to commit: $($previousCommit.Substring(0, 8))" -ForegroundColor Yellow

    git -C $ProjectPath checkout $previousCommit 2>$null
    & vercel --prod --cwd $ProjectPath 2>&1 | Out-Null
    git -C $ProjectPath checkout - 2>$null  # Return to current branch

    # Verify rollback health
    Start-Sleep -Seconds 15
    $prodUrl = Get-VercelProductionUrl -ProjectPath $ProjectPath
    try {
        $health = Invoke-WebRequest -Uri $prodUrl -TimeoutSec 15
        if ($health.StatusCode -eq 200) {
            Write-Host '  Rollback successful. Previous version restored.' -ForegroundColor Green
        } else {
            Write-Host '  WARNING: Rollback deployment also unhealthy. Manual intervention required.' -ForegroundColor Red
        }
    } catch {
        Write-Host '  WARNING: Rollback health check failed. Manual intervention required.' -ForegroundColor Red
    }

    # Log rollback to learning database
    Register-Error -ErrorCode 'DEPLOY_ROLLBACK' -FilePath 'vercel' `
        -ErrorMessage 'Production deployment failed, rollback executed' `
        -ErrorCategory 'DEPLOY' -TechStack @('vercel','nextjs')
}
```

---

## 4. README Auto-Generation

```powershell
function Update-ReadmeFromGovernance {
    param([string]$ProjectPath)

    $blueprint = Get-Content "$ProjectPath/BLUEPRINT.md" -Raw -ErrorAction SilentlyContinue
    $schema = Get-Content "$ProjectPath/SCHEMA_REGISTRY.md" -Raw -ErrorAction SilentlyContinue
    $state = Get-Content "$ProjectPath/STATE_OF_THE_BUILD.md" -Raw -ErrorAction SilentlyContinue
    $pkg = Get-Content "$ProjectPath/package.json" -Raw -ErrorAction SilentlyContinue

    if (-not $blueprint) {
        Write-Host '[DEPLOY] No BLUEPRINT.md found. Skipping README generation.' -ForegroundColor Yellow
        return
    }

    $readmePrompt = @"
Generate a professional README.md for this project. Include:

## Project Name and Description
Extract from the blueprint vision statement.

## Tech Stack
List every technology with version from package.json and blueprint.

## Prerequisites
- Node.js (version from package.json engines or latest LTS)
- pnpm
- Supabase account and project
- Vercel account (for deployment)

## Environment Variables
List every env var from the blueprint integrations section.
Format: `VARIABLE_NAME` - description (where to get it)

## Getting Started
1. Clone the repo
2. Install dependencies: pnpm install
3. Copy .env.local.example to .env.local and fill in values
4. Apply database migrations: [exact command]
5. Start dev server: pnpm dev
6. Open http://localhost:3000

## Database Setup
List tables from schema with brief descriptions.
Include migration command.

## Deployment
Exact commands for Vercel deployment.

## Architecture Overview
Brief module descriptions from blueprint.

## Current Build Status
Paste the state of the build table.

## License
Proprietary unless specified otherwise.

BLUEPRINT:
$($blueprint.Substring(0, [Math]::Min(4000, $blueprint.Length)))

PACKAGE.JSON:
$($pkg.Substring(0, [Math]::Min(1000, $pkg.Length)))

STATE OF BUILD:
$state
"@

    $readme = Invoke-ClaudeAPI -Prompt $readmePrompt -MaxTokens 4000
    Set-Content "$ProjectPath/README.md" $readme
    Write-Host '[DEPLOY] README.md generated from governance documents.' -ForegroundColor Green
}
```

---

## 5. deploy.ps1 Generation

FORGE generates a project-specific deploy.ps1 during Phase 2 SCAFFOLD:

```powershell
function New-DeployScript {
    param([string]$ProjectPath)

    $script = @'
# FORGE 2.0 Deploy Script
# Generated: {DATE}
# Usage: .\deploy.ps1

$ErrorActionPreference = 'Stop'
$ProjectPath = Split-Path $MyInvocation.MyCommand.Path -Parent

Write-Host '=== FORGE DEPLOY SEQUENCE ===' -ForegroundColor Cyan

# Step 1: TypeScript compile check
Write-Host '[1/6] TypeScript check...' -ForegroundColor Gray
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Write-Host 'FAILED: TypeScript errors.' -ForegroundColor Red; exit 1 }

# Step 2: Production build
Write-Host '[2/6] Production build...' -ForegroundColor Gray
pnpm run build
if ($LASTEXITCODE -ne 0) { Write-Host 'FAILED: Build errors.' -ForegroundColor Red; exit 1 }

# Step 3: Run tests
Write-Host '[3/6] Running tests...' -ForegroundColor Gray
npx playwright test --reporter=list
if ($LASTEXITCODE -ne 0) { Write-Host 'FAILED: Test failures.' -ForegroundColor Red; exit 1 }

# Step 4: Deploy to Vercel production
Write-Host '[4/6] Deploying to Vercel...' -ForegroundColor Gray
vercel --prod
if ($LASTEXITCODE -ne 0) { Write-Host 'FAILED: Vercel deploy.' -ForegroundColor Red; exit 1 }

# Step 5: Git commit and push
Write-Host '[5/6] Git push...' -ForegroundColor Gray
git add -A
git commit -m "FORGE-DEPLOY: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git push

# Step 6: Done
Write-Host '[6/6] Deploy complete.' -ForegroundColor Green
'@

    $script = $script.Replace('{DATE}', (Get-Date -Format 'yyyy-MM-dd'))
    Set-Content "$ProjectPath/deploy.ps1" $script
    Write-Host '[SCAFFOLD] deploy.ps1 created.' -ForegroundColor Green
}
```

---

## 6. Complete Deploy Orchestration

```powershell
function Invoke-ForgeDeploy {
    param([string]$ProjectPath)

    Write-Host '=== FORGE 2.0 DEPLOY ===' -ForegroundColor Cyan

    # Gate 1: Apply migrations FIRST (before any code deployment)
    $migrationsOk = Apply-ProductionMigrations -ProjectPath $ProjectPath
    if (-not $migrationsOk) {
        Write-Host '[DEPLOY] Migration failure. Deploy aborted.' -ForegroundColor Red
        return $false
    }

    # Gate 2: Environment parity
    $parityOk = Invoke-EnvParityCheck -ProjectPath $ProjectPath
    if (-not $parityOk) {
        Write-Host '[DEPLOY] Env parity failure. Deploy aborted.' -ForegroundColor Red
        return $false
    }

    # Gate 3: Ring 4 Sentinel (comprehensive — CodeQL, AgentShield, OWASP ZAP, k6, etc.)
    Write-Host '[DEPLOY] Running Ring 4 Sentinel...' -ForegroundColor Cyan
    $sentinel4 = Invoke-SentinelRing -Ring 'Ring4' -ProjectPath $ProjectPath
    if (-not $sentinel4.AllPassed) {
        Write-Host '[DEPLOY] Ring 4 Sentinel FAILED. Cannot deploy.' -ForegroundColor Red
        return $false
    }

    # Gate 4: Six Laws compliance (via PreDeploy hook)
    # (Hook system handles this automatically)

    # Deploy via canary strategy
    $result = Invoke-CanaryDeploy -ProjectPath $ProjectPath

    if ($result.Success) {
        # Post-deploy actions
        Update-ReadmeFromGovernance -ProjectPath $ProjectPath

        # Git commit the deploy
        git -C $ProjectPath add -A
        git -C $ProjectPath commit -m "FORGE-DEPLOY: Production at $($result.Url)"
        git -C $ProjectPath push

        # Log to learning database
        Save-ToForgeMemory -Table 'build_outcomes' -Data @{
            deploy_url = $result.Url
            deploy_timestamp = (Get-Date -Format 'o')
            deploy_status = 'SUCCESS'
        }

        Write-Host ''
        Write-Host '=== DEPLOY SUCCESSFUL ===' -ForegroundColor Green
        Write-Host "  Production URL: $($result.Url)" -ForegroundColor Cyan
    } else {
        Save-ToForgeMemory -Table 'build_outcomes' -Data @{
            deploy_status = 'FAILED'
            deploy_rollback = $result.RolledBack
        }
    }

    return $result.Success
}
```

---

## 7. Learning Engine Integration

- **Migration failures** logged to fix_patterns with category DEPLOY. If the same migration pattern fails across projects (e.g., missing IF NOT EXISTS), auto-elevated to governance rule.
- **Env parity issues** tracked. If the same env var is consistently missing from Vercel across builds, FORGE proposes adding it to the SCAFFOLD phase's .env.local.example template.
- **Deploy success/failure rate** tracked in build_outcomes. If deploy failures exceed 20% over 5+ deploys, FORGE proposes a THRESHOLD evolution to tighten Ring 3 Sentinel gates.
- **Rollback frequency** monitored. Frequent rollbacks trigger investigation proposals via pending_evolutions.
