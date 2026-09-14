export function recipeTitleMatches(title, searchTerm) {
  return String(title || '').toLocaleLowerCase().includes(String(searchTerm || '').trim().toLocaleLowerCase());
}

export function recipeSearchStatus(visibleCount, totalCount, searchTerm) {
  const count = searchTerm ? visibleCount : totalCount;
  return `${count} recipe${count === 1 ? '' : 's'} ${searchTerm ? 'found' : 'available'}`;
}

export function initializeMealPlanRecipeSearch(doc = document) {
  const searchInput = doc.getElementById('meal-plan-recipe-search');
  const clearButton = doc.getElementById('meal-plan-recipe-search-clear');
  const recipeList = doc.getElementById('meal-plan-recipe-list');
  const emptyState = doc.getElementById('meal-plan-recipe-search-empty');
  const status = doc.getElementById('meal-plan-recipe-search-status');

  if (!searchInput || !clearButton || !recipeList || !emptyState || !status) return;

  const recipeItems = Array.from(recipeList.querySelectorAll('[data-recipe-search-item]'));

  function filterRecipes() {
    const searchTerm = searchInput.value.trim().toLocaleLowerCase();
    let visibleCount = 0;

    recipeItems.forEach(function (item) {
      const matches = recipeTitleMatches(item.dataset.recipeTitle, searchTerm);
      item.hidden = !matches;
      item.style.display = matches ? 'flex' : 'none';
      visibleCount += matches ? 1 : 0;
    });

    recipeList.hidden = visibleCount === 0;
    emptyState.hidden = visibleCount !== 0;
    clearButton.hidden = searchTerm.length === 0;
    status.textContent = recipeSearchStatus(visibleCount, recipeItems.length, searchTerm);
  }

  searchInput.addEventListener('input', filterRecipes);
  clearButton.addEventListener('click', function () {
    searchInput.value = '';
    filterRecipes();
    searchInput.focus();
  });
  filterRecipes();
}

if (typeof document !== 'undefined') initializeMealPlanRecipeSearch();
