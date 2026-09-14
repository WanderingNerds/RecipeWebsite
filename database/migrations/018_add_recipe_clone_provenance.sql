-- REW-84: durable provenance for recipes copied from another user's recipe.
ALTER TABLE public.recipes
  ADD COLUMN cloned_from_recipe_id UUID
    REFERENCES public.recipes(id) ON DELETE SET NULL,
  ADD COLUMN original_author TEXT,
  ADD CONSTRAINT recipes_original_author_trimmed_check CHECK (
    original_author IS NULL
    OR (
      original_author = btrim(original_author)
      AND char_length(original_author) BETWEEN 1 AND 255
    )
  );

CREATE INDEX recipes_cloned_from_recipe_id_idx
  ON public.recipes (cloned_from_recipe_id);

CREATE FUNCTION public.enforce_recipe_clone_provenance() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW.cloned_from_recipe_id IS NULL) <> (NEW.original_author IS NULL) THEN
      RAISE EXCEPTION 'Recipe clone provenance must include both source and original author'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.cloned_from_recipe_id IS DISTINCT FROM OLD.cloned_from_recipe_id
     OR NEW.original_author IS DISTINCT FROM OLD.original_author THEN
    -- The self-reference intentionally clears when its source is deleted. PostgreSQL
    -- performs that referential action as an UPDATE, so permit only that exact case.
    IF OLD.cloned_from_recipe_id IS NOT NULL
       AND NEW.cloned_from_recipe_id IS NULL
       AND NEW.original_author IS NOT DISTINCT FROM OLD.original_author
       AND NOT EXISTS (
         SELECT 1 FROM public.recipes AS source
         WHERE source.id = OLD.cloned_from_recipe_id
       ) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Recipe clone provenance is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_recipe_clone_provenance_on_insert
  BEFORE INSERT ON public.recipes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_recipe_clone_provenance();

CREATE TRIGGER enforce_recipe_clone_provenance_on_update
  BEFORE UPDATE OF cloned_from_recipe_id, original_author ON public.recipes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_recipe_clone_provenance();
