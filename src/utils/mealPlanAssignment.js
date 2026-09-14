const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Add a newly-created recipe to one existing meal plan owned by the user.
 * Recipe persistence intentionally happens before this helper is called, so
 * every failure is returned as a non-throwing, partial-success result.
 */
export async function assignRecipeToMealPlan(
  supabaseClient,
  { mealPlanId, recipeId, userId }
) {
  if (mealPlanId === undefined || mealPlanId === null || mealPlanId === "") {
    return { status: "skipped" };
  }

  if (typeof mealPlanId !== "string" || !UUID_PATTERN.test(mealPlanId.trim())) {
    return { status: "failed" };
  }

  const normalizedMealPlanId = mealPlanId.trim();

  try {
    const { data: mealPlan, error: lookupError } = await supabaseClient
      .from("meal_plans")
      .select("id, title")
      .eq("id", normalizedMealPlanId)
      .eq("user_id", userId)
      .maybeSingle();

    if (lookupError || !mealPlan) {
      return { status: "failed" };
    }

    const { error: assignmentError } = await supabaseClient
      .from("meal_plan_recipes")
      .upsert(
        [{ meal_plan_id: mealPlan.id, recipe_id: recipeId }],
        { onConflict: "meal_plan_id,recipe_id", ignoreDuplicates: true }
      );

    if (assignmentError) {
      return { status: "failed" };
    }

    return { status: "assigned", mealPlanTitle: mealPlan.title };
  } catch {
    return { status: "failed" };
  }
}

