// ============================================================================
// PT-06-005 (part A) — duplicate-rate and null-rate data-quality audit on the
// large tables, read-only against production.
//
// Two checks per table, each recording the exact SQL used and the resulting
// counts/percentages, per task instruction 3 ("capture actual counts and
// percentages with the queries"):
//
//   1. duplicate_rate   — for each natural-key candidate on a table (EIN for
//                         foundation_directory/nonprofits; legal_name and
//                         legal_name+hq_address for donor_discovery_directory,
//                         which has no EIN column), a live GROUP BY ... HAVING
//                         COUNT(*) > 1 measuring how many distinct key values
//                         repeat and how many "extra" rows that produces.
//                         Where the natural key already has a live UNIQUE
//                         index (confirmed via pg_indexes before writing any
//                         query, not assumed), the check still runs — a
//                         verified 0% rate is itself a real, reportable
//                         result, not skipped.
//
//   2. null_rate        — for each column identified as one the application
//                         reads as if populated (grounded against a real
//                         call site in src/, cited by file:line in the
//                         column's own `app_requirement` field — not a guess
//                         off the column name), a live COUNT(*) FILTER (WHERE
//                         col IS NULL) against the table's total row count.
//
// The 133,812 foundation_directory rows are the PT-01-confirmed anchor;
// donor_discovery_directory and nonprofits are measured against their own
// live COUNT(*) at run time (not carried from a stale prior session's
// number), recorded in the output.
//
// Severity assignment is grounded in how the specific column is actually
// consumed (cited inline), not a blanket "any null is bad":
//   - P1: the app's own code will silently mis-behave (soft-fail a lookup
//         that should have succeeded, or treat "no signal" as ground truth)
//         for a large fraction of rows because of the null/duplicate rate.
//   - P2: the column feeds a real, cited consumer, but the consumer already
//         guards for null (optional field, filtered stat, etc.) so the
//         effect is reduced coverage/quality, not a wrong answer.
//   - INFO: a natural-key duplicate check came back clean (0%) because the
//           key is already DB-enforced unique — recorded as a verified
//           non-finding, not silently omitted.
//
// Safety: same read-only pattern as pt06-001/002/004 — the session is put
// into default_transaction_read_only=on immediately after connecting, before
// any other query runs, so every statement below is rejected by Postgres
// itself (not just application discipline) if it is ever accidentally a
// write.
//
// Usage: node scripts/audit/pt06-005-data-quality.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ENV_FILE = ".env.local";
const OUT_DIR = path.join("test-evidence", "pt-06");
const OUT_FILE = path.join(OUT_DIR, "data-quality.json");

const PER_QUERY_TIMEOUT_MS = 60000; // nonprofits is ~1.98M rows -- generous timeout

function loadEnv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

function redact(connectionString) {
  return connectionString.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/, "$1***$2");
}

async function q(client, sql, label) {
  const start = Date.now();
  try {
    const res = await client.query(sql);
    return { ok: true, rows: res.rows, durationMs: Date.now() - start };
  } catch (err) {
    return { ok: false, rows: [], durationMs: Date.now() - start, error: `${err.code || "unknown"}: ${err.message}` };
  } finally {
    void label;
  }
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 100; // 2 decimal places
}

// ---------------------------------------------------------------------------
// Table definitions: natural-key duplicate checks + app-grounded null checks.
// ---------------------------------------------------------------------------

const TABLES = [
  {
    table: "foundation_directory",
    anchor_note:
      "PT-01-confirmed anchor population: 133,812 rows (re-measured live below, not assumed stale).",
    duplicate_keys: [
      {
        label: "ein (exact match)",
        expr: "ein",
        note:
          "Confirmed via pg_indexes before writing this query: foundation_directory_ein_unique is a " +
          "live UNIQUE index on this column, so a non-zero result here would indicate the index itself " +
          "is not actually being enforced (e.g. added after dirty data with NOT VALID, or bypassed).",
      },
      {
        label: "lower(name) + state (loose real-world identity)",
        expr: "lower(name) || '|' || coalesce(state, '')",
        note:
          "No DB constraint covers this combination. Two rows with the same name+state but different " +
          "EIN either are the same real foundation on two different EINs (application/name-change/data " +
          "error) or are two genuinely distinct foundations sharing a name -- this measures the raw " +
          "collision rate; distinguishing the two requires manual review, not automatable here.",
      },
    ],
    null_checks: [
      {
        column: "website",
        app_requirement:
          "src/lib/donor-discovery/foundation-linkage.ts:113,117 -- normalizeDomain(row.website) is one " +
          "of two signals findsFoundationLinkage() uses to link a donor_discovery_directory prospect to " +
          "a foundation_directory row; a null website removes this signal entirely for that row (falls " +
          "back to the RPC name-similarity match only).",
        severity_if_high: "P2",
      },
      {
        column: "giving_total",
        second_column: "asset_amount",
        combined_label: "giving_total AND asset_amount both null",
        app_requirement:
          "src/lib/donor-discovery/scoring.ts:75 -- \"Linked foundation's giving capacity " +
          "(foundation_directory.giving_total, falling back to asset_amount)\" -- when both are null the " +
          "scoring engine has zero real capacity signal for that foundation.",
        severity_if_high: "P1",
      },
      {
        column: "email",
        app_requirement:
          "Outreach/contact surfaces (foundations directory page, funder detail views) read this as the " +
          "primary contact channel; contact_emails (array) is the enrichment-pipeline-populated fallback, " +
          "checked separately below for completeness.",
        severity_if_high: "P2",
      },
      {
        column: "contact_emails",
        cast: "cardinality(contact_emails) = 0 OR contact_emails IS NULL",
        is_array: true,
        app_requirement:
          "src/lib/scraper/foundation-scraper.ts enrichment writes this array as its primary contact-email " +
          "output; an empty/null array means the scraper has not yet enriched (or found nothing for) that " +
          "row.",
        severity_if_high: "P2",
      },
    ],
  },
  {
    table: "nonprofits",
    anchor_note: "Full IRS BMF import population; row count re-measured live below.",
    duplicate_keys: [
      {
        label: "ein (exact match)",
        expr: "ein",
        note:
          "Confirmed via pg_indexes before writing this query: nonprofits_ein_key is a live UNIQUE index " +
          "on this column. Directly relevant to a real app assumption: " +
          "src/lib/agents/ea-04-foundation-detector.ts:114-116 queries " +
          ".from(\"nonprofits\").select(...).eq(\"ein\", candidate).maybeSingle() -- maybeSingle() throws " +
          "a PostgREST error if more than one row matches, which that call site's own try/catch treats as " +
          "\"no match\" (a silent false-negative), so a non-zero result here would mean real matches are " +
          "being silently dropped today.",
      },
      {
        label: "lower(name) + state (loose real-world identity)",
        expr: "lower(name) || '|' || coalesce(state, '')",
        note: "Same loose-identity collision measurement as foundation_directory, at nonprofits' much larger scale.",
      },
    ],
    null_checks: [
      {
        column: "website",
        app_requirement:
          "src/app/(dashboard)/nonprofits/page.tsx:123 -- the page's own \"with website\" stat card is " +
          "literally .not(\"website\", \"is\", null), i.e. the app already treats this as a segment, not a " +
          "universal requirement; still measured here since a very high null rate materially shrinks that " +
          "segment.",
        severity_if_high: "P2",
      },
      {
        column: "officer_email",
        app_requirement:
          "src/lib/scraper/nonprofit-scraper.ts:67,177-178 -- officer_email is the scraper's primary " +
          "enrichment output for a contactable individual at the nonprofit; used by " +
          "src/lib/scraper-v2/templates/nonprofit-contact-template.ts as the field it exists to populate.",
        severity_if_high: "P2",
      },
      {
        column: "contact_emails",
        app_requirement:
          "src/lib/scraper/nonprofit-scraper.ts:19,236 -- \"contact_emails (text, comma-joined dedup set)\" " +
          "is the scraper's other primary enrichment output alongside officer_email.",
        severity_if_high: "P2",
      },
    ],
  },
  {
    table: "donor_discovery_directory",
    anchor_note: "Google-Places-sourced corporate prospect directory; row count re-measured live below.",
    duplicate_keys: [
      {
        label: "lower(legal_name) (exact match, all rows)",
        expr: "lower(legal_name)",
        note:
          "No DB constraint covers legal_name alone. The table's real dedup index, " +
          "donor_discovery_directory_dedup_idx, is UNIQUE on " +
          "(lower(legal_name), donor_discovery_extract_domain(website)) -- a two-part key, not legal_name " +
          "alone, so this measures what that index does NOT cover by itself.",
      },
      {
        label: "lower(legal_name) restricted to website IS NULL rows",
        expr: "lower(legal_name)",
        where_extra: "website IS NULL",
        note:
          "Directly tests whether the real dedup index actually prevents duplicate legal_name rows when " +
          "website is null. donor_discovery_extract_domain(NULL) evaluates to NULL (confirmed by reading " +
          "the live function definition via pg_get_functiondef before writing this check), and Postgres " +
          "unique indexes never treat two NULLs as equal, so if a large share of rows have a null " +
          "website, the dedup index is structurally unable to catch duplicates among them -- this measures " +
          "exactly that blind spot, not a hypothetical one.",
      },
      {
        label: "lower(legal_name) + hq_address (stricter compound key)",
        expr: "lower(legal_name) || '|' || coalesce(hq_address, '')",
        note:
          "A duplicate here (identical name AND address) is a much stronger real-world-duplicate signal " +
          "than name alone, independent of the website-null blind spot above.",
      },
    ],
    null_checks: [
      {
        column: "website",
        app_requirement:
          "src/lib/donor-discovery/foundation-linkage.ts:113,117 -- normalizeDomain(row.website) is the " +
          "primary (higher-confidence) linkage signal to foundation_directory; a null website forces every " +
          "linkage attempt for that row onto the RPC name-similarity fallback only. This column is also " +
          "the second half of the table's own dedup unique index (see duplicate_keys above), so a high " +
          "null rate here has a compounding effect: it both weakens linkage AND disables dedup for the " +
          "affected rows.",
        severity_if_high: "P1",
      },
      {
        column: "phone",
        app_requirement:
          "Displayed as the contact channel on prospect-facing surfaces; no code path was found that " +
          "hard-requires it (optional field throughout), so a high null rate here is a coverage gap, not " +
          "a silent-failure risk.",
        severity_if_high: "P2",
      },
    ],
  },
];

async function main() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`HALT: ${ENV_FILE} not found -- cannot establish a connection.`);
    process.exit(1);
  }
  const env = loadEnv(ENV_FILE);
  if (!env.DATABASE_URL) {
    console.error(`HALT: DATABASE_URL not present in ${ENV_FILE} -- cannot establish a connection.`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: PER_QUERY_TIMEOUT_MS,
  });

  console.log("PT-06-005 (part A) data-quality audit: duplicate rates + null rates on large tables");
  console.log(`Connection string (redacted): ${redact(env.DATABASE_URL)}`);

  await client.connect();
  await client.query("SET default_transaction_read_only = on");
  const roCheck = await client.query("SHOW default_transaction_read_only");
  if (roCheck.rows[0].default_transaction_read_only !== "on") {
    console.error("HALT: could not confirm read-only mode -- refusing to proceed.");
    await client.end();
    process.exit(1);
  }
  console.log("Session confirmed read-only. Proceeding.\n");

  const result = {
    generated_at: new Date().toISOString(),
    database: redact(env.DATABASE_URL),
    method:
      "Live, read-only queries against production Postgres (session forced to " +
      "default_transaction_read_only=on before any query ran, per the same enforcement proof as " +
      "pt06-001/002/004). Every duplicate-rate and null-rate result below records the exact SQL that " +
      "produced it and the actual count/percentage returned, per task instruction 3. Natural-key and " +
      "'app treats as required' column selection was grounded against real src/ call sites (cited " +
      "per-check), not guessed from column names alone.",
    tables: {},
    findings: [],
  };

  for (const tableDef of TABLES) {
    console.log(`\n=== ${tableDef.table} ===`);
    const totalQuery = `SELECT count(*)::bigint AS total_rows FROM "${tableDef.table}";`;
    const totalRes = await q(client, totalQuery, `total-count:${tableDef.table}`);
    const totalRows = totalRes.ok ? Number(totalRes.rows[0].total_rows) : null;
    console.log(`  total rows: ${totalRes.ok ? totalRows : `QUERY FAILED: ${totalRes.error}`}`);

    const tableResult = {
      total_row_count_query: totalQuery.trim(),
      total_row_count: totalRes.ok ? totalRows : null,
      total_row_count_error: totalRes.ok ? undefined : totalRes.error,
      anchor_note: tableDef.anchor_note,
      duplicate_rate_checks: [],
      null_rate_checks: [],
    };

    // --- duplicate-rate checks ---
    for (const dk of tableDef.duplicate_keys) {
      const whereClause = dk.where_extra ? `WHERE ${dk.where_extra}` : "";
      const dupSql = `
        SELECT
          count(*)::int AS duplicate_key_groups,
          coalesce(sum(cnt - 1), 0)::int AS extra_rows,
          coalesce(sum(cnt), 0)::int AS rows_in_duplicate_groups
        FROM (
          SELECT ${dk.expr} AS key_val, count(*) AS cnt
          FROM "${tableDef.table}"
          ${whereClause}
          GROUP BY ${dk.expr}
          HAVING count(*) > 1
        ) dupes;
      `;
      const dupRes = await q(client, dupSql, `dup:${tableDef.table}:${dk.label}`);
      let entry = { label: dk.label, query: dupSql.trim(), note: dk.note, duration_ms: dupRes.durationMs };
      if (!dupRes.ok) {
        entry.error = dupRes.error;
        console.log(`  [dup] ${dk.label}: QUERY FAILED: ${dupRes.error}`);
      } else {
        const row = dupRes.rows[0];
        const groups = row.duplicate_key_groups || 0;
        const extra = row.extra_rows || 0;
        const denomForRate = dk.where_extra
          ? (await q(client, `SELECT count(*)::bigint AS n FROM "${tableDef.table}" WHERE ${dk.where_extra};`, "denom")).rows[0]?.n
          : totalRows;
        const rate = pct(extra, Number(denomForRate) || totalRows);
        entry.duplicate_key_groups = groups;
        entry.extra_rows = extra;
        entry.population_measured = Number(denomForRate) || totalRows;
        entry.extra_row_rate_pct = rate;
        console.log(
          `  [dup] ${dk.label}: ${groups} duplicate group(s), ${extra} extra row(s) of ${entry.population_measured} (${rate}%)`,
        );
        if (groups === 0) {
          result.findings.push({
            table: tableDef.table,
            check: "duplicate_rate",
            key: dk.label,
            severity: "INFO",
            description: `${tableDef.table}: ${dk.label} shows 0 duplicate groups (verified clean, ${entry.population_measured} rows checked). ${dk.note}`,
            query: dupSql.trim(),
          });
        } else {
          const severity = rate >= 5 ? "P1" : rate > 0 ? "P2" : "INFO";
          result.findings.push({
            table: tableDef.table,
            check: "duplicate_rate",
            key: dk.label,
            severity,
            duplicate_key_groups: groups,
            extra_rows: extra,
            extra_row_rate_pct: rate,
            description: `${tableDef.table}: ${groups} distinct "${dk.label}" value(s) repeat across ${entry.population_measured} row(s) measured, producing ${extra} extra row(s) (${rate}% of the population measured). ${dk.note}`,
            query: dupSql.trim(),
          });
        }
      }
      tableResult.duplicate_rate_checks.push(entry);
    }

    // --- null-rate checks ---
    for (const nc of tableDef.null_checks) {
      let nullSql;
      if (nc.combined_label) {
        nullSql = `
          SELECT count(*)::int AS null_count
          FROM "${tableDef.table}"
          WHERE "${nc.column}" IS NULL AND "${nc.second_column}" IS NULL;
        `;
      } else if (nc.cast) {
        nullSql = `
          SELECT count(*)::int AS null_count
          FROM "${tableDef.table}"
          WHERE ${nc.cast};
        `;
      } else {
        nullSql = `
          SELECT count(*)::int AS null_count
          FROM "${tableDef.table}"
          WHERE "${nc.column}" IS NULL;
        `;
      }
      const label = nc.combined_label || nc.column;
      const nullRes = await q(client, nullSql, `null:${tableDef.table}:${label}`);
      let entry = {
        column: nc.combined_label ? `${nc.column} AND ${nc.second_column}` : nc.column,
        query: nullSql.trim(),
        app_requirement: nc.app_requirement,
        duration_ms: nullRes.durationMs,
      };
      if (!nullRes.ok) {
        entry.error = nullRes.error;
        console.log(`  [null] ${label}: QUERY FAILED: ${nullRes.error}`);
      } else {
        const nullCount = nullRes.rows[0].null_count || 0;
        const rate = pct(nullCount, totalRows);
        entry.null_count = nullCount;
        entry.total_rows = totalRows;
        entry.null_rate_pct = rate;
        console.log(`  [null] ${label}: ${nullCount} of ${totalRows} (${rate}%)`);
        // Findings threshold: >= 40% null on a column the app reads as populated is worth
        // recording as a real finding at the severity the column's own consumer analysis says;
        // below that, still recorded in the checks array (full transparency) but not escalated
        // to a finding, since a modest gap is normal for an ongoing enrichment pipeline.
        if (rate >= 40) {
          result.findings.push({
            table: tableDef.table,
            check: "null_rate",
            column: entry.column,
            severity: rate >= 90 ? "P1" : nc.severity_if_high || "P2",
            null_count: nullCount,
            total_rows: totalRows,
            null_rate_pct: rate,
            description: `${tableDef.table}.${entry.column} is NULL on ${nullCount} of ${totalRows} row(s) (${rate}%). ${nc.app_requirement}`,
            query: nullSql.trim(),
          });
        }
      }
      tableResult.null_rate_checks.push(entry);
    }

    result.tables[tableDef.table] = tableResult;
  }

  await client.end();
  console.log("\nConnection closed cleanly.");

  result.summary = {
    tables_checked: Object.keys(result.tables).length,
    total_findings: result.findings.length,
    p1_findings: result.findings.filter((f) => f.severity === "P1").length,
    p2_findings: result.findings.filter((f) => f.severity === "P2").length,
    info_findings: result.findings.filter((f) => f.severity === "INFO").length,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  console.log(`\nWrote ${OUT_FILE}`);
  console.log(JSON.stringify(result.summary, null, 2));
}

main().catch(async (err) => {
  console.error(`HALT: unexpected error: ${err.stack || err.message}`);
  process.exit(1);
});
