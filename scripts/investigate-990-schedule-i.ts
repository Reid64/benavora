// @ts-nocheck
// ============================================================================
// ONE-OFF INVESTIGATION SCRIPT — row #66 (FEATURE_REGISTRY_v2.md) positive-case
// verification. Not part of the production enrichment pipeline; not wired
// into any pnpm script. Delete after use if desired.
//
// Goal: find a real foundation_directory record with a populated IRS 990-PF
// Schedule I (grants awarded) and confirm IRS990Source.extractFilingMeta()
// (the real, unmodified production extraction code in
// src/lib/enrichment/sources/irs990.ts) correctly extracts its per-recipient
// grant line items.
//
// The prior session (AGENT_VERIFICATION_LOG.md queue-37 entry #5, 2026-08-08)
// sampled whatever ZIP entries happened to decompress successfully out of a
// batch archive and got 36 small family/scholarship foundations, all with
// zero grants — plausible for that population, but never reached a positive
// case. This script instead:
//   1. Selects foundation_directory candidates ranked by real asset_amount /
//      giving_total (larger foundations are far more likely to have a
//      populated Schedule I than small family foundations).
//   2. Matches those candidate EINs against the real, current-year IRS 990
//      e-file index (same index scripts/enrich-foundations-990.ts and
//      src/lib/scraper/foundation-scraper.ts already use).
//   3. Downloads only the specific batch ZIP(s) actually needed, and reads
//      only the target entries out of them using a hand-rolled ZIP64-aware
//      central-directory parser (see readZipEntry() below) — the pinned
//      `unzipper` package was independently confirmed (queue-37 entry #5) to
//      fail on 66-77% of entries in these >65,535-entry ZIP64 archives, which
//      is almost certainly why the prior session could never target a
//      specific large, known-likely foundation and only got whatever smaller
//      entries happened to survive unzipper's central-directory misreads.
//   4. Runs the real IRS990Source.extractFilingMeta()/parseXml() (imported
//      unmodified from production) against each fetched filing.
//
// Usage: npx tsx scripts/investigate-990-schedule-i.ts
// ============================================================================

import fs from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import ws from "ws";
import { IRS990Source } from "../src/lib/enrichment/sources/irs990";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws as unknown as typeof WebSocket },
});

const YEAR = process.env.IRS_990_YEAR ? Number(process.env.IRS_990_YEAR) : new Date().getFullYear();
const INDEX_URL = `https://apps.irs.gov/pub/epostcard/990/xml/${YEAR}/index_${YEAR}.csv`;
const CACHE_DIR = path.resolve("./enrichment-output/990-investigation-cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });

const irs990 = new IRS990Source();

// ----------------------------------------------------------------------------
// 1. Candidate selection — largest real foundation_directory rows by asset
//    size / giving total, EIN required.
// ----------------------------------------------------------------------------
interface Candidate {
  ein: string;
  name: string;
  asset_amount: number | null;
  giving_total: number | null;
}

async function loadCandidates(limit: number): Promise<Candidate[]> {
  const seen = new Map<string, Candidate>();

  for (const orderCol of ["asset_amount", "giving_total"] as const) {
    const { data, error } = await admin
      .from("foundation_directory")
      .select("ein, name, asset_amount, giving_total")
      .not("ein", "is", null)
      .not(orderCol, "is", null)
      .order(orderCol, { ascending: false })
      .limit(limit);
    if (error) {
      console.error(`  query failed (order by ${orderCol}): ${error.message}`);
      continue;
    }
    for (const row of data ?? []) {
      const ein = String(row.ein ?? "").replace(/\D/g, "");
      if (ein && !seen.has(ein)) {
        seen.set(ein, {
          ein,
          name: row.name as string,
          asset_amount: row.asset_amount as number | null,
          giving_total: row.giving_total as number | null,
        });
      }
    }
  }

  return [...seen.values()];
}

// ----------------------------------------------------------------------------
// 2. Match candidates against the real IRS 990 e-file index CSV.
// ----------------------------------------------------------------------------
const EIN_FALLBACK_IDX = 2;
const OBJECT_ID_FALLBACK_IDX = 8;
const XML_BATCH_ID_FALLBACK_IDX = 9;

interface IndexMatch {
  ein: string;
  objectId: string;
  xmlBatchId: string;
  orgName: string;
}

async function matchIndex(candidateEins: Set<string>): Promise<IndexMatch[]> {
  console.log(`Downloading IRS 990 index: ${INDEX_URL}`);
  const res = await fetch(INDEX_URL);
  if (!res.ok || !res.body) {
    console.error(`  FAILED: HTTP ${res.status}`);
    process.exit(1);
  }
  const text = await res.text();
  console.log(`  downloaded ${(text.length / 1e6).toFixed(1)}MB`);

  const lines = text.split(/\r?\n/);
  let headers: string[] | null = null;
  const matches: IndexMatch[] = [];
  let scanned = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!headers) {
      headers = line.split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
      continue;
    }
    scanned++;
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));

    let einIdx = headers.indexOf("ein");
    if (einIdx < 0) einIdx = EIN_FALLBACK_IDX;
    const ein = (cols[einIdx] ?? "").replace(/\D/g, "");
    if (!ein || !candidateEins.has(ein)) continue;

    let objectIdIdx = headers.indexOf("object_id");
    if (objectIdIdx < 0) objectIdIdx = OBJECT_ID_FALLBACK_IDX;
    let xmlBatchIdIdx = headers.indexOf("xml_batch_id");
    if (xmlBatchIdIdx < 0) xmlBatchIdIdx = XML_BATCH_ID_FALLBACK_IDX;
    const nameIdx = headers.indexOf("taxpayer_name");

    const objectId = (cols[objectIdIdx] ?? "").trim();
    const xmlBatchId = (cols[xmlBatchIdIdx] ?? "").trim();
    if (!objectId || !xmlBatchId) continue;

    matches.push({ ein, objectId, xmlBatchId, orgName: nameIdx >= 0 ? cols[nameIdx] ?? "" : "" });
  }

  console.log(`  scanned ${scanned} index rows, matched ${matches.length} candidate EIN(s) to a filing`);
  return matches;
}

// ----------------------------------------------------------------------------
// 3. ZIP64-aware targeted entry reader — now file-backed, not buffer-backed.
//
// The pinned `unzipper` package mis-locates entries in this IRS index's real
// batch archives (84,172+ entries, requiring ZIP64 central-directory
// extensions) — confirmed live 2026-08-08, 66-77% zlib failures. This reader
// avoids that class of bug entirely by manually walking the ZIP64 End Of
// Central Directory record and following each entry's *local* file header
// (not trusting central-directory compressed-size fields blindly) before
// inflating with Node's built-in zlib — no third-party zip library involved.
//
// 2026-08-15 fix: batch archives run 500MB+, and both `fetch(...).arrayBuffer()`
// (single-buffer download) and holding the whole file as one in-memory Buffer
// failed outright in this sandbox. The ZIP format itself only requires random
// access, not sequential reads — the central directory lives at the *end* of
// the file, and each entry's data is reachable directly via its local-header
// offset. So: stream the download straight to a temp file on disk (never
// buffering more than one response chunk at a time), then use positional
// (pread-style) reads against the file handle to pull only the specific byte
// ranges actually needed — the EOCD tail, the central directory (a few MB even
// at 84,172 entries), and each targeted entry's local header + compressed data.
// The parsing algorithm itself (signatures, field offsets, ZIP64 extra-field
// handling) is unchanged from the prior buffer-based version, just re-pointed
// at small on-demand reads instead of slicing one giant in-memory buffer.
// ----------------------------------------------------------------------------

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

interface CentralEntry {
  name: string;
  localHeaderOffset: bigint;
  compressedSize: bigint;
  method: number;
}

/** Positional read — never touches any part of the file outside [position, position+length). */
async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

/** Locate the classic EOCD record signature by scanning the last ~66KB of the file. */
async function findEOCD(fh: FileHandle, fileSize: number): Promise<{ eocdOffset: number; tail: Buffer; tailStart: number }> {
  const tailStart = Math.max(0, fileSize - 66_000);
  const tail = await readAt(fh, tailStart, fileSize - tailStart);
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) return { eocdOffset: tailStart + i, tail, tailStart };
  }
  throw new Error("EOCD signature not found — not a valid ZIP");
}

async function parseCentralDirectory(fh: FileHandle, fileSize: number): Promise<CentralEntry[]> {
  const { eocdOffset, tail, tailStart } = await findEOCD(fh, fileSize);
  const eocdLocal = eocdOffset - tailStart;

  let cdOffset = tail.readUInt32LE(eocdLocal + 16);
  let cdEntryCount = tail.readUInt16LE(eocdLocal + 10);
  let cdEndOffset = eocdOffset;

  // ZIP64: standard fields pinned at 0xFFFFFFFF/0xFFFF when the real archive
  // exceeds the 32-bit/16-bit limits (true for these 84,172-entry batches).
  if (cdOffset === 0xffffffff || cdEntryCount === 0xffff) {
    const locatorOffset = eocdOffset - 20;
    const locatorBuf = await readAt(fh, locatorOffset, 20);
    if (locatorOffset < 0 || locatorBuf.readUInt32LE(0) !== EOCD64_LOCATOR_SIG) {
      throw new Error("ZIP64 EOCD locator not found where expected");
    }
    const eocd64Offset = Number(locatorBuf.readBigUInt64LE(8));
    const eocd64Buf = await readAt(fh, eocd64Offset, 56);
    if (eocd64Buf.readUInt32LE(0) !== EOCD64_SIG) {
      throw new Error("ZIP64 EOCD record signature mismatch");
    }
    cdEntryCount = Number(eocd64Buf.readBigUInt64LE(32));
    cdOffset = Number(eocd64Buf.readBigUInt64LE(48));
    cdEndOffset = eocd64Offset; // central directory ends right before the ZIP64 EOCD record
  }

  // Central directory itself is small even at 84,172 entries (~80 bytes/entry,
  // a few MB total) — safe to read as one bounded chunk, unlike the full ZIP.
  const cdBuf = await readAt(fh, cdOffset, cdEndOffset - cdOffset);

  const entries: CentralEntry[] = [];
  let p = 0;
  for (let i = 0; i < cdEntryCount; i++) {
    if (cdBuf.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new Error(`central directory entry #${i} signature mismatch at offset ${cdOffset + p}`);
    }
    const method = cdBuf.readUInt16LE(p + 10);
    let compressedSize = BigInt(cdBuf.readUInt32LE(p + 20));
    const nameLen = cdBuf.readUInt16LE(p + 28);
    const extraLen = cdBuf.readUInt16LE(p + 30);
    const commentLen = cdBuf.readUInt16LE(p + 32);
    let localHeaderOffset = BigInt(cdBuf.readUInt32LE(p + 42));
    const name = cdBuf.toString("utf-8", p + 46, p + 46 + nameLen);

    // Parse ZIP64 extra field (tag 0x0001) if present. Per APPNOTE.TXT, its
    // subfields appear in a fixed order — uncompressed size, compressed size,
    // local header offset, disk start — but each is present ONLY if the
    // corresponding standard 32-bit field above was pinned to 0xFFFFFFFF.
    const uncompressedSize32 = cdBuf.readUInt32LE(p + 24);
    const compressedSize32 = cdBuf.readUInt32LE(p + 20);
    const localOffset32 = cdBuf.readUInt32LE(p + 42);
    if (extraLen > 0 && (uncompressedSize32 === 0xffffffff || compressedSize32 === 0xffffffff || localOffset32 === 0xffffffff)) {
      const extraStart = p + 46 + nameLen;
      let ep = extraStart;
      const extraEnd = extraStart + extraLen;
      while (ep + 4 <= extraEnd) {
        const tag = cdBuf.readUInt16LE(ep);
        const size = cdBuf.readUInt16LE(ep + 2);
        if (tag === 0x0001) {
          let cursor = ep + 4;
          if (uncompressedSize32 === 0xffffffff) cursor += 8; // uncompressed size — not needed, skip
          if (compressedSize32 === 0xffffffff) {
            compressedSize = cdBuf.readBigUInt64LE(cursor);
            cursor += 8;
          }
          if (localOffset32 === 0xffffffff) {
            localHeaderOffset = cdBuf.readBigUInt64LE(cursor);
            cursor += 8;
          }
        }
        ep += 4 + size;
      }
    }

    entries.push({ name, localHeaderOffset, compressedSize, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Follow a central-directory entry's local file header and inflate its data — reads only this entry's bytes. */
async function extractEntry(fh: FileHandle, entry: CentralEntry): Promise<Buffer> {
  const lp = Number(entry.localHeaderOffset);
  const header = await readAt(fh, lp, 30);
  if (header.readUInt32LE(0) !== LOCAL_SIG) {
    throw new Error(`local file header signature mismatch at offset ${lp} for ${entry.name}`);
  }
  const nameLen = header.readUInt16LE(26);
  const extraLen = header.readUInt16LE(28);
  const dataStart = lp + 30 + nameLen + extraLen;
  const compressedSize = Number(entry.compressedSize);
  const raw = await readAt(fh, dataStart, compressedSize);

  if (entry.method === 0) return raw; // stored, no compression
  if (entry.method === 8) return zlib.inflateRawSync(raw); // deflate
  throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);
}

/**
 * Stream the batch ZIP straight to disk (never buffering the whole response
 * in memory — the prior `fetch(...).arrayBuffer()` approach failed outright
 * on 500MB+ transfers in this sandbox). Returns the local file path; callers
 * read it back via positional `FileHandle.read()` calls, not a full load.
 */
async function downloadBatchZip(xmlBatchId: string): Promise<string> {
  const cacheFile = path.join(CACHE_DIR, `${xmlBatchId}.zip`);
  if (fs.existsSync(cacheFile)) {
    const { size } = fs.statSync(cacheFile);
    console.log(`  using cached ${xmlBatchId}.zip (${(size / 1e6).toFixed(1)}MB on disk)`);
    return cacheFile;
  }
  const zipUrl = `https://apps.irs.gov/pub/epostcard/990/xml/${YEAR}/${xmlBatchId}.zip`;
  console.log(`  streaming batch ZIP to disk: ${zipUrl}`);
  const res = await fetch(zipUrl);
  if (!res.ok || !res.body) throw new Error(`batch ZIP download failed: HTTP ${res.status}`);

  const tmpFile = `${cacheFile}.part`;
  let bytesStreamed = 0;
  let lastLoggedMB = 0;
  const source = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream);
  source.on("data", (chunk: Buffer) => {
    bytesStreamed += chunk.length;
    const mb = Math.floor(bytesStreamed / 1e6);
    if (mb - lastLoggedMB >= 50) {
      lastLoggedMB = mb;
      console.log(`    ...${mb}MB streamed`);
    }
  });

  try {
    await pipeline(source, fs.createWriteStream(tmpFile));
  } catch (err) {
    fs.rmSync(tmpFile, { force: true });
    throw new Error(`batch ZIP streaming failed after ${(bytesStreamed / 1e6).toFixed(1)}MB: ${(err as Error).message}`);
  }
  fs.renameSync(tmpFile, cacheFile);
  console.log(`    ${(bytesStreamed / 1e6).toFixed(1)}MB streamed to ${cacheFile}`);
  return cacheFile;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  console.log("=== row #66 positive-case investigation: targeted large-foundation Schedule I search ===\n");

  console.log("Step 1: selecting foundation_directory candidates by real asset_amount/giving_total...");
  const candidates = await loadCandidates(150);
  console.log(`  ${candidates.length} unique large-foundation candidates loaded`);
  console.log(
    `  top 10 by asset_amount: ${candidates
      .slice()
      .sort((a, b) => (b.asset_amount ?? 0) - (a.asset_amount ?? 0))
      .slice(0, 10)
      .map((c) => `${c.name} ($${((c.asset_amount ?? 0) / 1e6).toFixed(1)}M assets)`)
      .join("; ")}\n`,
  );

  const candidateEins = new Set(candidates.map((c) => c.ein));
  const candidateByEin = new Map(candidates.map((c) => [c.ein, c]));

  console.log("Step 2: matching candidates against the real IRS 990 e-file index...");
  const matches = await matchIndex(candidateEins);
  if (matches.length === 0) {
    console.log("\nNo large candidate EINs matched this year's e-file index. Nothing further to test.");
    return;
  }
  // Rank matches by the underlying candidate's asset size, largest first.
  matches.sort((a, b) => (candidateByEin.get(b.ein)?.asset_amount ?? 0) - (candidateByEin.get(a.ein)?.asset_amount ?? 0));
  const targets = matches.slice(0, 10);
  console.log(`  testing top ${targets.length} matched candidates (by asset size):`);
  for (const t of targets) {
    const c = candidateByEin.get(t.ein)!;
    console.log(`    EIN ${t.ein} — ${c.name} — assets $${((c.asset_amount ?? 0) / 1e6).toFixed(1)}M, giving $${((c.giving_total ?? 0) / 1e6).toFixed(1)}M`);
  }
  console.log("");

  console.log("Step 3+4: downloading needed batch ZIP(s), extracting target filings, running real extractFilingMeta()...\n");

  const batchGroups = new Map<string, IndexMatch[]>();
  for (const t of targets) {
    if (!batchGroups.has(t.xmlBatchId)) batchGroups.set(t.xmlBatchId, []);
    batchGroups.get(t.xmlBatchId)!.push(t);
  }

  const results: Array<{
    ein: string;
    name: string;
    fiscalYear?: number;
    grantCount?: number;
    grantRangeMin?: number;
    grantRangeMax?: number;
    lineItemCount: number;
    sampleLineItems: unknown[];
    error?: string;
  }> = [];

  for (const [xmlBatchId, group] of batchGroups) {
    let zipPath: string;
    try {
      zipPath = await downloadBatchZip(xmlBatchId);
    } catch (err) {
      for (const t of group) {
        results.push({ ein: t.ein, name: candidateByEin.get(t.ein)!.name, lineItemCount: 0, sampleLineItems: [], error: `batch download failed: ${(err as Error).message}` });
      }
      continue;
    }

    let fh: FileHandle | null = null;
    try {
      fh = await open(zipPath, "r");
      const { size: fileSize } = await fh.stat();
      console.log(`  opened ${xmlBatchId}.zip for positional reads (${(fileSize / 1e6).toFixed(1)}MB on disk)`);

      let centralEntries: CentralEntry[];
      try {
        centralEntries = await parseCentralDirectory(fh, fileSize);
        console.log(`  parsed central directory: ${centralEntries.length} entries in ${xmlBatchId}.zip`);
      } catch (err) {
        console.error(`  FAILED to parse central directory for ${xmlBatchId}.zip: ${(err as Error).message}`);
        for (const t of group) {
          results.push({ ein: t.ein, name: candidateByEin.get(t.ein)!.name, lineItemCount: 0, sampleLineItems: [], error: `central directory parse failed: ${(err as Error).message}` });
        }
        continue;
      }
      const byName = new Map(centralEntries.map((e) => [e.name, e]));

      for (const t of group) {
        const c = candidateByEin.get(t.ein)!;
        const entryName = `${t.objectId}_public.xml`;
        const entry = byName.get(entryName);
        if (!entry) {
          console.log(`  EIN ${t.ein} (${c.name}): entry ${entryName} not found in ${xmlBatchId}.zip central directory`);
          results.push({ ein: t.ein, name: c.name, lineItemCount: 0, sampleLineItems: [], error: "entry not found in batch ZIP central directory" });
          continue;
        }
        try {
          const xmlBuf = await extractEntry(fh, entry);
          const xml = xmlBuf.toString("utf-8");
          const parsed = irs990.parseXml(t.ein, xml, `${xmlBatchId}.zip#${entryName}`);
          const meta = irs990.extractFilingMeta(xml);
          console.log(
            `  EIN ${t.ein} (${c.name}): parsed OK — name on filing: "${parsed?.name ?? "(none)"}", fiscalYear=${meta.fiscalYear}, grantCount=${meta.grantCount ?? 0}, lineItems=${meta.grantLineItems?.length ?? 0}`,
          );
          results.push({
            ein: t.ein,
            name: c.name,
            fiscalYear: meta.fiscalYear,
            grantCount: meta.grantCount,
            grantRangeMin: meta.grantRangeMin,
            grantRangeMax: meta.grantRangeMax,
            lineItemCount: meta.grantLineItems?.length ?? 0,
            sampleLineItems: (meta.grantLineItems ?? []).slice(0, 5),
          });

          // Save the raw XML for any positive hit so it can be cross-checked by hand.
          if ((meta.grantLineItems?.length ?? 0) > 0) {
            const outFile = path.join(CACHE_DIR, `${t.ein}_${t.objectId}.xml`);
            fs.writeFileSync(outFile, xml);
            console.log(`    >>> POSITIVE HIT — raw XML saved to ${outFile}`);
          }
        } catch (err) {
          console.error(`  EIN ${t.ein} (${c.name}): extraction FAILED — ${(err as Error).message}`);
          results.push({ ein: t.ein, name: c.name, lineItemCount: 0, sampleLineItems: [], error: (err as Error).message });
        }
      }
    } finally {
      await fh?.close();
    }
  }

  console.log("\n=== SUMMARY ===");
  const summaryFile = path.join(CACHE_DIR, "results-summary.json");
  fs.writeFileSync(summaryFile, JSON.stringify(results, null, 2));
  console.log(`Full results written to ${summaryFile}\n`);

  const positives = results.filter((r) => r.lineItemCount > 0);
  const zeroGrant = results.filter((r) => !r.error && r.lineItemCount === 0);
  const errored = results.filter((r) => r.error);

  console.log(`Tested: ${results.length}`);
  console.log(`Positive Schedule I hits (lineItems > 0): ${positives.length}`);
  console.log(`Parsed cleanly with zero grants: ${zeroGrant.length}`);
  console.log(`Errors (fetch/parse/entry-not-found): ${errored.length}`);

  if (positives.length > 0) {
    console.log("\nPositive hits:");
    for (const p of positives) {
      console.log(`  EIN ${p.ein} (${p.name}): ${p.lineItemCount} line items, grantCount=${p.grantCount}, range $${p.grantRangeMin}-$${p.grantRangeMax}`);
      for (const item of p.sampleLineItems as Array<{ recipient: string; amount: number | null; purpose: string | null }>) {
        console.log(`      - ${item.recipient}: $${item.amount ?? "?"} (${item.purpose ?? "no purpose listed"})`);
      }
    }
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
