CREATE SCHEMA IF NOT EXISTS knowledge;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS knowledge.sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  publisher text NOT NULL,
  tier smallint NOT NULL CHECK (tier BETWEEN 1 AND 4),
  rights text NOT NULL CHECK (rights IN ('host','index','link')),
  license_note text,
  url text NOT NULL UNIQUE,
  format text NOT NULL CHECK (format IN ('pdf','html','epub','xlsx','csv','txt')),
  topics text[] NOT NULL DEFAULT '{}',
  public_listing boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS knowledge.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES knowledge.sources(id) ON DELETE CASCADE,
  title text NOT NULL,
  canonical_url text NOT NULL,
  storage_path text,
  sha256 text NOT NULL,
  byte_size integer,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'fetched' CHECK (status IN ('fetched','chunked','embedded','failed')),
  error text,
  UNIQUE (source_id, sha256)
);
CREATE TABLE IF NOT EXISTS knowledge.chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  content text NOT NULL,
  token_count integer NOT NULL,
  embedding vector(1536),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  metadata jsonb NOT NULL DEFAULT '{}',
  UNIQUE (document_id, ordinal)
);
CREATE TABLE IF NOT EXISTS knowledge.queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surface text NOT NULL CHECK (surface IN ('public','app')),
  org_id uuid,
  client_key text,
  question text NOT NULL,
  answer text,
  chunk_ids uuid[] NOT NULL DEFAULT '{}',
  model text,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding ON knowledge.chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tsv ON knowledge.chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS idx_knowledge_queries_client ON knowledge.queries (client_key, created_at DESC);
ALTER TABLE knowledge.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.queries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA knowledge FROM anon, authenticated;
GRANT USAGE ON SCHEMA knowledge TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA knowledge TO service_role;
CREATE OR REPLACE FUNCTION knowledge.search(query_embedding vector(1536), query_text text, match_count integer DEFAULT 8)
RETURNS TABLE (chunk_id uuid, document_id uuid, title text, canonical_url text, publisher text, rights text, content text, score double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = knowledge, public, extensions AS $$
WITH vec AS (
  SELECT c.id, row_number() OVER (ORDER BY c.embedding <=> query_embedding) AS r
  FROM knowledge.chunks c WHERE c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding LIMIT 20
), txt AS (
  SELECT c.id, row_number() OVER (ORDER BY ts_rank_cd(c.tsv, plainto_tsquery('english', query_text)) DESC) AS r
  FROM knowledge.chunks c WHERE c.tsv @@ plainto_tsquery('english', query_text)
  ORDER BY ts_rank_cd(c.tsv, plainto_tsquery('english', query_text)) DESC LIMIT 20
), fused AS (
  SELECT id, SUM(1.0 / (60 + r)) AS score FROM (SELECT id, r FROM vec UNION ALL SELECT id, r FROM txt) u GROUP BY id
)
SELECT c.id, c.document_id, d.title, d.canonical_url, s.publisher, s.rights, c.content, f.score
FROM fused f JOIN knowledge.chunks c ON c.id = f.id JOIN knowledge.documents d ON d.id = c.document_id JOIN knowledge.sources s ON s.id = d.source_id
WHERE s.rights IN ('host','index')
ORDER BY f.score DESC LIMIT match_count;
$$;
REVOKE ALL ON FUNCTION knowledge.search(vector, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION knowledge.search(vector, text, integer) TO service_role;
CREATE OR REPLACE FUNCTION knowledge.rate_count(p_client_key text, p_window interval DEFAULT interval '24 hours')
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = knowledge AS $$
  SELECT count(*)::integer FROM knowledge.queries WHERE client_key = p_client_key AND created_at > now() - p_window;
$$;
REVOKE ALL ON FUNCTION knowledge.rate_count(text, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION knowledge.rate_count(text, interval) TO service_role;
