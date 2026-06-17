$ErrorActionPreference = "Continue"
$benavora = "C:\Users\manag\Documents\benavora"
$forge = "C:\Users\manag\Documents\FORGE"
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " BENAVORA STATE DIAGNOSTIC" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan
$envFile = "$benavora\.env.local"
if (!(Test-Path $envFile)) { Write-Host "[FATAL] .env.local not found" -ForegroundColor Red; exit 1 }
$env_map = @{}
Get-Content $envFile | Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } | ForEach-Object {
    $parts = $_ -split '=', 2; $env_map[$parts[0].Trim()] = $parts[1].Trim()
}
$SUPABASE_URL = $env_map["NEXT_PUBLIC_SUPABASE_URL"]; $SERVICE_KEY = $env_map["SUPABASE_SERVICE_ROLE_KEY"]
if (!$SUPABASE_URL -or !$SERVICE_KEY) { Write-Host "[FATAL] Missing SUPABASE_URL or SERVICE_ROLE_KEY" -ForegroundColor Red; exit 1 }
Write-Host "[OK] Supabase URL: $SUPABASE_URL" -ForegroundColor Green
$h = @{ "apikey" = $SERVICE_KEY; "Authorization" = "Bearer $SERVICE_KEY" }
Write-Host "`n--- SCHEMA COLUMNS ---" -ForegroundColor Yellow
foreach ($c in @("opportunities|match_percentage","opportunities|source_type","search_profiles|agent_settings")) {
    $t,$col = $c -split '\|'
    try { $null = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/$t`?select=$col&limit=0" -Headers $h; Write-Host "  [EXISTS] $t.$col" -ForegroundColor Green }
    catch { Write-Host "  [MISSING] $t.$col" -ForegroundColor Red }
}
Write-Host "`n--- PLATFORM CONFIG ---" -ForegroundColor Yellow
foreach ($key in @("ai.max_tokens","ai.model","ai.confidence_threshold")) {
    try {
        $r = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/platform_config?select=key,value&key=eq.$key" -Headers $h
        if ($r -and $r.Count -gt 0) { Write-Host "  $key = $($r[0].value)" -ForegroundColor Green }
        else { Write-Host "  $key NOT FOUND" -ForegroundColor Red }
    } catch { Write-Host "  $key ERROR: $($_.Exception.Message)" -ForegroundColor Red }
}
Write-Host "`n--- TIER 3 TABLES ---" -ForegroundColor Yellow
foreach ($t in @("funder_intelligence","renewals","email_activity")) {
    try { $null = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/$t`?select=id&limit=0" -Headers $h; Write-Host "  [EXISTS] $t" -ForegroundColor Green }
    catch { Write-Host "  [MISSING] $t" -ForegroundColor Red }
}
try { $null = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/proven_narratives?select=success_patterns&limit=0" -Headers $h; Write-Host "  [EXISTS] proven_narratives.success_patterns" -ForegroundColor Green }
catch { Write-Host "  [MISSING] proven_narratives.success_patterns" -ForegroundColor Red }
Write-Host "`n--- ALERTS/NOTIFICATIONS TABLES ---" -ForegroundColor Yellow
foreach ($t in @("alerts","notifications","user_alerts","notification_preferences")) {
    try { $null = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/$t`?select=id&limit=0" -Headers $h; Write-Host "  [EXISTS] $t" -ForegroundColor Green }
    catch { Write-Host "  [MISSING] $t" -ForegroundColor Red }
}
Write-Host "`n--- GIT HISTORY (last 20) ---" -ForegroundColor Yellow
Push-Location $benavora
git log --oneline -20 2>&1 | ForEach-Object { Write-Host "  $_" }
Write-Host "`n  Bug-fix commits:" -ForegroundColor Cyan
$bf = git log --oneline --all -30 2>&1 | Select-String -Pattern "bug|fix|patch|hotfix" -SimpleMatch
if ($bf) { $bf | ForEach-Object { Write-Host "    $_" -ForegroundColor Cyan } } else { Write-Host "    [NONE]" -ForegroundColor Red }
Write-Host "`n--- STALE MODEL STRINGS ---" -ForegroundColor Yellow
$stale = Get-ChildItem "$benavora\src" -Recurse -Include *.ts,*.tsx | Select-String -Pattern "claude-sonnet-4-6-\d{8}" 2>$null
if ($stale) { $stale | ForEach-Object { Write-Host "  [BAD] $($_.Filename):$($_.LineNumber) $($_.Line.Trim())" -ForegroundColor Red } }
else { Write-Host "  [OK] No dated model strings" -ForegroundColor Green }
Write-Host "`n--- DRAFT ROUTE CHECKS ---" -ForegroundColor Yellow
$dr = "$benavora\src\app\api\ai\draft\route.ts"
if (Test-Path $dr) {
    $dc = Get-Content $dr -Raw
    Write-Host "  platform_config/max_tokens ref: $(if($dc -match 'platform_config|max_tokens'){'YES'}else{'NO'})" -ForegroundColor $(if($dc -match 'platform_config|max_tokens'){'Green'}else{'Red'})
    Write-Host "  NEEDS INPUT handling: $(if($dc -match 'NEEDS.INPUT'){'YES'}else{'NO'})" -ForegroundColor $(if($dc -match 'NEEDS.INPUT'){'Green'}else{'Red'})
    Write-Host "  Humanize logic: $(if($dc -match 'humaniz'){'YES'}else{'NO'})" -ForegroundColor $(if($dc -match 'humaniz'){'Green'}else{'Red'})
    Write-Host "  Confidence logic: $(if($dc -match 'confidence'){'YES'}else{'NO'})" -ForegroundColor $(if($dc -match 'confidence'){'Green'}else{'Red'})
} else { Write-Host "  [MISSING] Draft route not found" -ForegroundColor Red }
Write-Host "`n--- ALERTS ROUTE ---" -ForegroundColor Yellow
$ar = "$benavora\src\app\api\alerts\route.ts"
if (Test-Path $ar) { Write-Host "  [EXISTS] alerts route" -ForegroundColor Green }
else {
    $found = Get-ChildItem "$benavora\src\app\api" -Recurse -Filter "route.ts" | Where-Object { $_.FullName -match "alert|notif" }
    if ($found) { $found | ForEach-Object { Write-Host "  [FOUND] $($_.FullName -replace [regex]::Escape($benavora),'')" -ForegroundColor Green } }
    else { Write-Host "  [MISSING] No alerts/notification routes" -ForegroundColor Red }
}
Write-Host "`n--- FORGE STATE ---" -ForegroundColor Yellow
$fq = "$forge\projects\benavora\queue.yaml"
if (Test-Path $fq) {
    $qc = Get-Content $fq -Raw
    $pc = ([regex]::Matches($qc, '(?m)^\s*- id:')).Count
    Write-Host "  [OK] Queue: $pc prompts" -ForegroundColor Green
    if ($qc -match '(?m)^phases:') { Write-Host "  [BAD] phases: format!" -ForegroundColor Red }
    elseif ($qc -match '(?m)^prompts:') { Write-Host "  [OK] prompts: format" -ForegroundColor Green }
} else { Write-Host "  [MISSING] $fq" -ForegroundColor Red }
if (Test-Path "$forge\projects\benavora\queue-bugfix.yaml") { Write-Host "  [EXISTS] queue-bugfix.yaml" -ForegroundColor Green } else { Write-Host "  [MISSING] queue-bugfix.yaml" -ForegroundColor Yellow }
Write-Host "`n--- MIGRATIONS ON DISK ---" -ForegroundColor Yellow
$md = "$benavora\supabase\migrations"
if (Test-Path $md) { Get-ChildItem "$md\*.sql" | Sort-Object Name | ForEach-Object { Write-Host "  $($_.Name) ($([math]::Round($_.Length/1KB,1))KB)" } }
else { Write-Host "  [MISSING] No migrations dir" -ForegroundColor Red }
Write-Host "`n--- FAITH FOUNDATION ---" -ForegroundColor Yellow
$oid = "b1ab7402-dfc2-4712-869f-70ea3566cc1d"
try {
    $org = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/organizations?select=id,name,subscription_tier&id=eq.$oid" -Headers $h
    if ($org.Count -gt 0) { Write-Host "  [OK] $($org[0].name) | tier=$($org[0].subscription_tier)" -ForegroundColor Green }
    else { Write-Host "  [MISSING] Org not found" -ForegroundColor Red }
} catch { Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red }
try {
    $opp = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/opportunities?select=id,name,status&id=eq.8851652c-2def-4bc3-8428-308c4f23fd0b" -Headers $h
    if ($opp.Count -gt 0) { Write-Host "  [OK] Opp: $($opp[0].name) | $($opp[0].status)" -ForegroundColor Green }
    else { Write-Host "  [MISSING] TX CDBG opp not found" -ForegroundColor Red }
} catch { Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red }
Write-Host "`n--- VERCEL ---" -ForegroundColor Yellow
try { $vr = Invoke-WebRequest -Uri "https://benavora.vercel.app" -Method HEAD -TimeoutSec 10 -UseBasicParsing; Write-Host "  [LIVE] HTTP $($vr.StatusCode)" -ForegroundColor Green }
catch { Write-Host "  [DOWN/ERROR] $($_.Exception.Message)" -ForegroundColor Red }
Pop-Location
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " DONE — paste output into Claude chat" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan
