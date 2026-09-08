# Release: REW-59 - Make Browse Recipe Cards Match My Recipes Recipe Cards

**Unpublished release draft.** Local implementation and QA are complete; deployment and database acceptance are pending. This document does not claim the feature has shipped.

## Jira issues addressed

[REW-59](https://wanderingnerds.atlassian.net/browse/REW-59). No Jira transition or comment was made by this workflow.

## Confluence pages created/updated

None published. This file is the release-page draft. The planning draft is [the local implementation plan](../plans/rew-59-browse-recipe-cards.md). Related pages identified during planning are [Use Fixed-Width Recipe Cards](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/20873242) and [Manual Recipe Entry and Recipe Search](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/10485762); review their current contents before publishing related updates.

## Summary of change

Browse uses the same core card presentation as My Recipes, including all categories, tags, both cooking times, difficulty, and creation date. Public cards keep public navigation and Meal Plan actions. Private management controls remain exclusive to My Recipes.

## User impact

Visitors can compare recipe details consistently across the two listings. Zero, one, or multiple tags render cleanly, including long text on narrow screens. Search retains its existing presentation.

## Technical impact

A shared EJS partial separates public and private navigation/actions. Browse loads nested metadata in one paginated anonymous query, normalizes absent relationships, and preserves published-only filtering, sorting, counts, and error behavior. Scoped CSS keeps metadata and action labels within cards.

## Database changes

Migration `013_public_recipe_card_metadata.sql` adds four SELECT policies and read grants for published recipe metadata. Draft associations and draft-only tags remain private under the intended policies; existing owner access and mutation policies are retained. No table or column changes occur. Apply and validate the migration in staging before release.

## API changes

No new endpoints. The public HTML Browse response includes the additional card metadata. See [Browse route documentation](../api/browse-recipes.md).

## Testing notes

All 145 automated tests passed, including 10 new route/rendering regressions. Independent review approved the implementation. Chrome fixture checks passed at 390px and 1440px, including tag wrapping and public/private action boundaries. The actual app returned HTTP 200 for the startup login-page smoke test. Database policy execution and live end-to-end behavior remain unverified; see the [QA report](../qa/rew-59-browse-recipe-cards.md).

## Documentation updates required

Local README, database guidance, API documentation, implementation notes, and QA notes are updated. Before release, record staging migration/access results, complete live interaction checks, publish the release and relevant planning documentation, and update Jira as authorized. No new configuration or deployment service is required.

## Release notes

Browse recipe cards now share My Recipes' core metadata layout, including tags, categories, separate prep/cook times, difficulty, and creation date. Browse retains public navigation and Meal Plan controls, while Edit/Delete remain on My Recipes. Long text and action labels fit within cards at desktop and mobile widths. Requires database migration 013 before deployment acceptance.
