-- REW-19: Cookbook sharing
--
-- Gives a cookbook owner one explicit, reversible Private <-> Public choice.
-- Public means two things at once: the cookbook is readable by anyone at
-- GET /c/:id, and it surfaces in the site search bar. Both are driven by the
-- single `is_public` boolean below -- there is no share token and no
-- per-user grant table.
--
-- This migration is purely ADDITIVE, exactly as 009_create_cookbooks_table.sql
-- anticipated ("sharing can be added later as an ADDITIONAL SELECT policy ...
-- without reworking this migration"). The four owner-only policies from 009 and
-- the three from 010 are left untouched.
--
-- PRIVACY NOTE -- draft recipes must never leak through a shared cookbook.
-- Cookbook membership is deliberately independent of a recipe's publish status
-- (REW-62), so a Public cookbook can contain the owner's drafts. Nothing in this
-- migration changes the `recipes` table, its policies, or its grants: the
-- published/owner SELECT policy from 001 is precisely the mechanism relied on.
-- The application reads /c/:id through the anon key, where auth.uid() is null,
-- so only published recipes are ever returned -- structurally, not by a filter.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.search_cookbooks(text, integer, integer);
--   DROP POLICY IF EXISTS "Anyone can view recipes in public cookbooks" ON public.cookbook_recipes;
--   DROP POLICY IF EXISTS "Anyone can view public cookbooks" ON public.cookbooks;
--   DROP INDEX IF EXISTS idx_cookbooks_title_trgm;
--   DROP INDEX IF EXISTS idx_cookbooks_search_vector;
--   DROP INDEX IF EXISTS idx_cookbooks_public_created;
--   ALTER TABLE cookbooks DROP COLUMN IF EXISTS search_vector;
--   ALTER TABLE cookbooks DROP COLUMN IF EXISTS is_public;
-- Dropping these returns cookbooks to REW-62 behavior with no data loss.

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------

-- NOT NULL DEFAULT false means every cookbook that existed before this
-- migration is Private afterwards, with no backfill required.
ALTER TABLE cookbooks
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Partial index covering public-cookbook listings, newest first. Mirrors
-- idx_recipes_published_created from 003_add_recipe_search.sql.
CREATE INDEX IF NOT EXISTS idx_cookbooks_public_created
  ON cookbooks (created_at DESC)
  WHERE is_public = true;

-- Title-only search vector. Cookbooks have no description today, so ranking is
-- necessarily title-only; the generated column means a future description can
-- be folded in without touching application code.
ALTER TABLE cookbooks
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_cookbooks_search_vector
  ON cookbooks USING GIN (search_vector);

-- Speeds up the partial-title ILIKE fallback in search_cookbooks() below, the
-- same way idx_recipes_title_trgm does for search_recipes().
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_cookbooks_title_trgm
  ON cookbooks USING GIN (title gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Row Level Security -- additive SELECT policies only
-- ---------------------------------------------------------------------------

-- Anyone (signed in or not) can read a cookbook the owner has made Public.
-- Additive alongside "Users can view own cookbooks" from 009; a Private
-- cookbook is still only visible to its owner.
CREATE POLICY "Anyone can view public cookbooks"
  ON public.cookbooks
  FOR SELECT TO anon, authenticated
  USING (is_public = true);

-- Membership rows of a Public cookbook are readable by anyone -- but ONLY the
-- edges that point at a published recipe.
--
-- Gating on the parent cookbook alone is NOT sufficient. The membership row
-- itself carries recipe_id and created_at, so an anon PostgREST read of
--   /rest/v1/cookbook_recipes?cookbook_id=eq.<public_id>&select=recipe_id,created_at
-- would disclose the count, UUIDs and add-times of the owner's DRAFT recipes
-- even though the recipe rows themselves stay hidden by the policies from 001.
-- The ticket's requirement is that drafts are never exposed, and the threat
-- model is the direct anon-key API read, not just the rendered page -- so the
-- recipe's status is checked here too. This mirrors
-- 013_public_recipe_card_metadata.sql, which gates every public junction-edge
-- policy on recipes.status = 'published'.
--
-- This does not affect the owner's own /cookbooks/:id view: the owner-only
-- SELECT policy from 010 is a separate PERMISSIVE policy, and permissive
-- policies are OR'd, so an owner still sees every membership row including
-- those for their drafts.
--
-- No RLS recursion risk: cookbook_recipes policies reference cookbooks and
-- recipes, and neither of those tables' policies reference cookbook_recipes.
CREATE POLICY "Anyone can view recipes in public cookbooks"
  ON public.cookbook_recipes
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cookbooks c
      WHERE c.id = cookbook_recipes.cookbook_id
        AND c.is_public = true
    )
    AND EXISTS (
      SELECT 1 FROM public.recipes r
      WHERE r.id = cookbook_recipes.recipe_id
        AND r.status = 'published'
    )
  );

-- No new UPDATE policy: "Users can update own cookbooks" (009) already covers
-- an owner writing this new column on a row they can already update.
-- No new INSERT/DELETE policies anywhere: membership stays insert/delete by
-- the owner only.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Explicit rather than relying on Supabase default privileges, matching
-- 003_add_recipe_search.sql and 013_public_recipe_card_metadata.sql. RLS above
-- remains the row-visibility boundary; this only permits the read to be
-- attempted.
GRANT SELECT ON public.cookbooks, public.cookbook_recipes TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Search RPC
-- ---------------------------------------------------------------------------

-- Search Public cookbooks by title, ranked by relevance.
--
-- SECURITY INVOKER (never DEFINER) keeps RLS in force for the calling role, so
-- the is_public filter below is defence in depth rather than the only thing
-- standing between a visitor and every private cookbook. STABLE + an explicit
-- search_path match search_recipes()'s posture exactly.
--
-- recipe_count is computed with an explicit status = 'published' predicate so
-- the number an owner sees is identical to the number a visitor sees -- without
-- it, the owner's own RLS visibility would inflate their count with drafts.
-- It is deliberately computed in the OUTER select, after LIMIT/OFFSET, so the
-- per-cookbook count subquery runs once per RETURNED row rather than once per
-- MATCHED row. count(*) OVER () still evaluates across the full match set
-- because window functions are applied before LIMIT.
--
-- Returns total_count on every row so the caller can paginate without a second
-- query, matching search_recipes()'s shape.
CREATE OR REPLACE FUNCTION public.search_cookbooks(
  search_query  text,
  result_limit  integer DEFAULT 5,
  result_offset integer DEFAULT 0
)
RETURNS TABLE (
  id           uuid,
  title        text,
  created_at   timestamptz,
  recipe_count bigint,
  rank         real,
  total_count  bigint
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
      c.id,
      c.title,
      c.created_at,
      ts_rank(c.search_vector, p.tsq) AS rank
    FROM cookbooks c
    CROSS JOIN pattern p
    WHERE c.is_public = true
      AND p.raw <> ''
      -- Full-text match, or a partial title match so "week" still finds
      -- "Weeknight Favorites"
      AND (c.search_vector @@ p.tsq OR c.title ILIKE p.like_pat)
  ),
  paged AS (
    SELECT m.*, count(*) OVER () AS total_count
    FROM matches m
    ORDER BY m.rank DESC, m.created_at DESC
    LIMIT least(greatest(result_limit, 1), 50)
    OFFSET greatest(result_offset, 0)
  )
  SELECT
    p.id,
    p.title,
    p.created_at,
    (
      SELECT count(*)
      FROM cookbook_recipes cr
      JOIN recipes r ON r.id = cr.recipe_id
      WHERE cr.cookbook_id = p.id
        AND r.status = 'published'
    ) AS recipe_count,
    p.rank,
    p.total_count
  FROM paged p
  ORDER BY p.rank DESC, p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.search_cookbooks(text, integer, integer)
  TO anon, authenticated;
