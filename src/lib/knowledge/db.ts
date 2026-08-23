import { Pool } from "pg";

import { createAdminClient } from "@/lib/supabase/admin";

export interface Source {
  id: string;
  name: string;
  publisher: string;
  tier: number;
  rights: "host" | "index" | "link";
  license_note: string | null;
  url: string;
  format: "pdf" | "html" | "epub" | "xlsx" | "csv" | "txt";
  topics: string[];
  public_listing: boolean;
  added_at: string;
}

export interface Document {
  id: string;
  source_id: string;
  title: string;
  canonical_url: string;
  storage_path: string | null;
  sha256: string;
  byte_size: number | null;
  fetched_at: string;
  status: "fetched" | "chunked" | "embedded" | "failed";
  error: string | null;
}

export interface Chunk {
  id: string;
  document_id: string;
  ordinal: number;
  content: string;
  token_count: number;
  embedding: number[] | null;
  metadata: Record<string, unknown>;
}

export interface SearchHit {
  chunk_id: string;
  document_id: string;
  title: string;
  canonical_url: string;
  publisher: string;
  rights: string;
  content: string;
  score: number;
}

export function knowledgeDb() {
  return createAdminClient().schema("knowledge");
}

let pool: Pool | null = null;
function knowledgePool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

// The knowledge schema is deliberately not in PostgREST's exposed-schemas list
// (service-role-only, SECURITY DEFINER RPCs) - query it over the direct
// Postgres connection rather than through supabase-js's .schema() helper,
// which 404s (PGRST106) for any unexposed schema regardless of key.
//
// idx_knowledge_chunks_embedding is an ivfflat index built with lists=100,
// oversized for the current corpus size (~8 rows/list) - the default
// probes=1 only scans one list and misses most relevant chunks, so bump
// probes per-session before calling search() to get real recall.
const IVFFLAT_PROBES = 20;

export async function searchKnowledge(
  embedding: number[],
  text: string,
  k = 8,
): Promise<SearchHit[]> {
  const client = await knowledgePool().connect();
  try {
    await client.query(`SET ivfflat.probes = ${IVFFLAT_PROBES}`);
    const { rows } = await client.query(
      `select * from knowledge.search($1::vector, $2::text, $3::int)`,
      [`[${embedding.join(",")}]`, text, k],
    );
    return rows as SearchHit[];
  } finally {
    client.release();
  }
}

export async function rateCount(clientKey: string): Promise<number> {
  const { rows } = await knowledgePool().query(
    `select knowledge.rate_count($1::text) as count`,
    [clientKey],
  );
  return Number(rows[0]?.count ?? 0);
}

export interface QueryLogEntry {
  surface: "public" | "app";
  clientKey: string | null;
  question: string;
  answer: string | null;
  chunkIds: string[];
  model: string | null;
  latencyMs: number;
}

export async function insertQuery(entry: QueryLogEntry): Promise<void> {
  await knowledgePool().query(
    `insert into knowledge.queries (surface, client_key, question, answer, chunk_ids, model, latency_ms)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      entry.surface,
      entry.clientKey,
      entry.question,
      entry.answer,
      entry.chunkIds,
      entry.model,
      entry.latencyMs,
    ],
  );
}
