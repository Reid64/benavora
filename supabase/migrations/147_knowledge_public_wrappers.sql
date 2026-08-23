-- public-schema wrappers around the knowledge schema.
-- PostgREST's db-schemas allow-list only exposes public, graphql_public
-- (confirmed live 2026-08-23: .schema('knowledge').rpc(...) returns
-- PGRST106 "Invalid schema: knowledge" even with the service_role key).
-- These wrappers let src/lib/knowledge/db.ts reach knowledge.* over the
-- Supabase JS client / PostgREST HTTPS path (IPv4-compatible from Vercel)
-- instead of a direct pg connection to the IPv6-only db host.
CREATE OR REPLACE FUNCTION public.knowledge_search(query_embedding vector(1536), query_text text, match_count integer DEFAULT 8)
RETURNS TABLE (chunk_id uuid, document_id uuid, title text, canonical_url text, publisher text, rights text, content text, score double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = knowledge, public, extensions AS $$
  SET LOCAL ivfflat.probes = 20;
  SELECT * FROM knowledge.search(query_embedding, query_text, match_count);
$$;
REVOKE ALL ON FUNCTION public.knowledge_search(vector, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_search(vector, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.knowledge_rate_count(p_client_key text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = knowledge, public AS $$
  SELECT knowledge.rate_count(p_client_key);
$$;
REVOKE ALL ON FUNCTION public.knowledge_rate_count(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_rate_count(text) TO service_role;

CREATE OR REPLACE FUNCTION public.knowledge_insert_query(
  p_surface text,
  p_org_id uuid,
  p_client_key text,
  p_question text,
  p_answer text,
  p_chunk_ids uuid[],
  p_model text,
  p_latency_ms integer
)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = knowledge AS $$
  INSERT INTO knowledge.queries (surface, org_id, client_key, question, answer, chunk_ids, model, latency_ms)
  VALUES (p_surface, p_org_id, p_client_key, p_question, p_answer, p_chunk_ids, p_model, p_latency_ms);
$$;
REVOKE ALL ON FUNCTION public.knowledge_insert_query(text, uuid, text, text, text, uuid[], text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_insert_query(text, uuid, text, text, text, uuid[], text, integer) TO service_role;
