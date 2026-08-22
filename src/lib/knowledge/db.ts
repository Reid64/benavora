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

export async function searchKnowledge(
  embedding: number[],
  text: string,
  k = 8,
): Promise<SearchHit[]> {
  const { data, error } = await knowledgeDb().rpc("search", {
    query_embedding: embedding,
    query_text: text,
    match_count: k,
  });

  if (error) {
    throw error;
  }

  return (data ?? []) as SearchHit[];
}

export async function rateCount(clientKey: string): Promise<number> {
  const { data, error } = await knowledgeDb().rpc("rate_count", {
    p_client_key: clientKey,
  });

  if (error) {
    throw error;
  }

  return (data ?? 0) as number;
}
