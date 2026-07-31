-- Full-text search over published recipes.
-- Searchable by anyone (logged in or not) via the search_recipes() function below,
-- which relies on the existing "Users can view published recipes" RLS policy.

-- Weighted search vector: a title match outranks an ingredient match.
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(author, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(ingredients, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(notes, '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_recipes_search_vector
  ON recipes USING GIN (search_vector);

-- Covers the /browse listing, which is always published-only, newest first
CREATE INDEX IF NOT EXISTS idx_recipes_published_created
  ON recipes (created_at DESC)
  WHERE status = 'published';

-- Search published recipes, ranked by relevance.
--
-- SECURITY INVOKER keeps RLS in force for the calling role, so anon only ever
-- sees published rows; the explicit status filter is defence in depth.
-- Returns total_count on every row so the caller can paginate without a second query.
CREATE OR REPLACE FUNCTION public.search_recipes(
  search_query  text,
  result_limit  integer DEFAULT 12,
  result_offset integer DEFAULT 0
)
RETURNS TABLE (
  id            uuid,
  title         text,
  author        text,
  prep_time     text,
  cook_time     text,
  servings      text,
  difficulty    text,
  thumbnail_url text,
  created_at    timestamptz,
  rank          real,
  total_count   bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH input AS (
    SELECT
      btrim(search_query) AS raw,
      websearch_to_tsquery('english', btrim(search_query)) AS tsq
  ),
  pattern AS (
    SELECT
      raw,
      tsq,
      -- Escape LIKE metacharacters so a literal % or _ in the query stays literal
      '%' || replace(replace(replace(raw, '\', '\\'), '%', '\%'), '_', '\_') || '%' AS like_pat
    FROM input
  ),
  matches AS (
    SELECT
      r.id, r.title, r.author, r.prep_time, r.cook_time, r.servings,
      r.difficulty, r.thumbnail_url, r.created_at,
      ts_rank(r.search_vector, p.tsq) AS rank
    FROM recipes r
    CROSS JOIN pattern p
    WHERE r.status = 'published'
      AND p.raw <> ''
      -- Full-text match, or a partial title match so "chick" still finds "Chicken"
      AND (r.search_vector @@ p.tsq OR r.title ILIKE p.like_pat)
  )
  SELECT m.*, count(*) OVER () AS total_count
  FROM matches m
  ORDER BY m.rank DESC, m.created_at DESC
  LIMIT least(greatest(result_limit, 1), 50)
  OFFSET greatest(result_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.search_recipes(text, integer, integer)
  TO anon, authenticated;

-- Row visibility is still controlled by RLS; this only allows the read to be attempted.
GRANT SELECT ON public.recipes TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Optional: speeds up the partial-title ILIKE above once the table grows.
-- Everything above works without it, so it is safe to skip this block if the
-- extension is unavailable.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_recipes_title_trgm
  ON recipes USING GIN (title gin_trgm_ops);
