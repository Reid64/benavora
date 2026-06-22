// IRS 990 XML enrichment source — server-side only.
// Reads pre-downloaded IRS 990 XML files or an IRS index CSV to locate them.
// Intended for batch enrichment on Reid's local machine (AGENTS.md Agent 21).

import fs from "fs";
import path from "path";
import readline from "readline";
import type { EnrichmentResult } from "@/lib/enrichment/types";

// --- XML extraction helpers -------------------------------------------------

/** Extract first text value matching <TagName>…</TagName> (case-sensitive). */
function xmlText(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "s");
  const m = re.exec(xml);
  return m?.[1]?.trim() || undefined;
}

/** Extract all text values for repeated elements. */
function xmlAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "gs");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = m[1]?.trim();
    if (v) results.push(v);
  }
  return results;
}

/** Extract a numeric field, returning undefined when absent or non-numeric. */
function xmlNum(xml: string, tag: string): number | undefined {
  const raw = xmlText(xml, tag);
  if (!raw) return undefined;
  const n = Number(raw.replace(/,/g, ""));
  return isFinite(n) ? n : undefined;
}

/** Extract inner XML of the first matching element (for nested structures). */
function xmlInner(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "s");
  return re.exec(xml)?.[1];
}

/** Extract all inner XML blocks for a repeated element. */
function xmlAllInner(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gs");
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) blocks.push(m[1]);
  }
  return blocks;
}

// --- IRS 990 field paths ----------------------------------------------------
// IRS 990 XML uses both the legacy schema (Return/ReturnData/…) and the
// modernized schema (IRS990/…). We probe both tag sets.

function extractBusinessName(xml: string): string | undefined {
  return (
    xmlText(xml, "BusinessNameLine1Txt") ??
    xmlText(xml, "BusinessNameLine1") ??
    xmlText(xml, "Name")
  );
}

function extractWebsite(xml: string): string | undefined {
  return xmlText(xml, "WebsiteAddressTxt") ?? xmlText(xml, "WebsiteAddress");
}

function extractRevenue(xml: string): number | undefined {
  return (
    xmlNum(xml, "CYTotalRevenueAmt") ??
    xmlNum(xml, "TotalRevenue") ??
    xmlNum(xml, "GrossReceiptsAmt")
  );
}

function extractAssets(xml: string): number | undefined {
  return (
    xmlNum(xml, "TotalAssetsEOYAmt") ??
    xmlNum(xml, "TotalAssets") ??
    xmlNum(xml, "TotalAssetsEndOfYear")
  );
}

function extractGiving(xml: string): number | undefined {
  // Total grants / charitable distributions
  return (
    xmlNum(xml, "TotalGrantOrContriPdDurYrAmt") ??
    xmlNum(xml, "TotalGiving") ??
    xmlNum(xml, "GrantsAndSimilarAmountsPaidAmt")
  );
}

interface RawOfficer {
  name: string;
  title: string;
}

function extractOfficers(xml: string): RawOfficer[] {
  const blocks = xmlAllInner(xml, "OfficerDirectorTrusteeKeyEmployee");
  const results: RawOfficer[] = [];
  for (const block of blocks) {
    const name =
      xmlText(block, "PersonNm") ??
      xmlText(block, "BusinessNameLine1Txt") ??
      xmlText(block, "Name");
    const title =
      xmlText(block, "TitleTxt") ?? xmlText(block, "Title") ?? "Officer";
    if (name) results.push({ name, title });
  }
  return results;
}

function extractAddress(xml: string): EnrichmentResult["address"] | undefined {
  const street =
    xmlText(xml, "AddressLine1Txt") ?? xmlText(xml, "AddressLine1");
  const city = xmlText(xml, "CityNm") ?? xmlText(xml, "City");
  const state = xmlText(xml, "StateAbbreviationCd") ?? xmlText(xml, "State");
  const zip = xmlText(xml, "ZIPCd") ?? xmlText(xml, "ZipCode");
  if (city && state) {
    return { street: street ?? "", city, state, zip: zip ?? "" };
  }
  return undefined;
}

// --- Public class -----------------------------------------------------------

export class IRS990Source {
  /**
   * Parse a locally-downloaded IRS 990 XML file for a given EIN.
   * Scans `xmlDir` for files matching `*{ein}*.xml` (case-insensitive).
   * Returns null if no matching file is found.
   */
  async enrichFromLocalXml(
    ein: string,
    xmlDir: string,
  ): Promise<EnrichmentResult | null> {
    const cleanEin = ein.replace(/\D/g, "");
    const dir = path.resolve(xmlDir);

    if (!fs.existsSync(dir)) return null;

    const files = fs.readdirSync(dir);
    const match = files.find((f) =>
      f.toLowerCase().includes(cleanEin) && f.toLowerCase().endsWith(".xml"),
    );
    if (!match) return null;

    const xmlPath = path.join(dir, match);
    const xml = fs.readFileSync(xmlPath, "utf-8");

    const name = extractBusinessName(xml);
    if (!name) return null;

    return {
      source: "irs_990_xml",
      website: extractWebsite(xml),
      emails: xmlAll(xml, "EmailAddressTxt"),
      phones: xmlAll(xml, "PhoneNum"),
      officers: extractOfficers(xml),
      revenue: extractRevenue(xml),
      assets: extractAssets(xml),
      giving: extractGiving(xml),
      address: extractAddress(xml),
      confidence: 0.95,
      raw: { file: match, ein: cleanEin },
    };
  }

  /**
   * Look up an EIN in an IRS 990 index CSV to retrieve the XML download URL.
   * The IRS index CSV columns are:
   *   EIN, DLN, ObjectId, FormType, URL, OrganizationName, …
   * Returns the URL string, or null if the EIN is not in the index.
   */
  async enrichFromIndex(
    ein: string,
    indexFile: string,
  ): Promise<{ xmlUrl: string } | null> {
    const cleanEin = ein.replace(/\D/g, "");
    const filePath = path.resolve(indexFile);

    if (!fs.existsSync(filePath)) return null;

    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      let headers: string[] | null = null;
      let found = false;

      rl.on("line", (line) => {
        if (found) return;

        const cols = line.split(",");

        if (!headers) {
          headers = cols.map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
          return;
        }

        const einIdx = headers.indexOf("ein");
        const urlIdx = headers.indexOf("url");
        if (einIdx < 0 || urlIdx < 0) return;

        const rowEin = (cols[einIdx] ?? "").replace(/[^0-9]/g, "");
        if (rowEin !== cleanEin) return;

        const xmlUrl = (cols[urlIdx] ?? "").trim().replace(/^"|"$/g, "");
        if (!xmlUrl) return;

        found = true;
        rl.close();
        stream.destroy();
        resolve({ xmlUrl });
      });

      rl.on("close", () => {
        if (!found) resolve(null);
      });

      rl.on("error", reject);
      stream.on("error", reject);
    });
  }
}
