# BENAVORA SESSION HANDOFF — July 26, 2026
## For: Next Claude Chat Session
## Priority Order: READ THIS FIRST BEFORE DOING ANYTHING

---

## IMMEDIATE FIRST ACTION — STEALTH SCRAPER
The #1 priority is building the stealth scraper. Do NOT start UI work first.
Queue file: queue-stealth-scraper.yaml (in FORGE projects folder)
Run it immediately at session start.

---

## PROJECT CONTEXT
Benavora (benavora.com) — AI-powered nonprofit grant funding automation SaaS.
Solo founder: Reid Whitesides. Non-technical product owner.
Stack: Next.js 14, TypeScript, pnpm, Supabase, Vercel Pro, Railway, Claude API.

Repo: C:\Users\manag\Documents\benavora (GitHub: Reid64/benavora)
FORGE: C:\Users\manag\Documents\FORGE\forge.ps1
Production: www.benavora.com (aliased, always deploy with npx vercel deploy --prod)

---

## CRITICAL RULES — NEVER VIOLATE
1. ALL UI colors via hardcoded style={{}} hex — NEVER Tailwind color classes or CSS variables
2. Zero emoji anywhere in platform UI
3. All text color:#FFFFFF minimum — no rgba below 0.5 on any text element
4. Never use position:sticky on side rails or confidence panels
5. One command at a time labeled [POWERSHELL] or [CLAUDE CODE]
6. Always read actual files before writing code — never guess
7. GitHub auto-deploy is BROKEN — always run: npx vercel deploy --prod
8. Vercel CLI v51.7.0 — always answer n to upgrade prompts
9. PowerShell 5: no && chaining — use semicolons
10. FORGE $workDir fix is permanent — never revert
11. Never run npm install inside FORGE prompts — pre-install before queuing
12. Dynamic route files [id] cannot be created by FORGE on Windows — pre-create manually

---

## KEY INFRASTRUCTURE
- Supabase project: vbjplpquqxxfbpazyalt
- Faith Foundation org ID: b1ab7402-dfc2-4712-869f-70ea3566cc1d
- Supabase service role key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZianBscHF1cXh4ZmJwYXp5YWx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDkzMjI3NiwiZXhwIjoyMDk2NTA4Mjc2fQ.JabbNeSr1RYMfvHGEZP46vzfzemjrrkCfp4HVIIHITA
- Supabase anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZianBscHF1cXh4ZmJwYXp5YWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MzIyNzYsImV4cCI6MjA5NjUwODI3Nn0.DoVDBl4uGEKOhfXBgWsfjoN4Ph7imdRKmL6-yPvCLwI
- Vercel project: prj_7pn7UmQQsiEjTIHH58cfUU84p6xc
- Railway worker: bd9f0c6b-fe01-4f31-9ef7-5fe9d7d0b127
- SAM.gov API key: SAM-ca328c91-250e-4b51-a4cc-ab90ef5aab7a
- Google Maps API key (Benavora project, unrestricted): AIzaSyD-vLOdvdNAcPgExWD5MvaCQkK4jGjmBZY
- Pricing: Starter $397/mo, Professional $897/mo, Enterprise $1,997/mo

---

## DATA PIPELINE CURRENT STATE
| Source | Status | Records |
|--------|--------|---------|
| IRS BMF nonprofits | COMPLETE | 1,978,526 |
| IRS 990 XML enrichment | COMPLETE (12/12 ZIPs) | 228,736 updated |
| Foundation directory | COMPLETE | 134K records |
| Foundations seeded to donor_discovery | COMPLETE | 141,847 |
| Nonprofits with websites | PARTIAL | 6,066 |
| Foundation websites | CRITICAL GAP | 1 record only |
| Intelligence Library narratives | PARTIAL | 112 |
| Foundation email/phone | NOT STARTED | 0 |

## ENRICHMENT APPROACHES — CONFIRMED DEAD (DO NOT RETRY)
- gosom Google Maps scraper binary: crashes on Windows always
- Google Places API: private foundations have no Maps presence
- ProPublica API: 0-2% hit rate
- IRS 990 XML HTTP downloads: IRS server blocks all fetch requests
- DuckDuckGo/Bing scraping: bot detection blocks immediately

## ENRICHMENT SOLUTION — BUILD THIS FIRST
Stealth scraper using Playwright + playwright-extra-plugin-stealth.
The IRS server blocks node-fetch but NOT browser-level requests.
StealthEngine uses real browser to fetch IRS XML URLs with proper fingerprinting.
Queue file: queue-stealth-scraper.yaml — 6 prompts, builds complete scraper.

---

## UI PAGES STATUS
| Page | Status |
|------|--------|
| Dashboard | COMPLETE ✅ |
| Draft Generator | COMPLETE ✅ |
| Nonprofit Directory | COMPLETE ✅ |
| Research | FORGE built — verify live |
| Opportunities | FORGE built — verify live |
| AutoApply | FORGE built — verify live |
| Donor Discovery | FORGE built — verify live |
| Intelligence Library | NOT BUILT |
| Knowledge Base | Exists, needs reskin |

## DASHBOARD ITEMS STILL NEEDED
- Bar chart below Top Opportunities (by funding source)
- AutoApply AI trigger with live session pulse indicator
- Verify all 4 FORGE-built pages render correctly

---

## FORGE QUEUE FILES (all in C:\Users\manag\Documents\FORGE\projects\benavora\)
| File | Status | Description |
|------|--------|-------------|
| queue-stealth-scraper.yaml | READY — RUN FIRST | Stealth scraper 6 prompts |
| queue-ui-pages.yaml | READY | UI pages 7 prompts |
| queue-feature-completion.yaml | READY | Feature gaps 5 prompts |
| queue-data-enrichment.yaml | READY | Data scripts 5 prompts |

---

## FORGE CANONICAL LAUNCH COMMAND
```powershell
$repo = "C:\Users\manag\Documents\benavora"
$forge = "C:\Users\manag\Documents\FORGE\projects\benavora"
Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }
cd C:\Users\manag\Documents\FORGE
$env:NODE_OPTIONS="--max-old-space-size=8192"
$env:ANTHROPIC_API_KEY=$null
$env:DANGEROUSLY_SKIP_PERMISSIONS=1
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora
```

## GOVERNANCE SYNC (run before every FORGE launch)
```powershell
$repo = "C:\Users\manag\Documents\benavora"
$forge = "C:\Users\manag\Documents\FORGE\projects\benavora"
Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }
```

## SWITCH QUEUE COMMAND (to run specific queue)
```powershell
Copy-Item "C:\Users\manag\Documents\FORGE\projects\benavora\queue-stealth-scraper.yaml" "C:\Users\manag\Documents\FORGE\projects\benavora\queue.yaml" -Force
```

---

## SESSION GOVERNANCE DEPLOYMENT (run at end of every session)
```powershell
$repo = "C:\Users\manag\Documents\benavora"
$forge = "C:\Users\manag\Documents\FORGE\projects\benavora"
Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }
git add -A; git commit -m "governance: session handoff docs July 26 2026"; git push
```

---

## COMMUNICATION PREFERENCES
- Never open with agreement — lead with uncomfortable truths
- Use confidence tags [Certain]/[Likely]/[Guessing] on all claims
- Never use: "Great question", "Absolutely", "Definitely", "I own that"
- One command at a time labeled [POWERSHELL] or [CLAUDE CODE]
- Enterprise-caliber output only
- No paid data sources
- Never artificially cap FORGE queue lengths
- Every command must include launch path
- Uninvited work policy: only build what Reid explicitly requests

---

## NEXT SESSION PRIORITY ORDER
1. Switch queue to queue-stealth-scraper.yaml and launch FORGE
2. While scraper builds — verify FORGE-built UI pages (Research, Opportunities, AutoApply, Donor Discovery) are live and working
3. Fix any broken pages from FORGE run
4. Add bar chart and AutoApply trigger to dashboard
5. Run queue-ui-pages.yaml for Intelligence Library + Knowledge Base
6. Run queue-feature-completion.yaml
7. Run queue-data-enrichment.yaml
8. Once scraper is built: pnpm scrape:foundations (let run overnight)
