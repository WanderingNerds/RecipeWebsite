// Add to Meal Plan modal: fetch-based plan list + add/remove toggle,
// modeled on the AJAX pattern in likes.js and the static-modal-in-layout
// pattern in import-modal.ejs (REW-63).
//
// Function/variable names below are deliberately prefixed with
// `mealPlan`/`MealPlan` to avoid clashing with likes.js's own
// similarly-named top-level helpers (toast/login-prompt helpers are
// duplicated here rather than shared, matching this repo's existing
// per-file helper convention -- see cookbookUtils.js's comment on
// getLikeCount/hasUserLiked being duplicated between route files).

document.addEventListener("DOMContentLoaded", () => {
  initializeMealPlanModal();
});

let mealPlanActiveToast = null;
let mealPlanToastTimeout = null;
let mealPlanCurrentRecipeId = null;

function initializeMealPlanModal() {
  const modal = document.getElementById("mealPlanModal");

  // Delegate clicks globally so this works for every "Add to Meal Plan"
  // button on the page, whether it's on a recipe card (many per grid page)
  // or a recipe view page (one instance) -- no per-instance wiring needed.
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest(".meal-plan-add-btn");
    if (addBtn) {
      e.preventDefault();

      if (addBtn.classList.contains("meal-plan-add-btn-guest")) {
        showMealPlanLoginPrompt();
        return;
      }

      const recipeId = addBtn.dataset.recipeId;
      if (!recipeId || !modal) return;

      openMealPlanModal(recipeId);
      return;
    }

    if (!modal) return;

    if (e.target.id === "closeMealPlanModal" || e.target === modal) {
      closeMealPlanModal();
    }
  });

  if (!modal) return;

  const newToggle = document.getElementById("mealPlanModalNewToggle");
  const newForm = document.getElementById("mealPlanModalNewForm");

  if (newToggle && newForm) {
    newToggle.addEventListener("click", () => {
      const isHidden = newForm.style.display === "none";
      newForm.style.display = isHidden ? "block" : "none";
      newToggle.textContent = isHidden ? "Cancel" : "+ New meal plan";
    });

    newForm.addEventListener("submit", handleCreateMealPlan);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.style.display !== "none") {
      closeMealPlanModal();
    }
  });
}

function openMealPlanModal(recipeId) {
  const modal = document.getElementById("mealPlanModal");
  if (!modal) return;

  mealPlanCurrentRecipeId = recipeId;
  modal.style.display = "flex";
  resetNewMealPlanForm();
  loadMealPlans(recipeId);
}

function closeMealPlanModal() {
  const modal = document.getElementById("mealPlanModal");
  if (modal) modal.style.display = "none";
  mealPlanCurrentRecipeId = null;
}

function resetNewMealPlanForm() {
  const newForm = document.getElementById("mealPlanModalNewForm");
  const newToggle = document.getElementById("mealPlanModalNewToggle");
  if (newForm) {
    newForm.style.display = "none";
    newForm.reset();
  }
  if (newToggle) newToggle.textContent = "+ New meal plan";
}

async function loadMealPlans(recipeId) {
  const listEl = document.getElementById("mealPlanModalList");
  const statusEl = document.getElementById("mealPlanModalStatus");
  if (!listEl) return;

  listEl.innerHTML = "";
  if (statusEl) statusEl.textContent = "Loading your meal plans…";

  try {
    const response = await fetch(`/api/meal-plans?recipeId=${encodeURIComponent(recipeId)}`, {
      headers: { "Content-Type": "application/json" },
    });

    if (response.status === 401) {
      if (statusEl) statusEl.textContent = "";
      closeMealPlanModal();
      showMealPlanLoginPrompt();
      return;
    }

    if (!response.ok) {
      if (statusEl) statusEl.textContent = "Failed to load your meal plans.";
      return;
    }

    const data = await response.json();
    renderMealPlanList(data.mealPlans || []);
  } catch (error) {
    console.error("Error loading meal plans:", error);
    if (statusEl) statusEl.textContent = "Network error. Please try again.";
  }
}

function renderMealPlanList(mealPlans) {
  const listEl = document.getElementById("mealPlanModalList");
  const statusEl = document.getElementById("mealPlanModalStatus");
  if (!listEl) return;

  if (statusEl) {
    statusEl.textContent = mealPlans.length
      ? "Select a meal plan to add this recipe to, or remove it below."
      : "You don't have any meal plans yet. Create one below.";
  }

  listEl.innerHTML = "";

  mealPlans.forEach((plan) => {
    const row = document.createElement("div");
    row.className = "meal-plan-modal-row";
    row.dataset.mealPlanId = plan.id;

    const info = document.createElement("span");
    info.className = "meal-plan-modal-row-info";

    const titleEl = document.createElement("strong");
    titleEl.textContent = plan.title;

    const datesEl = document.createElement("span");
    datesEl.className = "meal-plan-modal-row-dates";
    datesEl.textContent = formatMealPlanDateRange(plan.startDate, plan.endDate);

    info.appendChild(titleEl);
    info.appendChild(datesEl);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline meal-plan-toggle-btn";
    btn.dataset.mealPlanId = plan.id;
    btn.dataset.inPlan = plan.containsRecipe ? "true" : "false";
    btn.textContent = plan.containsRecipe ? "Remove" : "Add";
    btn.addEventListener("click", () => toggleMealPlanMembership(plan.id, btn));

    row.appendChild(info);
    row.appendChild(btn);
    listEl.appendChild(row);
  });
}

async function toggleMealPlanMembership(mealPlanId, btn) {
  if (!mealPlanCurrentRecipeId || btn.classList.contains("is-loading")) return;

  const currentlyIn = btn.dataset.inPlan === "true";
  const method = currentlyIn ? "DELETE" : "POST";

  btn.classList.add("is-loading");
  btn.disabled = true;

  try {
    const response = await fetch(
      `/api/meal-plans/${mealPlanId}/recipes/${mealPlanCurrentRecipeId}`,
      { method, headers: { "Content-Type": "application/json" } }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      showMealPlanErrorToast(data.error || "Failed to update meal plan");
      return;
    }

    btn.dataset.inPlan = data.added ? "true" : "false";
    btn.textContent = data.added ? "Remove" : "Add";
  } catch (error) {
    console.error("Error updating meal plan membership:", error);
    showMealPlanErrorToast("Network error. Please try again.");
  } finally {
    btn.classList.remove("is-loading");
    btn.disabled = false;
  }
}

async function handleCreateMealPlan(e) {
  e.preventDefault();

  if (!mealPlanCurrentRecipeId) return;

  const titleInput = document.getElementById("mealPlanModalTitle");
  const startInput = document.getElementById("mealPlanModalStartDate");
  const endInput = document.getElementById("mealPlanModalEndDate");
  const submitBtn = e.target.querySelector('button[type="submit"]');

  const title = titleInput ? titleInput.value : "";
  const startDate = startInput ? startInput.value : "";
  const endDate = endInput ? endInput.value : "";

  if (submitBtn) submitBtn.disabled = true;

  try {
    const createResponse = await fetch("/api/meal-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, startDate, endDate }),
    });

    const createData = await createResponse.json().catch(() => ({}));

    if (!createResponse.ok) {
      showMealPlanErrorToast(createData.error || "Failed to create meal plan");
      return;
    }

    const newPlan = createData.mealPlan;

    // Immediately add the current recipe to the newly created plan, so
    // "Create & Add Recipe" does what it says in one click.
    await fetch(`/api/meal-plans/${newPlan.id}/recipes/${mealPlanCurrentRecipeId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    resetNewMealPlanForm();
    await loadMealPlans(mealPlanCurrentRecipeId);
  } catch (error) {
    console.error("Error creating meal plan:", error);
    showMealPlanErrorToast("Network error. Please try again.");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function formatMealPlanDateRange(startDate, endDate) {
  const options = { month: "short", day: "numeric" };
  try {
    const start = new Date(`${startDate}T00:00:00`).toLocaleDateString(undefined, options);
    const end = new Date(`${endDate}T00:00:00`).toLocaleDateString(undefined, options);
    return `${start} – ${end}`;
  } catch (error) {
    return `${startDate} – ${endDate}`;
  }
}

function showMealPlanLoginPrompt() {
  const shouldLogin = confirm(
    "You need to log in to add recipes to a meal plan. Would you like to log in now?"
  );
  if (shouldLogin) {
    window.location.href = "/auth/login";
  }
}

function showMealPlanErrorToast(message) {
  hideMealPlanToast();

  const toast = document.createElement("div");
  toast.className = "toast toast-error";
  toast.textContent = message;

  document.body.appendChild(toast);
  mealPlanActiveToast = toast;

  mealPlanToastTimeout = setTimeout(() => {
    hideMealPlanToast();
  }, 3000);
}

function hideMealPlanToast() {
  if (mealPlanToastTimeout) {
    clearTimeout(mealPlanToastTimeout);
    mealPlanToastTimeout = null;
  }

  if (mealPlanActiveToast) {
    mealPlanActiveToast.classList.add("toast-out");
    setTimeout(() => {
      if (mealPlanActiveToast && mealPlanActiveToast.parentNode) {
        mealPlanActiveToast.parentNode.removeChild(mealPlanActiveToast);
      }
      mealPlanActiveToast = null;
    }, 300);
  }
}
