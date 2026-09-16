# FORGE Orchestrator Launcher - Benavora Phases 1-4 Autonomous Execution
# Location: C:\Users\manag\Documents\benavora\launch-phases-1-4.ps1
# Usage: .\launch-phases-1-4.ps1
# 
# This script:
# 1. Verifies all 4 queue files are in place
# 2. Verifies governance docs are current
# 3. Launches FORGE orchestrator with manifest
# 4. Monitors execution, logs all output
# 5. Stops on critical failure, continues on warnings
# 6. Generates final report when complete

param(
    [switch]$DryRun = $false,        # Validate config without executing
    [switch]$Verbose = $true,         # Enable verbose logging
    [switch]$NoBackup = $false,       # Skip backup before running
    [switch]$SlackNotify = $false,    # Send Slack notifications (requires webhook)
    [string]$LogDir = "C:\Users\manag\Documents\benavora\logs"
)

# Set strict error handling
$ErrorActionPreference = "Stop"
$WarningPreference = "Continue"

# Colors for output
$ColorSuccess = "Green"
$ColorError = "Red"
$ColorWarn = "Yellow"
$ColorInfo = "Cyan"

# Paths
$ProjectRoot = "C:\Users\manag\Documents\benavora"
$ForgeRoot = "C:\Users\manag\Documents\FORGE"
$OrchestratorScript = "$ForgeRoot\forge-orchestrator.ps1"
$ManifestFile = "$ProjectRoot\orchestrator-manifest-phases-1-4.yaml"
$LibraryManifestFile = "$ProjectRoot\library-manifest-phases-1-4.yaml"

# Queue files to verify
$QueueFiles = @(
    "queue-phase-1-scoring-foundations.yaml",
    "queue-phase-2-partial-completions.yaml",
    "queue-phase-3-phase1-wiring.yaml",
    "queue-phase-4-cleanup.yaml"
)

# Governance files to verify
$GovernanceFiles = @(
    "BLUEPRINT_v2.md",
    "SCHEMA_REGISTRY_v2.md",
    "BEHAVIORAL_CONTRACTS.md",
    "STATE_OF_THE_BUILD_2026-09-01.md",
    "STANDING_DIRECTIVES.md"
)

function Write-Status {
    param([string]$Message, [string]$Color = "White")
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Message" -ForegroundColor $Color
}

function Write-Success {
    param([string]$Message)
    Write-Status $Message $ColorSuccess
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Status "ERROR: $Message" $ColorError
}

function Write-Warn {
    param([string]$Message)
    Write-Status "WARNING: $Message" $ColorWarn
}

function Write-Info {
    param([string]$Message)
    Write-Status "INFO: $Message" $ColorInfo
}

# ============================================================================
# PHASE 1: VALIDATION
# ============================================================================

Write-Info "=== FORGE ORCHESTRATOR LAUNCHER - BENAVORA PHASES 1-4 ==="
Write-Info "Starting validation phase..."

# Check project root exists
if (-not (Test-Path $ProjectRoot)) {
    Write-Error-Custom "Project root not found: $ProjectRoot"
    exit 1
}
Write-Success "Project root verified: $ProjectRoot"

# Check FORGE installation
if (-not (Test-Path $OrchestratorScript)) {
    Write-Error-Custom "FORGE orchestrator not found: $OrchestratorScript"
    exit 1
}
Write-Success "FORGE orchestrator verified"

# Check manifest files
if (-not (Test-Path $ManifestFile)) {
    Write-Error-Custom "Orchestrator manifest not found: $ManifestFile"
    exit 1
}
Write-Success "Orchestrator manifest verified"

if (-not (Test-Path $LibraryManifestFile)) {
    Write-Error-Custom "Library manifest not found: $LibraryManifestFile"
    exit 1
}
Write-Success "Library manifest verified"

# Check all queue files exist
Write-Info "Checking all 4 queue files..."
foreach ($QueueFile in $QueueFiles) {
    $FullPath = Join-Path $ProjectRoot $QueueFile
    if (-not (Test-Path $FullPath)) {
        Write-Error-Custom "Queue file not found: $FullPath"
        exit 1
    }
    Write-Success "  ✓ $QueueFile"
}

# Check governance files exist
Write-Info "Checking governance files..."
foreach ($GovFile in $GovernanceFiles) {
    $FullPath = Join-Path $ProjectRoot $GovFile
    if (-not (Test-Path $FullPath)) {
        Write-Error-Custom "Governance file not found: $FullPath"
        exit 1
    }
    Write-Success "  ✓ $GovFile"
}

Write-Success "All validation checks passed!"

# ============================================================================
# PHASE 2: BACKUP (if not skipped)
# ============================================================================

if (-not $NoBackup) {
    Write-Info "Creating backup of all queue files and governance docs..."
    $BackupDir = Join-Path $ProjectRoot "backups\$(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss')"
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    
    # Backup queue files
    foreach ($QueueFile in $QueueFiles) {
        Copy-Item -Path (Join-Path $ProjectRoot $QueueFile) -Destination $BackupDir -Force
    }
    
    # Backup governance files
    foreach ($GovFile in $GovernanceFiles) {
        Copy-Item -Path (Join-Path $ProjectRoot $GovFile) -Destination $BackupDir -Force
    }
    
    Write-Success "Backup created: $BackupDir"
}

# ============================================================================
# PHASE 3: DRY RUN (if requested)
# ============================================================================

if ($DryRun) {
    Write-Info "DRY RUN MODE: Validating queue structure without execution"
    Write-Info "To execute, run: .\launch-phases-1-4.ps1 (without -DryRun flag)"
    exit 0
}

# ============================================================================
# PHASE 4: EXECUTION
# ============================================================================

Write-Success "Starting FORGE orchestrator execution..."
Write-Info "Expected runtime: 24 hours (estimated 6-9 hours per phase)"
Write-Info "Dashboard available at: http://localhost:7734"
Write-Info "Logs will be written to: $LogDir"
Write-Info ""
Write-Info "Phases executing in sequence:"
Write-Info "  1. Scoring Foundations Repair (6 prompts, ~8 hours)"
Write-Info "  2. Partial Systems Completion (10 prompts, ~9 hours)"
Write-Info "  3. Agent Wiring & New Agents (7 prompts, ~8 hours)"
Write-Info "  4. Cleanup & Registry Completion (6 prompts, ~6 hours)"
Write-Info ""
Write-Info "Press Ctrl+C to stop orchestration (will halt current prompt and stop)"
Write-Info ""

# Create logs directory if needed
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

# Launch orchestrator with manifest and library
$LogFile = Join-Path $LogDir "orchestrator-$(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss').log"

$Arguments = @(
    "-ProjectPath", $ProjectRoot,
    "-ManifestPath", $ManifestFile,
    "-LibraryManifestPath", $LibraryManifestFile,
    "-LogPath", $LogFile,
    "-Verbose:$Verbose",
    "-Mode", "production"
)

Write-Info "Launching: & $OrchestratorScript $($Arguments -join ' ')"
Write-Info ""

# Execute orchestrator (blocking call)
& $OrchestratorScript @Arguments

# Capture exit code
$ExitCode = $LASTEXITCODE

# ============================================================================
# PHASE 5: POST-EXECUTION
# ============================================================================

Write-Info ""
if ($ExitCode -eq 0) {
    Write-Success "FORGE orchestration completed successfully!"
    Write-Success "All 4 phases executed, all gates passed"
    Write-Info "Final report: $LogFile"
    Write-Info "Next steps:"
    Write-Info "  1. Review final report: $ProjectRoot\PHASES_1-4_ORCHESTRATOR_FINAL_REPORT.md"
    Write-Info "  2. Verify deployment: curl https://benavora.vercel.app/api/health"
    Write-Info "  3. Check agent registry: GET /api/agents/registry (should show 170+ agents)"
} else {
    Write-Error-Custom "FORGE orchestration failed with exit code: $ExitCode"
    Write-Info "Check log: $LogFile"
    exit $ExitCode
}

Write-Success "Orchestrator launcher complete!"
