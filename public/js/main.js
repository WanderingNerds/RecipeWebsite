// Auto-hide alerts after 5 seconds
document.addEventListener('DOMContentLoaded', () => {
  const alerts = document.querySelectorAll('.alert');

  alerts.forEach((alert) => {
    setTimeout(() => {
      alert.style.opacity = '0';
      alert.style.transition = 'opacity 0.5s ease';
      setTimeout(() => alert.remove(), 500);
    }, 5000);
  });

  // Instant recipe scaling
  initializeRecipeScaling();
});

function initializeRecipeScaling() {
  const scaleControl = document.querySelector('.scale-control');
  if (!scaleControl) return; // Not on a recipe page

  const recipeId = getRecipeIdFromUrl();
  if (!recipeId) return;

  // Handle scale button clicks (+ - and quick scale buttons)
  scaleControl.addEventListener('click', async (e) => {
    const scaleBtn = e.target.closest('.scale-btn');
    if (!scaleBtn) return;

    e.preventDefault();

    const href = scaleBtn.getAttribute('href');
    if (!href) return;

    // Extract servings or scale from the href
    const url = new URL(href, window.location.origin);
    const params = url.searchParams;

    await updateRecipeScale(recipeId, params);
  });

  // Handle servings input form submission
  const servingsForm = scaleControl.querySelector('.scale-servings-form');
  if (servingsForm) {
    servingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const servingsInput = servingsForm.querySelector('.scale-servings-input');
      if (!servingsInput) return;

      const servings = servingsInput.value;
      const params = new URLSearchParams({ servings });

      await updateRecipeScale(recipeId, params);
    });

    // Also handle input change (when user presses Enter or changes value)
    const servingsInput = servingsForm.querySelector('.scale-servings-input');
    if (servingsInput) {
      servingsInput.addEventListener('change', async (e) => {
        const servings = e.target.value;
        const params = new URLSearchParams({ servings });
        await updateRecipeScale(recipeId, params);
      });
    }
  }
}

async function updateRecipeScale(recipeId, params) {
  try {
    // Show loading state
    const ingredientsList = document.querySelector('.ingredient-list');
    if (ingredientsList) {
      ingredientsList.style.opacity = '0.5';
    }

    // Fetch scaled ingredients
    const response = await fetch(`/recipes/${recipeId}/scale?${params.toString()}`);
    if (!response.ok) {
      throw new Error('Failed to scale recipe');
    }

    const data = await response.json();

    // Update ingredients in the DOM
    updateIngredientsDisplay(data.ingredientRows);

    // Update servings display if in servings mode
    updateServingsDisplay(data.scaling);

    // Update button hrefs for +/- buttons
    updateServingsButtons(recipeId, data.scaling);

    // Update active state on quick scale buttons
    updateQuickScaleButtons(data.scaling.factor);

    // Update URL without reloading
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState({}, '', newUrl);

    // Remove loading state
    if (ingredientsList) {
      ingredientsList.style.opacity = '1';
    }
  } catch (error) {
    console.error('Error updating recipe scale:', error);
  }
}

function updateIngredientsDisplay(ingredientRows) {
  const ingredientsList = document.querySelector('.ingredient-list');
  if (!ingredientsList) return;

  // Clear current ingredients
  ingredientsList.innerHTML = '';

  // Add scaled ingredients
  ingredientRows.forEach((row) => {
    const li = document.createElement('li');

    if (row.type === 'section') {
      li.className = 'ingredient-section';
      li.textContent = row.ingredient;
    } else {
      li.className = 'ingredient-row';

      const amountSpan = document.createElement('span');
      amountSpan.className = 'ingredient-amount';

      const primarySpan = document.createElement('span');
      primarySpan.className = 'amount-primary';
      primarySpan.textContent = row.primaryAmount || '';
      amountSpan.appendChild(primarySpan);

      if (row.secondaryAmount) {
        const secondarySpan = document.createElement('span');
        secondarySpan.className = 'amount-secondary';
        secondarySpan.textContent = row.secondaryAmount;
        amountSpan.appendChild(secondarySpan);
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'ingredient-name';
      nameSpan.textContent = row.ingredient || '';

      if (row.note) {
        const noteSpan = document.createElement('span');
        noteSpan.className = 'ingredient-note';
        noteSpan.textContent = ' — ' + row.note;
        nameSpan.appendChild(noteSpan);
      }

      li.appendChild(amountSpan);
      li.appendChild(nameSpan);
    }

    ingredientsList.appendChild(li);
  });
}

function updateServingsDisplay(scaling) {
  const servingsInput = document.querySelector('.scale-servings-input');
  if (servingsInput && scaling.canScaleByServings) {
    servingsInput.value = Math.max(1, Math.round(scaling.targetServings));
  }
}

function updateServingsButtons(recipeId, scaling) {
  if (!scaling.canScaleByServings) return;

  // Find the +/- buttons (they should be adjacent to the servings form)
  const scaleControl = document.querySelector('.scale-control');
  if (!scaleControl) return;

  const buttons = scaleControl.querySelectorAll('.scale-btn');
  buttons.forEach((btn) => {
    const href = btn.getAttribute('href');
    const ariaLabel = btn.getAttribute('aria-label');

    // Update the minus button
    if (ariaLabel === 'Fewer servings' || btn.textContent.trim() === '−') {
      btn.setAttribute('href', `/recipes/${recipeId}?servings=${scaling.stepDownServings}`);
    }
    // Update the plus button
    else if (ariaLabel === 'More servings' || btn.textContent.trim() === '+') {
      btn.setAttribute('href', `/recipes/${recipeId}?servings=${scaling.stepUpServings}`);
    }
  });
}

function updateQuickScaleButtons(currentFactor) {
  const scaleButtons = document.querySelectorAll('.scale-btn');
  scaleButtons.forEach((btn) => {
    const href = btn.getAttribute('href');
    if (!href) return;

    // Check if this is a quick scale button
    const url = new URL(href, window.location.origin);
    const scaleParam = url.searchParams.get('scale');

    if (scaleParam) {
      const factor = parseFloat(scaleParam);
      if (Math.abs(factor - currentFactor) < 0.01) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    } else if (href.indexOf('?') === -1 && Math.abs(1 - currentFactor) < 0.01) {
      // This is the 1x button (no query params)
      btn.classList.add('is-active');
    } else if (scaleParam === null) {
      btn.classList.remove('is-active');
    }
  });
}

function getRecipeIdFromUrl() {
  const match = window.location.pathname.match(/\/recipes\/([^\/]+)/);
  return match ? match[1] : null;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
