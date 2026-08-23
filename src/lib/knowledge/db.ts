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

// The knowledge schema is deliberately not in PostgREST's exposed-schemas
// list (public, graphql_public only), so .schema('knowledge').rpc(...)
// 406s (PGRST106) regardless of key - confirmed live with the service_role
// key. Instead call thin public-schema SECURITY DEFINER wrappers
// (migration 147) that call into knowledge.search()/rate_count()/queries
// insert on the caller's behalf, reached over the admin client's normal
// (no .schema()) REST path - HTTPS, so IPv4-compatible from Vercel, unlike
// the direct pg connection to the IPv6-only db host this replaces.
export async function searchKnowledge(
  embedding: number[],
  text: string,
  k = 8,
): Promise<SearchHit[]> {
  const { data, error } = await createAdminClient().rpc("knowledge_search", {
    query_embedding: `[${embedding.join(",")}]`,
    query_text: text,
    match_count: k,
  });
  if (error) throw error;
  return (data ?? []) as SearchHit[];
}

export async function rateCount(clientKey: string): Promise<number> {
  const { data, error } = await createAdminClient().rpc("knowledge_rate_count", {
    p_client_key: clientKey,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export interface QueryLogEntry {
  surface: "public" | "app";
  /** Caller's organization - set for the "app" surface, null for "public". */
  orgId?: string | null;
  clientKey: string | null;
  question: string;
  answer: string | null;
  chunkIds: string[];
  model: string | null;
  latencyMs: number;
}

export async function insertQuery(entry: QueryLogEntry): Promise<void> {
  const { error } = await createAdminClient().rpc("knowledge_insert_query", {
    p_surface: entry.surface,
    p_org_id: entry.orgId ?? null,
    p_client_key: entry.clientKey,
    p_question: entry.question,
    p_answer: entry.answer,
    p_chunk_ids: entry.chunkIds,
    p_model: entry.model,
    p_latency_ms: entry.latencyMs,
  });
  if (error) throw error;
}
