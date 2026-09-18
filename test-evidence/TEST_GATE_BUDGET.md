# Test Gate Budget — AR-8.2

**Measured:** 2026-09-18
**Machine:** local dev (Windows 11, pnpm + vitest 2.1.9)
**FORGE gate ceiling:** 300s wall-clock, process tree killed on overrun.

This file exists so the gate ceiling is a decision with a number behind it
rather than a surprise at 2am. Re-measure and update it whenever the suite
grows materially or the ceiling moves.

---

## 1. Why this measurement was taken

On 2026-09-17 21:45 the FORGE test gate reported, during AR-7.1:

```
TIMEOUT after 300s, process tree killed
[GATE:test] Found 156 spec file(s). Running pnpm test...
```

The work under test was correct. The gate ran out of clock and burned a
retry. A gate that times out on healthy work is a **false fail** — the same
defect class as a gate that passes broken work.

Commit `05eeab6` moved the live-network suites out of the default gate. This
measurement confirms that fix worked and records the remaining headroom.

---

## 2. Measured wall-clock

| Subset | Command | Run 1 | Run 2 | Run 3 (post-build) | Spec files | Tests |
|---|---|---:|---:|---:|---:|---:|
| **Default gate (unit)** | `pnpm test` / `pnpm test:unit` | **13s** | **14s** | **27s** | 92 | 860 passed, 13 todo, 1 file skipped |
| **Integration (live)** | `pnpm test:integration` | **380s** | not re-run | — | 24 | 101 passed, 2 skipped |

Vitest's own reported `Duration` for the default suite was 10.67s, 11.55s and
14.66s; the wall-clock figures include pnpm/node startup, which is what the
gate actually pays. **Use the wall-clock number.**

**Run 3 is the number that matters for the gate.** Runs 1 and 2 were cold
invocations in isolation. Run 3 was executed immediately after
`pnpm run build`, which is how FORGE actually sequences its gates — the test
gate inherits a machine whose disk cache and CPU are still busy from a
Next.js production build. That roughly doubles the cost, 14s → 27s. **Budget
against 27s, not 14s.** Any future measurement taken in isolation will
understate what the gate pays.

### Headroom against the 300s ceiling

| Subset | Measured | Ceiling | Used | **Headroom** |
|---|---:|---:|---:|---:|
| Default gate | **27s** (worst case, post-build) | 300s | 9.0% | **91.0%** |
| Default gate | 14s (isolated, best case) | 300s | 4.7% | 95.3% |
| Integration | 380s | 300s | 127% | **−27% (exceeds ceiling)** |

**Headroom on the gated suite is 91.0% against the realistic post-build
number — far above the 40% threshold. No change to FORGE's ceiling is
required, and no sharding is needed today.**

The integration suite **exceeds the 300s ceiling on its own** (380s > 300s).
This is the direct, measured cause of the AR-7.1 timeout: while those files
were inside the default suite, the gate could not have passed regardless of
how correct the code was. They must not be returned to the gated suite.

---

## 3. Where the time goes

### Default gate — slowest files (all > 1s)

| File | Tests | Time |
|---|---:|---:|
| `src/lib/sources/grantsgov-client.test.ts` | 21 | 6894ms |
| `src/__tests__/unit/government-grants-orchestration.test.ts` | 7 | 4008ms |
| `src/__tests__/unit/pil-workflow.test.ts` | 6 | 3484ms |
| `src/__tests__/unit/knowledge-indexer-agent.test.ts` | 1 | 3026ms |
| `src/__tests__/unit/pil-int-agents.test.ts` | 23 | 1845ms |
| `src/__tests__/unit/pil-dis-agents.test.ts` | 27 | 1741ms |
| `src/__tests__/unit/pil-qlf-knw-agents.test.ts` | 27 | 1552ms |
| `src/__tests__/unit/zoho-auth.test.ts` | 7 | 1336ms |
| `src/__tests__/unit/pil-str-agents.test.ts` | 9 | 1051ms |
| `src/__tests__/unit/pil-sup-agents.test.ts` | 19 | 1014ms |
| `src/__tests__/unit/pil-rel-agents.test.ts` | 35 | 1011ms |

No single unit file is near a problem. `grantsgov-client.test.ts` is the
outlier at 6.9s because four of its cases exercise retry/backoff paths with
mocked `fetch` (~1.7s each of real timer wait). That is deliberate coverage
of the fallback behaviour, not waste — see §6 before touching it.

### Integration — slowest files

| File | Tests | Time |
|---|---:|---:|
| `integration-live/autoapply-queue-live-worker.test.ts` | 2 | 125819ms |
| `integration/autoapply-mutual-exclusion.test.ts` | 5 | 84747ms |
| `integration/autoapply-submit-integrity.test.ts` | 4 | 44753ms |
| `integration/form-analyzer-filler.test.ts` | 4 | 28180ms |
| `integration/rls.test.ts` | 1 | 15327ms |
| `integration/relationship-scoring-consolidation.test.ts` | 3 | 7336ms |
| `integration/storage-rls.test.ts` | 1 | 7261ms |
| `integration/agency-rls.test.ts` | 9 | 6346ms |

Three files account for 255s of the 380s. They poll a separately-deployed
Railway worker in real time, launch real Playwright browsers, and make live
Anthropic and Supabase calls. `vitest.integration.config.ts` sets
`fileParallelism: false` deliberately (see its header comment), so these
costs are additive by design — serializing removed a class of flaky
cross-file contention that was worse than the wall-clock cost.

---

## 4. The split

| Script | Config | Runs | In FORGE gate? |
|---|---|---|---|
| `pnpm test` | `vitest.config.ts` | unit + mocked only | **yes** |
| `pnpm test:unit` | `vitest.config.ts` | same as `test` | no (alias for local use) |
| `pnpm test:integration` | `vitest.integration.config.ts` | `src/__tests__/integration/` + `src/__tests__/integration-live/` | **no** |
| `pnpm test:e2e` | `playwright.config.ts` | `e2e/`, `tests/e2e/` | **no** |

`vitest.config.ts` excludes, by glob:

- `src/__tests__/integration-live/**` — live Railway worker, live prod org
- `src/__tests__/integration/**` — real Playwright browsers, live Anthropic, live Supabase
- `tests/e2e/**` — Playwright's own lane
- `node_modules`, `.next`

Excluding these by glob is correct. Running them in a build gate is not:
they depend on credentials, third-party availability, and shared production
state that a build gate has no business asserting on.

---

## 5. Spec-file count at time of measurement

| Scope | Count |
|---|---:|
| Git-tracked spec files (`*.test.ts(x)`, `*.spec.ts(x)`) | **162** |
| — collected by the default gate | 92 |
| — collected by `test:integration` | 24 (21 integration + 3 integration-live) |
| — Playwright (`e2e/`, `tests/e2e/`) | 41 |
| — quarantined (not collected by anything) | 4 |
| FORGE's reported count on 2026-09-17 | 156 |

The gate's 156 and today's 162 are the same measure one day apart: **+6 spec
files in ~24 hours.** The growth trend in the task premise is real. At the
current post-build unit-suite cost (~0.29s per collected spec file,
wall-clock), the default gate would need roughly **900 more unit spec
files** to reach the 300s ceiling. The ceiling is not the near-term risk; adding a live-network
file back into the default glob is.

**Naive `find` over the repo reports 294 spec files. Do not use that
number** — 132 of them are copies inside `.claude/worktrees/` and 4 are in
`.quarantine-2026-09-06-unrelated-tsc-break/`. Only the git-tracked count is
meaningful.

---

## 6. Candidates for human decision — NOT removed

Per AR-8.2 STEP 5, nothing below was deleted, skipped, or weakened. These
are listed for a human to decide on.

1. **`tests/api/analytics.test.ts` — 13 tests, all 13 skipped.** Collected by
   the default gate every run and contributes zero assertions. Either the
   skip reason has been resolved and it should be re-enabled, or it is dead
   and should be removed. It costs almost nothing in time; it costs
   credibility in the pass count.

2. **`.quarantine-2026-09-06-unrelated-tsc-break/` — 4 spec files.** Parked
   on 2026-09-06 for a tsc break described in the directory name as
   unrelated. Twelve days quarantined. They are collected by nothing, so
   they are currently coverage that exists on disk but protects nothing:
   `confirmation-monitor-zoho-parsing`, `corporate-foundations`,
   `foundation-grants-orchestration`, `state-portal-geographic-scope`.
   Decision needed: restore or delete.

3. **`src/lib/sources/grantsgov-client.test.ts` retry cases — 6.9s.** Four
   cases spend ~1.7s each waiting out real retry backoff. Injecting a fake
   timer would reclaim ~5s. Not worth doing at 95% headroom, and doing it
   badly would weaken genuine coverage of the fallback path. Recorded only
   so the next person to look at the slowest-file list does not rediscover
   it.

No genuinely redundant or duplicated specs were found.

---

## 7. Known environment failure (not a code defect)

`pnpm test:integration` exits 1 with one failed suite:

```
FAIL src/__tests__/integration-live/success-probability-upsert-constraint.test.ts
error: password authentication failed for user "postgres"
```

This is the direct-Postgres `DATABASE_URL` credential failing auth (28P01),
not a regression in the code under test. That credential has flapped
dead/alive repeatedly across recent sessions. 101 of 103 integration tests
passed; 2 skipped; **zero test-level assertion failures.**

This is itself an argument for the split: a build gate must not fail because
a database password rotated overnight. In the gated suite, it cannot.

---

## 8. Recommendations

1. **Do not raise FORGE's 300s ceiling.** At 91% headroom there is no
   case for it. (Per AR-8.2 STEP 4, `forge.ps1` was not edited from this
   run — changing a build tool from inside a build it is running is how you
   lose an overnight run. This is a recommendation only.)
2. **Do not shard the gate.** Sharding adds coordination cost to buy time
   that is not needed.
3. **Never add the integration or integration-live globs back to
   `vitest.config.ts`.** Measured at 380s, they exceed the ceiling
   unaided. The comment block in `vitest.config.ts` explains this at the
   edit site; this file supplies the number.
4. **Re-measure when the default gate exceeds ~120s** (60% headroom
   consumed) and update this file. Measure it *after* a build, not in
   isolation — see §2. That is the point at which the ceiling
   becomes a live question rather than a theoretical one.
5. **Run `pnpm test:integration` on a schedule or before release, not in
   the build gate** — it is real coverage and should not rot, but it needs
   live credentials and ~6.5 minutes.

---

## 9. Reproducing these numbers

```bash
# default gate — expect ~14s cold, ~27s immediately after a build
pnpm test

# integration — expect ~380s, needs live Supabase/Anthropic/Railway creds
pnpm test:integration

# git-tracked spec count — expect 162
git ls-files | grep -cE "\.(test|spec)\.(ts|tsx)$"
```
