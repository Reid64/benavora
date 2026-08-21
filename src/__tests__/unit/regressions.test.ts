import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SubmissionValidator } from "@/lib/autoapply/submission-validator";
import {
  tryIrs990,
  type PooledEngine,
  type FoundationRow,
  type EinIndexEntry,
} from "@/lib/scraper/foundation-scraper";
import { IRS990Source } from "@/lib/enrichment/sources/irs990";
import type { StealthEngine } from "@/lib/scraper/stealth-engine";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

function readMigration(fileName: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf-8");
}

function readAllMigrations(): string {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf-8"))
    .join("\n");
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf-8");
}

/**
 * Minimal thenable/chainable Supabase query-builder stub. Every real call
 * pattern in checkOrgReadiness() is `.from(t).select(cols)[.eq()[.eq()]]`
 * eventually awaited — either directly (PostgREST builders are themselves
 * PromiseLike) or via `.single()`. This stub supports both without pulling
 * in a real Supabase client.
 */
function makeSupabaseMock(
  tableData: Record<string, { data: unknown }>,
  capturedSelects: Record<string, string>,
) {
  return {
    from(table: string) {
      return {
        select(cols: string) {
          capturedSelects[table] = cols;
          const result = tableData[table] ?? { data: null };
          const builder: PromiseLike<{ data: unknown }> & {
            eq: () => typeof builder;
            single: () => Promise<{ data: unknown }>;
          } = {
            eq: () => builder,
            single: async () => result,
            then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
          };
          return builder;
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("regression: funders.automation_level missing column (AutoApply org-readiness check)", () => {
  it("migration 052 adds funders.automation_level so the AutoApply funder lookup does not error", () => {
    const sql = readMigration("052_governance_layer.sql");
    expect(sql).toMatch(
      /ALTER TABLE funders ADD COLUMN IF NOT EXISTS automation_level text/,
    );
  });

  it("worker/queue-processor.ts selects automation_level from the real funders columns", () => {
    const source = readSource("worker/queue-processor.ts");
    const match = /\.from\(\s*['"]funders['"]\s*\)\s*\.select\(\s*['"]([^'"]+)['"]\s*\)/.exec(
      source,
    );
    expect(match, "expected a .from('funders').select('...') call in queue-processor.ts").not.toBeNull();
    const selectedColumns = (match?.[1] ?? "").split(",").map((c) => c.trim());
    expect(selectedColumns).toContain("automation_level");
  });
});

describe("regression: checkOrgReadiness() querying nonexistent organizations.contact_name column", () => {
  it("organizations table has no contact_name column — founder_name is the real primary-contact field", () => {
    const sql = readMigration("001_initial_schema.sql");
    const tableMatch = /CREATE TABLE organizations \(([\s\S]*?)\);/.exec(sql);
    expect(tableMatch, "expected to find CREATE TABLE organizations (...) in 001_initial_schema.sql").not.toBeNull();
    const columns = tableMatch![1];

    expect(columns).not.toMatch(/\bcontact_name\b/);
    expect(columns).toMatch(/\bfounder_name\b/);
  });

  it("checkOrgReadiness() selects founder_name, not contact_name, from organizations", async () => {
    const capturedSelects: Record<string, string> = {};
    const supabase = makeSupabaseMock(
      {
        organizations: {
          data: {
            mission_statement: "Serve rural Texas families",
            ein: "12-3456789",
            address_line1: "123 Main St",
            founder_name: "Reid Whitesides",
            contact_email: "reid@faithfoundation.org",
            phone: "555-000-0000",
          },
        },
        programs: { data: [{ id: "prog-1" }] },
        org_documents: { data: [{ document_type: "501c3_letter" }, { document_type: "form_990" }] },
        request_profiles: { data: [{ id: "rp-1" }] },
      },
      capturedSelects,
    );

    const validator = new SubmissionValidator();
    const report = await validator.checkOrgReadiness("org-1", supabase);

    expect(capturedSelects.organizations).toBeDefined();
    expect(capturedSelects.organizations).not.toContain("contact_name");
    expect(capturedSelects.organizations).toContain("founder_name");

    // With a fully-populated org row (using founder_name), "Primary contact
    // name" must NOT be reported missing. Before the fix, selecting the
    // nonexistent contact_name column made the whole query fail, so `org`
    // silently resolved to undefined and every KB field was falsely
    // reported missing regardless of real data.
    expect(report.missing_required).not.toContain("Primary contact name");
    expect(report.missing_required).not.toContain("Mission statement");
    expect(report.missing_required).not.toContain("EIN (Employer Identification Number)");
  });
});

describe("regression: IRS 990 XML fetch using dead S3 URL / wrong fetch method (fetchPage vs fetchRaw)", () => {
  const SAMPLE_990_XML = `
    <Return>
      <ReturnData>
        <IRS990>
          <BusinessNameLine1Txt>Test Foundation</BusinessNameLine1Txt>
          <WebsiteAddressTxt>https://example.org</WebsiteAddressTxt>
          <PhoneNum>5125551234</PhoneNum>
        </IRS990>
      </ReturnData>
    </Return>
  `;

  it("resolves a filing via fetchRaw() on the direct XML URL and never calls fetchPage()", async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error(
        "fetchPage() renders XML through Chromium's built-in XML viewer, corrupting the raw bytes parseXml() needs — tryIrs990 must use fetchRaw() instead",
      );
    });
    const fetchRaw = vi.fn(async (_url: string) => SAMPLE_990_XML);
    const fetchRawBuffer = vi.fn(async () => null);

    const mockEngine = { fetchPage, fetchRaw, fetchRawBuffer } as unknown as StealthEngine;
    const pooled: PooledEngine = { engine: mockEngine, lastRequestAt: 0 };

    const row: FoundationRow = {
      id: "f-1",
      ein: "12-3456789",
      name: "Test Foundation",
      city: null,
      state: null,
      website: null,
      email: null,
      phone: null,
    };

    const directUrl = "https://apps.irs.gov/pub/epostcard/990/xml/2026/some_filing_public.xml";
    const entry: EinIndexEntry = { directUrl };
    const einIndex = new Map<string, EinIndexEntry>([["123456789", entry]]);

    const result = await tryIrs990(
      row,
      einIndex,
      pooled,
      new IRS990Source(),
      new Map(),
    );

    expect(fetchRaw).toHaveBeenCalledWith(directUrl);
    expect(fetchPage).not.toHaveBeenCalled();
    // normalizeWebsiteCandidate() (added commit e76dac3, 2026-08-15, to
    // reject placeholder/bare-domain WebsiteAddressTxt values that were
    // crashing fetchPage()) validates via `new URL(...).toString()`, which
    // per the WHATWG URL spec normalizes a bare-domain URL by appending the
    // trailing "/" — a real, correct side effect of that fix, not a bug in
    // the fetchRaw()-vs-fetchPage() behavior this test actually guards.
    expect(result).toEqual({ website: "https://example.org/", phone: "5125551234" });
  });

  it("never constructs the dead s3.amazonaws.com/irs-form-990 fallback URL", () => {
    const source = readSource("src/lib/scraper/foundation-scraper.ts");
    // The dead S3 bucket is only allowed to appear inside the historical
    // explanatory comment on EinIndexEntry — never as a template literal or
    // string concatenation building a URL to actually fetch.
    const liveUrlConstruction = /[`'"]https?:\/\/s3\.amazonaws\.com\/irs-form-990/;
    expect(source).not.toMatch(liveUrlConstruction);
  });
});

describe("regression: scripts/enrich-foundations-990.ts EIN column fallback off-by-one (FEATURE_REGISTRY_v2.md row D2)", () => {
  // Captured live 2026-08-14 from both the real 2025 and 2026 IRS 990 e-file
  // index CSVs (https://apps.irs.gov/pub/epostcard/990/xml/<year>/index_<year>.csv) —
  // same 10-column header/order in both years. EIN is at index 2, OBJECT_ID at
  // index 8, XML_BATCH_ID at index 9. The 2026-07-16 fix (commit b07b7ea) added
  // positional fallbacks for when header-name lookup fails, but set them to
  // 1/7/8 — one column short across the board — so if header lookup ever
  // actually fails, the fallback silently reads FILING_TYPE/DLN/OBJECT_ID
  // instead of EIN/OBJECT_ID/XML_BATCH_ID, producing zero valid EINs for the
  // entire run (every row's cleaned "ein" comes back empty and gets skipped).
  const REAL_HEADER_LINE =
    "RETURN_ID,FILING_TYPE,EIN,TAX_PERIOD,SUB_DATE,TAXPAYER_NAME,RETURN_TYPE,DLN,OBJECT_ID,XML_BATCH_ID";
  const REAL_DATA_LINE =
    "24099240,EFILE,237257037,202506,2026,NATIONAL ASSOCIATION OF FEDERALLY IMPACTED SCHOOLS INC,990,93493013009086,202630139349300908,2026_TEOS_XML_01A";

  it("parses EIN/object_id/xml_batch_id correctly via normal header-name lookup", async () => {
    const { parseIndexHeaders, parseIndexRow } = await import(
      "../../../scripts/enrich-foundations-990"
    );
    const headers = parseIndexHeaders(REAL_HEADER_LINE);
    const row = parseIndexRow(headers, REAL_DATA_LINE);
    expect(row).not.toBeNull();
    expect(row?.ein).toBe("237257037");
    expect(row?.objectId).toBe("202630139349300908");
  });

  it("parses EIN/object_id/xml_batch_id correctly via the positional fallback (header lookup fails)", async () => {
    const { parseIndexRow } = await import("../../../scripts/enrich-foundations-990");
    // Simulate header-name lookup failing entirely (e.g. an unrecognized
    // header row) by passing headers that contain none of the real names —
    // this forces every column to resolve through EIN_FALLBACK_IDX /
    // OBJECT_ID_FALLBACK_IDX / XML_BATCH_ID_FALLBACK_IDX.
    const noMatchHeaders = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const row = parseIndexRow(noMatchHeaders, REAL_DATA_LINE);
    expect(row).not.toBeNull();
    expect(row?.ein).toBe("237257037");
    expect(row?.objectId).toBe("202630139349300908");
    // xml_batch_id has no header name of its own to look up in this script
    // (only used to build the fallback S3 URL) — confirm it resolves via the
    // real column (index 9, "2026_TEOS_XML_01A"), not xmlBatchId's own wrong
    // fallback value that a still-broken index would have produced.
    expect(row?.xmlUrl).toBe(
      "https://s3.amazonaws.com/irs-form-990/202630139349300908_public.xml",
    );
  });
});

describe("regression: AutonomousAgentResult.matched/.found nonexistent field references", () => {
  it("AutonomousAgentResult's real shape uses itemsFound/itemsProcessed/itemsQueued, not matched/found", () => {
    // Constructing a value against the actual exported interface means this
    // test fails to type-check (and thus fails `pnpm tsc --noEmit`, part of
    // the test gate) if the interface's field names ever drift again.
    const sample: import("@/lib/agents/autonomous-base").AutonomousAgentResult = {
      success: true,
      itemsFound: 3,
      itemsProcessed: 2,
      itemsQueued: 1,
      decisions: ["did a thing"],
      nextActions: [],
      errors: [],
    };

    expect(Object.keys(sample)).not.toContain("matched");
    expect(Object.keys(sample)).not.toContain("found");
    expect(sample.itemsFound).toBe(3);
    expect(sample.itemsProcessed).toBe(2);
  });

  it("worker/autonomous-orchestrator.ts never re-references result.matched or result.found", () => {
    const source = readSource("worker/autonomous-orchestrator.ts");
    expect(source).not.toMatch(/result\.matched\b/);
    expect(source).not.toMatch(/result\.found\b/);
    // Sanity check the file still actually exercises the real field names,
    // so this assertion isn't vacuously true because the file was gutted.
    expect(source).toMatch(/result\.itemsFound\b/);
    expect(source).toMatch(/result\.itemsProcessed\b/);
  });
});

describe("regression: storage bucket created without storage.objects RLS policy", () => {
  it("every bucket inserted into storage.buckets in a migration has a matching storage.objects policy", () => {
    const allMigrations = readAllMigrations();

    const bucketInsertRe = /INSERT INTO storage\.buckets[\s\S]*?VALUES\s*\(\s*'([^']+)'/g;
    const bucketIds = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = bucketInsertRe.exec(allMigrations)) !== null) {
      bucketIds.add(match[1]!);
    }

    // Guard the guard: this repo is known (per migration 044) to define at
    // least one bucket via migration SQL. If this ever hits zero, the regex
    // above has drifted from the real INSERT syntax and is silently
    // vacuous — fail loudly instead of reporting false success.
    expect(bucketIds.size).toBeGreaterThan(0);

    const policyBlockRe = /CREATE POLICY[\s\S]*?;/g;
    const policyBlocks = allMigrations.match(policyBlockRe) ?? [];
    const objectsPolicyBlocks = policyBlocks.filter((b) => b.includes("storage.objects"));

    const bucketsMissingPolicy: string[] = [];
    for (const bucketId of bucketIds) {
      const hasPolicy = objectsPolicyBlocks.some((block) =>
        block.includes(`bucket_id = '${bucketId}'`) || block.includes(`bucket_id='${bucketId}'`),
      );
      if (!hasPolicy) bucketsMissingPolicy.push(bucketId);
    }

    expect(
      bucketsMissingPolicy,
      `bucket(s) with no storage.objects policy anywhere in supabase/migrations/: ${bucketsMissingPolicy.join(", ")}`,
    ).toEqual([]);
  });

  it("migration 044's nofa-pdfs bucket has insert, update, and read policies", () => {
    const sql = readMigration("044_nofa_pdfs_bucket.sql");
    expect(sql).toMatch(/INSERT INTO storage\.buckets[\s\S]*?'nofa-pdfs'/);
    expect(sql).toMatch(/CREATE POLICY[\s\S]*?ON storage\.objects[\s\S]*?FOR INSERT[\s\S]*?bucket_id = 'nofa-pdfs'/);
    expect(sql).toMatch(/CREATE POLICY[\s\S]*?ON storage\.objects[\s\S]*?FOR UPDATE[\s\S]*?bucket_id = 'nofa-pdfs'/);
    expect(sql).toMatch(/CREATE POLICY[\s\S]*?ON storage\.objects[\s\S]*?FOR SELECT[\s\S]*?bucket_id = 'nofa-pdfs'/);
  });
});
