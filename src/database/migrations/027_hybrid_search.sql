-- Full-text search companion to vector similarity search
-- Enables hybrid search: semantic (pgvector) + keyword (tsvector)

CREATE OR REPLACE FUNCTION search_memory_fulltext(
  query_text text,
  match_count int DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  content text,
  category text,
  source text,
  similarity float,
  created_at timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    content,
    category,
    source,
    ts_rank(to_tsvector('english', content), plainto_tsquery('english', query_text))::float AS similarity,
    created_at
  FROM facts
  WHERE to_tsvector('english', content) @@ plainto_tsquery('english', query_text)
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

-- Add tsvector index for performance
CREATE INDEX IF NOT EXISTS facts_content_fts ON facts USING gin(to_tsvector('english', content));
