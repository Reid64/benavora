import { createHash } from "crypto";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import path from "path";

import * as cheerio from "cheerio";
import dotenv from "dotenv";
import yaml from "js-yaml";
// @ts-expect-error - pdf-parse has no bundled types
import pdfParse from "pdf-parse";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

import { chunkText, generateEmbeddingsBatch } from "../../src/lib/intelligence/embeddings";

dotenv.config({ path: ".env.local" });

const REQUIRED_ENV = [
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
];

const VALID_RIGHTS = ["host", "index", "link"];
const VALID_FORMATS = ["pdf", "html", "epub", "xlsx", "csv", "txt"];
const USER_AGENT = "BenavoraAssistIngest/1.0 (+https://www.benavora.com)";
const FETCH_TIMEOUT_MS = 30_000;
const PAUSE_MS = 300;
const CHUNK_MAX_TOKENS = 800;
const CHUNK_OVERLAP = 120;
const MIN_TEXT_LENGTH = 400;
const BUCKET = "knowledge-host";

interface SeedRow {
  name: string;
  publisher: string;
  tier: number;
  rights: string;
  license_note?: string;
  url: string;
  format: string;
  topics: string[];
}

interface SourceResult {
  name: string;
  rights: string;
  status: string;
  chunks: number;
  error?: string;
}

function parseArgs(argv: string[]) {
  let only: string | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") {
      only = argv[i + 1] ?? null;
      i++;
    } else if (argv[i] === "--dry-run") {
      dryRun = true;
    }
  }
  return { only, dryRun };
}

function checkEnv(): void {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    process.exit(2);
  }
}

function loadSeed(): SeedRow[] {
  const filePath = path.join("content", "knowledge", "CORPUS_SEED.yaml");
  const raw = readFileSync(filePath, "utf8");
  const parsed = yaml.load(raw) as { sources: SeedRow[] };
  return parsed.sources;
}

function validateSeed(rows: SeedRow[]): void {
  const invalid: string[] = [];
  for (const row of rows) {
    if (!row.name || !row.publisher || !row.url) {
      invalid.push(`${row.url ?? "(no url)"}: missing name/publisher/url`);
      continue;
    }
    if (!(row.tier >= 1 && row.tier <= 4)) {
      invalid.push(`${row.url}: tier ${row.tier} out of range 1-4`);
    }
    if (!VALID_RIGHTS.includes(row.rights)) {
      invalid.push(`${row.url}: rights "${row.rights}" not in ${VALID_RIGHTS.join(",")}`);
    }
    if (!VALID_FORMATS.includes(row.format)) {
      invalid.push(`${row.url}: format "${row.format}" not in ${VALID_FORMATS.join(",")}`);
    }
  }
  if (invalid.length > 0) {
    console.error("Invalid CORPUS_SEED.yaml rows:");
    for (const line of invalid) console.error(`  ${line}`);
    process.exit(2);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url: string): Promise<Response> {
  try {
    return await fetchWithTimeout(url);
  } catch {
    await sleep(5000);
    return fetchWithTimeout(url);
  }
}

function extractHtmlText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, aside").remove();
  const main = $("main").first();
  const article = $("article").first();
  const container = main.length > 0 ? main : article.length > 0 ? article : $("body");
  const text = container.text();
  return text.replace(/\s+/g, " ").trim();
}

async function extractText(format: string, buffer: Buffer): Promise<string> {
  if (format === "pdf") {
    const result = await pdfParse(buffer);
    return (result.text as string).replace(/\s+/g, " ").trim();
  }
  return extractHtmlText(buffer.toString("utf8"));
}

function extForFormat(format: string): string {
  if (format === "pdf") return "pdf";
  if (format === "html") return "html";
  return format;
}

async function main() {
  checkEnv();
  const { only, dryRun } = parseArgs(process.argv.slice(2));

  const rows = loadSeed();
  validateSeed(rows);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as never },
  });

  // upsert all rows into knowledge.sources regardless of --only filter
  const sourceIds = new Map<string, string>();
  for (const row of rows) {
    const res = await pool.query(
      `insert into knowledge.sources (name, publisher, tier, rights, license_note, url, format, topics)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (url) do update set
         name = excluded.name,
         publisher = excluded.publisher,
         tier = excluded.tier,
         rights = excluded.rights,
         license_note = excluded.license_note,
         format = excluded.format,
         topics = excluded.topics
       returning id`,
      [
        row.name,
        row.publisher,
        row.tier,
        row.rights,
        row.license_note ?? null,
        row.url,
        row.format,
        row.topics,
      ],
    );
    sourceIds.set(row.url, res.rows[0].id as string);
  }

  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    await supabase.storage.createBucket(BUCKET, { public: false });
  }

  const targetRows = rows.filter((row) => {
    if (row.rights === "link") return false;
    if (only && !row.name.toLowerCase().includes(only.toLowerCase())) return false;
    return true;
  });

  const results: SourceResult[] = [];
  let totalChunks = 0;
  let totalEmbeddingCalls = 0;
  let embeddedCount = 0;
  let failedCount = 0;

  for (const row of targetRows) {
    const sourceId = sourceIds.get(row.url)!;
    let result: SourceResult = { name: row.name, rights: row.rights, status: "pending", chunks: 0 };

    try {
      const response = await fetchWithRetry(row.url);
      if (!response.ok) {
        result = { ...result, status: "failed", error: `HTTP ${response.status}` };
        await pool.query(
          `insert into knowledge.documents (source_id, title, canonical_url, sha256, status, error)
           values ($1,$2,$3,$4,'failed',$5)
           on conflict (source_id, sha256) do nothing`,
          [sourceId, row.name, row.url, createHash("sha256").update(row.url).digest("hex"), `HTTP ${response.status}`],
        );
        results.push(result);
        console.log(`${row.name} | ${row.rights} | failed | 0 chunks (HTTP ${response.status})`);
        await sleep(PAUSE_MS);
        continue;
      }

      const finalUrl = response.url || row.url;
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const text = await extractText(row.format, buffer);

      if (text.length < MIN_TEXT_LENGTH) {
        result = { ...result, status: "failed", error: "too-short" };
        await pool.query(
          `insert into knowledge.documents (source_id, title, canonical_url, sha256, byte_size, status, error)
           values ($1,$2,$3,$4,$5,'failed','too-short')
           on conflict (source_id, sha256) do nothing`,
          [sourceId, row.name, finalUrl, createHash("sha256").update(text || row.url).digest("hex"), buffer.length],
        );
        results.push(result);
        console.log(`${row.name} | ${row.rights} | failed | 0 chunks (too-short)`);
        await sleep(PAUSE_MS);
        continue;
      }

      const sha256 = createHash("sha256").update(text).digest("hex");

      const existing = await pool.query(
        `select id, status from knowledge.documents where source_id = $1 and sha256 = $2`,
        [sourceId, sha256],
      );
      if (existing.rows[0]?.status === "embedded") {
        result = { ...result, status: "embedded (cached)", chunks: 0 };
        results.push(result);
        console.log(`${row.name} | ${row.rights} | embedded (cached) | 0 chunks`);
        await sleep(PAUSE_MS);
        continue;
      }

      let storagePath: string | null = null;
      if (row.rights === "host") {
        storagePath = `${sourceId}/${sha256}.${extForFormat(row.format)}`;
        await supabase.storage.from(BUCKET).upload(storagePath, buffer, { upsert: true });
      }

      const docRes = await pool.query(
        `insert into knowledge.documents (source_id, title, canonical_url, storage_path, sha256, byte_size, status)
         values ($1,$2,$3,$4,$5,$6,'fetched')
         on conflict (source_id, sha256) do update set status = 'fetched'
         returning id`,
        [sourceId, row.name, finalUrl, storagePath, sha256, buffer.length],
      );
      const documentId = docRes.rows[0].id as string;

      const chunks = chunkText(text, CHUNK_MAX_TOKENS, CHUNK_OVERLAP);

      if (dryRun) {
        result = { ...result, status: "chunked (dry-run)", chunks: chunks.length };
        results.push(result);
        totalChunks += chunks.length;
        console.log(`${row.name} | ${row.rights} | chunked (dry-run) | ${chunks.length} chunks`);
        await sleep(PAUSE_MS);
        continue;
      }

      const chunkIds: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const content = chunks[i]!;
        const chunkRes = await pool.query(
          `insert into knowledge.chunks (document_id, ordinal, content, token_count, metadata)
           values ($1,$2,$3,$4,$5)
           on conflict (document_id, ordinal) do update set content = excluded.content, token_count = excluded.token_count
           returning id`,
          [
            documentId,
            i,
            content,
            Math.ceil(content.length / 4),
            JSON.stringify({
              source_name: row.name,
              publisher: row.publisher,
              tier: row.tier,
              rights: row.rights,
              topics: row.topics,
            }),
          ],
        );
        chunkIds.push(chunkRes.rows[0].id as string);
      }

      await pool.query(`update knowledge.documents set status = 'chunked' where id = $1`, [documentId]);

      const embeddings = await generateEmbeddingsBatch(chunks);
      totalEmbeddingCalls += Math.ceil(chunks.length / 100);
      for (let i = 0; i < chunkIds.length; i++) {
        await pool.query(`update knowledge.chunks set embedding = $1 where id = $2`, [
          `[${embeddings[i]!.join(",")}]`,
          chunkIds[i],
        ]);
      }

      await pool.query(`update knowledge.documents set status = 'embedded' where id = $1`, [documentId]);

      result = { ...result, status: "embedded", chunks: chunks.length };
      results.push(result);
      totalChunks += chunks.length;
      embeddedCount++;
      console.log(`${row.name} | ${row.rights} | embedded | ${chunks.length} chunks`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { ...result, status: "failed", error: message };
      results.push(result);
      failedCount++;
      console.log(`${row.name} | ${row.rights} | failed | 0 chunks (${message})`);
    }

    await sleep(PAUSE_MS);
  }

  failedCount = results.filter((r) => r.status === "failed").length;

  mkdirSync(path.join("test-evidence", "knowledge"), { recursive: true });
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const evidencePath = path.join("test-evidence", "knowledge", `ingest-${stamp}.json`);
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        dryRun,
        only,
        sources: results,
        totals: {
          sources: targetRows.length,
          embedded: embeddedCount,
          failed: failedCount,
          chunks: totalChunks,
          embeddingCalls: totalEmbeddingCalls,
        },
      },
      null,
      2,
    ),
  );
  console.log(`\nEvidence written to ${evidencePath}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
