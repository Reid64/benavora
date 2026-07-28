# Filter Feasibility Audit — Revenue (nonprofits) & Foundation Type (foundation_directory)

**Date:** 2026-07-27
**Project:** `vbjplpquqxxfbpazyalt` (live prod Supabase)

## Methodology / tooling note

The task asked for the Supabase **Management API** REST pattern (per `SCHEMA_REGISTRY_v2.md` §8.3, token `sbp_a635...`). That token was re-tested against `POST /v1/projects/vbjplpquqxxfbpazyalt/database/query` and **still returns 401 Unauthorized** — consistent with the prior finding recorded in project memory (`benavora-management-api-pat-rejected`, 2026-07-19). Arbitrary-SQL access via the Management API is not available with any credential currently in this repo/environment.

All numbers below were instead obtained via **PostgREST** (`https://vbjplpquqxxfbpazyalt.supabase.co/rest/v1/...`) using the `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`, which bypasses RLS. Row counts used `Prefer: count=exact` with a minimal `Range` (no data-modifying calls were made — read-only `GET`s throughout). Column types were confirmed via `GET /rest/v1/` OpenAPI introspection, parsed with `System.Web.Script.Serialization.JavaScriptSerializer` (PowerShell's built-in `ConvertFrom-Json` fails/throws on this schema's size — 145 table definitions, 880KB+ payload). Classification-distribution and name-pattern figures for `foundation_directory` required pulling all 133,812 rows' `foundation_type` / `organization_type` / `subsection_code` / `name` columns client-side (PostgREST has no `GROUP BY`), paginated in the platform's 1,000-row-per-request cap (134 requests), and aggregated with Python.

---

## 1. `nonprofits` — revenue/income columns

Three numeric financial columns exist (all confirmed live via OpenAPI introspection, type `numeric`/`number`):

| Column | Type | Non-null count | Non-null % (of 1,978,526 total rows) |
|---|---|---|---|
| `revenue_amount` | numeric | 1,399,759 | **70.75%** |
| `income_amount` | numeric | 1,525,483 | 77.10% |
| `asset_amount` | numeric | 1,525,735 | 77.11% |

Total live row count confirmed at query time: **1,978,526** (matches the figure given in the task).

`revenue_amount` is the column that maps to "total revenue" and is the natural filter target — it's also the sparsest of the three, meaning ~29% of rows would be silently excluded by a `revenue_amount IS NOT NULL` filter (not necessarily $0 revenue — just unenriched/unknown). There is no separate `gross_receipts` column; `revenue_amount` is the closest analog.

---

## 2. `foundation_directory` — foundation type/classification columns

Three classification columns exist, all raw IRS BMF codes (confirmed via OpenAPI introspection as `text`; two more classification-shaped columns — `organization_type`, `activity_codes` — exist live but are **not documented** in `SCHEMA_REGISTRY_v2.md`'s foundation_directory section):

**`foundation_type`** (IRS BMF "FOUNDATION" code) distribution across all 133,812 rows:

| Value | Count | % |
|---|---|---|
| `04` | 124,460 | 93.0% |
| `03` | 9,068 | 6.78% |
| `02` | 275 | 0.21% |
| `15` | 5 | <0.01% |
| `16` | 4 | <0.01% |

**`organization_type`** (IRS BMF "ORG" code — 1=corporation, 2=trust, 3=co-op, 4=partnership, 5=association, 6=other):

| Value | Count | % |
|---|---|---|
| `1` | 97,165 | 72.6% |
| `2` | 30,958 | 23.1% |
| `5` | 4,931 | 3.7% |
| `0` | 393 | 0.3% |
| `6` | 263 | 0.2% |
| `3` | 90 | <0.1% |
| `4` | 12 | <0.01% |

**`subsection_code`**: 99.95% (133,751 / 133,812) are `03` (IRC 501(c)(3)); the remaining 61 rows are scattered across `92`, `04`, `13`, `10`, `19`, `07`, `06`, `91`.

### Is there a distinguishable "family foundation" classification?

**No.** None of `foundation_type`, `organization_type`, or `subsection_code` — nor any other live column on this table — encodes "family foundation" as a distinct IRS classification. This is expected: "family foundation" is not an IRS BMF/990 field at all, it's informal industry terminology for a private foundation funded and controlled by a single family. The IRS codes above only distinguish private non-operating (`04`) vs. operating (`03`) foundations and legal form (corp/trust/association) — a family foundation and a corporate/institutional private foundation can carry the identical `04`/`1` combination.

The only available proxy is a **name-text match**. Searching the `name` column for the literal substring `"FAMILY FOUNDATION"` (case-insensitive) across all 133,812 rows:

- **19,674 rows (14.70%)** contain "FAMILY FOUNDATION" in the name.
- Of those, `foundation_type` breaks down as `04`: 19,173, `03`: 495, `02`: 6 — i.e., name-matched family foundations track the same 93%/7% split as the table overall, confirming `foundation_type` carries no independent signal here.
- A broader match on just the word "FAMILY" (no "FOUNDATION" requirement) hits 22,703 rows (17.0%) — wider net, more false positives (e.g., "Family Services", "Family Health Center").

This is a **heuristic, not an authoritative filter** — it will miss family foundations that don't use the word "family" in their legal name, and will not falsely include unrelated orgs beyond the "Family Services"-style edge cases already noted for the broader match.

---

## 3. Nonprofits filtered to revenue ≥ $750,000

```
revenue_amount >= 750000
```

**148,035 rows** would remain out of 1,978,526 total (**7.48%**). Note this filter implicitly also excludes all rows where `revenue_amount IS NULL` (the ~29% with no revenue data at all) — those are excluded by the comparison, not counted as $0.

---

## 4. Foundations remaining if "family foundations" are excluded

Using the name-based proxy from §2 (`name NOT ILIKE '%FAMILY FOUNDATION%'`):

**133,812 − 19,674 = 114,138 rows would remain** (85.30% of the table).

If the broader "FAMILY" word-match were used instead: 133,812 − 22,703 = **111,109 rows** would remain (83.03%).

There is no field-based (non-name-heuristic) way to produce this count, per §2.
