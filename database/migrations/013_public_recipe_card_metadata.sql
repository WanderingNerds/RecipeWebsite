-- Add public reads only for metadata associated with published recipes.
-- Existing owner SELECT and mutation policies remain in force.
CREATE POLICY "Anyone can view published recipe categories"
  ON public.recipe_categories FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.recipes
    WHERE recipes.id = recipe_categories.recipe_id
      AND recipes.status = 'published'
  ));

CREATE POLICY "Anyone can view published recipe tags"
  ON public.recipe_tags FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.recipes
    WHERE recipes.id = recipe_tags.recipe_id
      AND recipes.status = 'published'
  ));

-- Junction policies inspect recipes only, avoiding circular RLS dependencies.
CREATE POLICY "Anyone can view tags on published recipes"
  ON public.tags FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.recipe_tags
    JOIN public.recipes ON recipes.id = recipe_tags.recipe_id
    WHERE recipe_tags.tag_id = tags.id
      AND recipes.status = 'published'
  ));

-- Categories previously allowed only authenticated reads (migration 003).
CREATE POLICY "Anyone can view categories on published recipes"
  ON public.categories FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.recipe_categories
    JOIN public.recipes ON recipes.id = recipe_categories.recipe_id
    WHERE recipe_categories.category_id = categories.id
      AND recipes.status = 'published'
  ));

GRANT SELECT ON public.recipe_categories, public.recipe_tags, public.tags,
  public.categories TO anon, authenticated;
