# REMAINING_WORK — Benavora Post-Build Tasks
**Session:** 2026-09-01 (8 queues, 44 prompts, all passed)  
**Status:** Production live, ready for canary rollout  
**Next Phase:** Week 1-2 canary (10% beta orgs) + monitoring

---

## CRITICAL PATH (MUST DO BEFORE CANARY)

### 1. LaunchDarkly Configuration (2-3 hours)
**Priority:** CRITICAL — blocks canary rollout  
**Owner:** Reid or DevOps  
**Tasks:**
- [ ] Create LaunchDarkly account/org (if not exists)
- [ ] Create 5 feature flags:
  - `pil-enabled` (boolean) → set targeting to 10% (beta orgs only)
  - `pil-dossier-ui` (boolean) → set targeting to 10% (beta orgs only)
  - `pil-autoapply-source` (string: prospects/dossiers) → default "prospects" (safe fallback)
  - `pil-agent-family-strictness` (string: lenient/strict/manual_review) → default "lenient"
  - `pil-max-concurrent-runs` (integer) → default 5
- [ ] Configure targeting:
  - Create "pil_beta_testers" segment (5 orgs)
  - Set pil-enabled = true for segment
  - Set pil-dossier-ui = true for segment
  - Set pil-autoapply-source = "dossiers" for segment
- [ ] Verify flags accessible from `src/lib/feature-flags/ld-client.ts`
- [ ] Test flag calls in staging environment
- [ ] Get LaunchDarkly SDK key, store in env vars

**Acceptance Criteria:**
- All 5 flags created
- Beta orgs (10%) can toggle flags
- Fallbacks work (no flag access → safe defaults)
- Slack channel #benavora-alerts ready for flag change notifications

---

### 2. Canary Test Environment Setup (3-4 hours)
**Priority:** CRITICAL — blocks week 1 canary launch  
**Owner:** DevOps + Reid  
**Tasks:**
- [ ] Select 5 beta test organizations (recommendation: smallest active orgs for risk mitigation)
- [ ] Verify 5 test orgs have:
  - Active user accounts
  - At least 50 prospects in discovery pipeline
  - Recent activity (last 7 days)
  - Willing to test new feature
- [ ] Notify test orgs 24h before canary starts
- [ ] Create test data set (100+ mixed prospects):
  - SAM.gov opportunities
  - Grants.gov opportunities
  - Manual prospects
  - Mix of high/medium/low capacity indicators
- [ ] Set monitoring alert threshold to 5% error rate (auto-rollback trigger)
- [ ] Create Slack channel #benavora-canary for real-time updates
- [ ] Brief support team on new features/issues they might see

**Acceptance Criteria:**
- 5 beta orgs confirmed and ready
- Test data loaded (100+ prospects)
- Monitoring dashboard live
- Alert thresholds set
- Support team trained on PIL features

---

### 3. Production Monitoring Setup (2-3 hours)
**Priority:** CRITICAL — required for safe canary  
**Owner:** DevOps  
**Tasks:**
- [ ] Connect Prometheus scraper to /api/metrics endpoint
  - Scrape interval: 15 seconds
  - Retention: 30 days
- [ ] Setup Grafana:
  - Create dashboard from `queue-observability-monitoring-REAL.yaml` spec
  - 4 panels: success rates by family, duration histograms, dossier completion, error log
  - Set auto-refresh: 10 seconds
- [ ] Configure Prometheus alert rules:
  - AgentFamilyFailureRate > 5% → #benavora-alerts
  - HighAPILatency p95 > 5s → #benavora-alerts
  - AuthFailureSpike > 0.1/sec → #benavora-alerts
  - SupabaseSlowQueries p95 > 1s → #benavora-alerts
- [ ] Setup log aggregation:
  - Collect from: logs/combined.log, logs/error.log
  - Ship to: ELK stack or DataDog or CloudWatch
  - Retention: 30 days
- [ ] Setup uptime monitoring:
  - Ping /api/health every 60 seconds
  - Alert if down for > 1 minute
- [ ] Create runbook dashboards:
  - "Dossier Completion Rate" (should stay > 90%)
  - "Agent Success Rate by Family" (should stay > 95%)
  - "API Latency Percentiles" (p95 < 2s, p99 < 5s)
  - "Error Rate Trend" (should stay < 0.5%)

**Acceptance Criteria:**
- Prometheus scraping /api/metrics successfully
- Grafana dashboard live with real data
- Alert rules firing (test with synthetic spike)
- Logs flowing to aggregation backend
- Uptime monitoring responding

---

## HIGH PRIORITY (BEFORE WEEK 3 CANARY EXPANSION)

### 4. Security Audit (4-5 hours)
**Priority:** HIGH — required for CAN-SPAM + data privacy  
**Owner:** Security team + Reid  
**Tasks:**
- [ ] Verify RLS blocks cross-org access:
  - Test as org A: cannot read suppression_list from org B
  - Test as org A: cannot read outreach_campaigns from org B
  - Test as org A: cannot read pil_prospects from org B
  - Test as org A: cannot read pil_prospect_dossiers from org B
- [ ] Verify CAN-SPAM compliance:
  - suppression_list properly isolated per org
  - Email sending respects suppression list
  - Unsubscribe links functional
  - Email headers proper (From, Reply-To, List-Unsubscribe)
- [ ] Verify autosave doesn't leak data:
  - Auto-save only to authenticated user's org
  - Drafts are org-isolated
  - No cross-org draft access
- [ ] Penetration test (basic):
  - Try SQL injection on form inputs
  - Try to bypass auth middleware
  - Try to access /api/metrics from unauthenticated user
  - Try to access admin routes from regular user
- [ ] Data privacy audit:
  - PIL agent logs don't contain PII
  - Error logs sanitize sensitive data
  - Supabase backups encrypted

**Acceptance Criteria:**
- All RLS tests pass (cross-org data truly isolated)
- CAN-SPAM checklist 100% pass
- No penetration test findings
- Data privacy compliance verified
- Security audit report generated

---

### 5. SAM.gov Integration Scale Test (3-4 hours)
**Priority:** HIGH — WGR-142/143 needs live validation  
**Owner:** Reid + QA  
**Tasks:**
- [ ] Create test load:
  - 100 concurrent SAM.gov searches
  - 500 SAM.gov IDs queued for import
  - Measure: success rate, latency, rate-limit hits
- [ ] Run against production SAM.gov API
  - Verify API key still valid (check SAM_API_KEY env var)
  - Measure rate limit: ensure 429 errors properly handled
  - Check backoff: verify exponential backoff working (100ms → 200ms → 400ms)
- [ ] Verify error recovery:
  - Simulate network failure: error should be recoverable
  - Simulate rate limit: should retry with backoff
  - Simulate malformed response: should log error, skip record
- [ ] Monitor database:
  - integration_parser_errors table: should have < 1% error rate
  - pil_prospects table: should have 500+ new records
  - pil_research_runs: should show 500+ pending runs
- [ ] Run for 2+ hours continuously
  - Watch for memory leaks in worker
  - Watch for stuck connections
  - Verify circuit breaker doesn't trip

**Acceptance Criteria:**
- 500 records ingested with < 1% error rate
- No 429 errors (rate limiting working)
- Error recovery successful (no manual intervention)
- Worker memory stable (no spike > 200MB)
- Integration parser errors table clean

---

### 6. Dossier Completion Time Baseline (2-3 hours)
**Priority:** HIGH — required for SLA definition  
**Owner:** Reid + QA  
**Tasks:**
- [ ] Create test batch:
  - 50 mixed prospects (high/medium/low capacity)
  - Mix of entity types (person, company, foundation, nonprofit)
  - Mix of data availability (complete vs incomplete)
- [ ] Measure per-family execution time:
  - SUP family: X ms (should be < 5s)
  - DIS family: X ms (should be < 30s, web search intensive)
  - INT family: X ms (should be < 10s)
  - REL family: X ms (should be < 5s)
  - QLF family: X ms (should be < 5s)
  - STR family: X ms (should be < 3s)
  - KNW family: X ms (should be < 5s)
  - OPS family: X ms (should be < 2s)
  - APP family: X ms (should be < 3s)
  - **Total per dossier: should be < 2 minutes**
- [ ] Identify bottlenecks:
  - Which families are slowest?
  - Are there N+1 queries?
  - Are there timeouts?
- [ ] Document SLA:
  - Create SLA doc: "Dossier completion: p50 < 60s, p95 < 120s, p99 < 180s"
  - Set monitoring alert: if p95 > 120s → alert

**Acceptance Criteria:**
- 50 dossiers completed
- Average time < 2 minutes
- Slowest family identified + documented
- SLA defined and monitoring alert set

---

## MEDIUM PRIORITY (BEFORE WEEK 5 GA)

### 7. AutoApply Dossier Queue Performance Test (3-4 hours)
**Priority:** MEDIUM — required before GA rollout  
**Owner:** Reid + QA  
**Tasks:**
- [ ] Create test scenario:
  - 500 dossiers with app_priority_score > 50
  - Call /api/autoapply/queue-populate
  - Measure queue population time
- [ ] Verify queue items created:
  - 500 items should appear in autoapply_submission_queue
  - Each should have: prospect_dossier_id, dossier_context, suggested_ask_amount, personalized_pitch, risk_factors
- [ ] Test FormFillerAgent consumption:
  - Manually trigger form-filler for 10 queue items
  - Verify forms filled with dossier data (not generic KB data)
  - Verify personalized pitches used
  - Verify field_mappings applied correctly
- [ ] Monitor:
  - Database query performance (Supabase slow queries)
  - API latency (amount-optimizer, pitch-personalizer calls)
  - Memory usage (form-filler processing)
- [ ] Verify fallback:
  - Set pil-autoapply-source = "prospects"
  - Queue should populate from pil_prospects (old behavior)
  - Verify old behavior still works (rollback path)

**Acceptance Criteria:**
- 500 queue items created in < 5 minutes
- FormFillerAgent successfully fills 10/10 forms
- Dossier context (pitch, mappings, risks) visible in submission UI
- Fallback to old data source working
- No database performance regression

---

### 8. E2E Test Execution in CI/CD (2-3 hours)
**Priority:** MEDIUM — required for development confidence  
**Owner:** DevOps + Reid  
**Tasks:**
- [ ] Verify GitHub Actions pipeline running:
  - Push to develop branch
  - GitHub Actions should trigger
  - CI should run: lint → build → unit tests → E2E tests
  - Should take < 20 minutes total
- [ ] Run E2E test suite locally:
  ```powershell
  pnpm exec playwright test
  ```
  - Should see: critical-flows.spec.ts ✓ (7 tests)
  - Should see: api.spec.ts ✓ (3 tests)
  - Expect: all pass on first run
- [ ] Verify test artifacts:
  - playwright-report/ generated with HTML
  - test-results/results.json generated
  - test-results/junit.xml generated
- [ ] Run against staging:
  - Set PLAYWRIGHT_TEST_BASE_URL=https://staging.benavora.com
  - Run E2E tests against staging
  - Should all pass
- [ ] Document test runbook:
  - How to run locally
  - How to run in CI/CD
  - How to debug failing tests
  - How to add new test scenarios

**Acceptance Criteria:**
- 10 E2E tests passing on main branch
- GitHub Actions CI/CD completing successfully
- Test report artifacts generated
- Tests passing against staging environment

---

### 9. Disaster Recovery Test (3-4 hours)
**Priority:** MEDIUM — required before scaling  
**Owner:** DevOps  
**Tasks:**
- [ ] Test PITR (Point-in-Time Recovery):
  - Insert test record into pil_prospects
  - Wait 30 seconds
  - Restore database to 1 minute ago
  - Verify test record is gone
  - Restore to current
- [ ] Test S3 backups:
  - Verify daily backup script ran
  - Check S3 bucket: benavora-prod-backups
  - Verify file size > 10MB
  - Verify encryption enabled
  - Verify cross-region replication to us-west-2
- [ ] Test circuit breaker:
  - Simulate agent failure (throw error in test agent)
  - Circuit breaker should open after 5 failures
  - Requests should return graceful degradation
  - After 60s timeout, should enter HALF_OPEN
  - After 2 successes, should close
- [ ] Test health check:
  - Call /api/health
  - Should return 200 with status="healthy"
  - Simulate database down: /api/health should return 503 with status="degraded"
  - Restore database: /api/health should return 200 again
- [ ] Test incident runbook:
  - SEV-1 scenario: simulate Supabase outage
  - Follow runbook steps
  - Verify escalation notifications work
  - Verify chat/wiki accessible for runbook reference

**Acceptance Criteria:**
- PITR restore verified working
- S3 backup verified accessible
- Circuit breaker properly opens/closes
- /api/health reflecting actual system state
- Incident runbook executable end-to-end

---

## LOWER PRIORITY (AFTER WEEK 5 GA)

### 10. Observability Dashboard Tuning (2-3 hours)
**Priority:** LOW — nice-to-have after canary  
**Owner:** DevOps + Reid  
**Tasks:**
- [ ] Fine-tune Grafana dashboard:
  - Adjust refresh rate based on actual data volume
  - Add additional panels (if needed):
    - "Agent execution timeline" (Gantt chart)
    - "Prospect journey flow" (Sankey diagram)
    - "Database query slow log" (top 10 slow queries)
- [ ] Add dashboard annotations:
  - Mark canary start date
  - Mark GA rollout date
  - Mark any incidents
- [ ] Create on-call runbook dashboard:
  - Quick reference: key metrics to check
  - Shortcuts to common debugging steps
  - Links to incident runbook
- [ ] Train on-call on using dashboard

**Acceptance Criteria:**
- Dashboard useful for on-call troubleshooting
- All key metrics visible at a glance
- Runbook dashboard accessible and clear

---

### 11. Deprecation of Old Prospect System (4-5 hours, defer to Week 7+)
**Priority:** LOW — only after 100% PIL adoption  
**Owner:** Reid + Architecture team  
**Tasks:**
- [ ] Inventory old system:
  - Identify all code using old pil_prospects as source
  - Identify all API routes reading from old system
  - Identify all UI components referencing old system
- [ ] Create migration script:
  - Map old prospect data to new dossier structure
  - Verify no data loss in mapping
  - Test on large dataset (10K+ prospects)
- [ ] Sunset old code:
  - Remove old populateFromProspects() function
  - Remove old pil_prospects reading code
  - Delete old prospect discovery logic (if exists)
- [ ] Archive old tables (don't delete yet):
  - Keep pil_prospects table but stop populating
  - Keep for 90 days as safety net
  - After 90 days, archive to S3, delete from DB

**Acceptance Criteria:**
- All old code removed
- No references to old prospect system
- New dossier system handling 100% of load
- Old data safely archived

---

### 12. Performance Optimization Backlog (defer to future)
**Priority:** LOW — only if metrics show need  
**Owner:** Reid + Architecture  
**Candidates:**
- [ ] Parallelize agent families (instead of sequential)
  - Currently: SUP → DIS → INT → ... (sequential, safe)
  - Could be: SUP + DIS + INT in parallel (faster but complex)
  - Decision: only if p95 dossier time exceeds 120s in canary
- [ ] Implement agent result caching
  - Cache DIS findings for 7 days
  - Cache KNW findings for 30 days
  - Only re-run if explicitly triggered
  - Decision: only if repeated dossier requests are common
- [ ] Database query optimization
  - Add missing indexes
  - Denormalize hot data (unlikely needed)
  - Read replicas for reporting (if needed)
  - Decision: only if Supabase slow query log shows issues

---

## DECISION POINTS (REQUIRING REID INPUT)

### Decision 1: Canary Org Selection
**Question:** Which 5 beta orgs for week 1 canary?  
**Options:**
- A) Smallest 5 (lowest risk)
- B) Most active 5 (best feedback)
- C) Mix of sizes (representative sample)  
**Recommendation:** Option C (mix of sizes, 1 large org for feedback value)

### Decision 2: Rollback Trigger Threshold
**Question:** At what error rate do we auto-rollback?  
**Current Default:** 5%  
**Options:**
- A) 2% (aggressive, might rollback on minor issues)
- B) 5% (balanced, current default)
- C) 10% (conservative, allows more issues)  
**Recommendation:** 5% (current default is reasonable)

### Decision 3: Canary Duration
**Question:** How long does week 1 canary run (10% rollout)?  
**Options:**
- A) 3 days (fast feedback, less data)
- B) 7 days (full week, robust data)
- C) Until hitting 1000 dossiers (data-driven)  
**Recommendation:** 7 days (Option B, standard practice)

### Decision 4: LaunchDarkly vs Manual Config
**Question:** Use LaunchDarkly for flags or manual env vars?  
**Options:**
- A) LaunchDarkly (real-time flag changes, no deploy)
- B) Environment variables (simpler, requires deploy to change)  
**Recommendation:** LaunchDarkly (Option A, allows real-time rollout control)

---

## DEPENDENCIES & BLOCKERS

| Task | Blocked By | Status |
|------|-----------|--------|
| LaunchDarkly Config | None | READY (can start immediately) |
| Canary Test Setup | LaunchDarkly config | BLOCKED until config done |
| Monitoring Setup | None | READY (can start immediately) |
| Security Audit | None | READY (can start immediately) |
| SAM.gov Scale Test | None | READY (can start immediately) |
| AutoApply Queue Test | Canary test setup | BLOCKED until setup done |
| E2E Test Execution | None | READY (can start immediately) |
| Disaster Recovery Test | None | READY (can start immediately) |

---

## PARALLEL EXECUTION PLAN

**Can run simultaneously (no dependencies):**
- LaunchDarkly configuration (2-3h)
- Production monitoring setup (2-3h)
- Security audit (4-5h)
- SAM.gov scale test (3-4h)
- E2E test execution (2-3h)
- Disaster recovery test (3-4h)

**Can run after LaunchDarkly:**
- Canary test environment setup (3-4h)
- Dossier completion time baseline (2-3h)
- AutoApply dossier queue test (3-4h)

**Estimated total time (parallel execution):** 15-20 hours over 2-3 days

---

## SUCCESS CRITERIA FOR WEEK 1 CANARY

- [ ] All 5 beta orgs can see Intelligence tab (feature flag working)
- [ ] 100+ prospects enriched with complete dossiers (no errors)
- [ ] AutoApply queue shows intelligence-ranked prospects
- [ ] FormFillerAgent filling forms with dossier data (not generic KB)
- [ ] Error rate < 0.5% (alert threshold not breached)
- [ ] API latency p95 < 2 seconds (no degradation)
- [ ] Dossier completion avg < 2 minutes (SLA met)
- [ ] SAM.gov integration < 1% error rate (scale test stable)
- [ ] No data loss from auto-save feature
- [ ] RLS verified blocking cross-org access
- [ ] Support team zero escalations (features working as designed)

---

## NEXT SESSION HANDOFF

See `HANDOFF_2026-09-01.md` for detailed continuation prompt.

**Quick Summary:**
1. Start with LaunchDarkly config (2-3h)
2. Parallel: monitoring, security audit, testing (20-30h total)
3. Execute week 1 canary with 5 beta orgs
4. Daily monitoring + quick adjustments
5. Week 3: expand to 25% if canary successful
