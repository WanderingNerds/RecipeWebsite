export const RECIPE_VISIBILITY = Object.freeze({
  PRIVATE: "private",
  PUBLIC: "public",
});

const STATUS_BY_VISIBILITY = Object.freeze({
  [RECIPE_VISIBILITY.PRIVATE]: "draft",
  [RECIPE_VISIBILITY.PUBLIC]: "published",
});

export function normalizeRecipeVisibility(value) {
  if (typeof value !== "string") return STATUS_BY_VISIBILITY.private;
  return STATUS_BY_VISIBILITY[value] || STATUS_BY_VISIBILITY.private;
}

export function visibilityFromRecipeStatus(status) {
  return status === "published"
    ? RECIPE_VISIBILITY.PUBLIC
    : RECIPE_VISIBILITY.PRIVATE;
}
