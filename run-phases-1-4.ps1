cd C:\Users\manag\Documents\FORGE\projects\benavora

Write-Host "Phase 1..."
Copy-Item C:\Users\manag\Documents\benavora\queue-phase-1-scoring-foundations.yaml queue.yaml -Force
cd C:\Users\manag\Documents\FORGE
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -startFrom 0
if ($LASTEXITCODE -ne 0) { Write-Error "Phase 1 failed"; exit 1 }

Write-Host "Phase 2..."
Copy-Item C:\Users\manag\Documents\benavora\queue-phase-2-partial-completions.yaml C:\Users\manag\Documents\FORGE\projects\benavora\queue.yaml -Force
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -startFrom 0
if ($LASTEXITCODE -ne 0) { Write-Error "Phase 2 failed"; exit 1 }

Write-Host "Phase 3..."
Copy-Item C:\Users\manag\Documents\benavora\queue-phase-3-phase1-wiring.yaml C:\Users\manag\Documents\FORGE\projects\benavora\queue.yaml -Force
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -startFrom 0
if ($LASTEXITCODE -ne 0) { Write-Error "Phase 3 failed"; exit 1 }

Write-Host "Phase 4..."
Copy-Item C:\Users\manag\Documents\benavora\queue-phase-4-cleanup.yaml C:\Users\manag\Documents\FORGE\projects\benavora\queue.yaml -Force
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -startFrom 0
if ($LASTEXITCODE -ne 0) { Write-Error "Phase 4 failed"; exit 1 }

Write-Host "All phases complete."
