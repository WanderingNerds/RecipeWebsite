// Add to Cookbook modal: fetch-based cookbook list + add/remove toggle
// (REW-86), modeled directly on public/js/meal-plans.js and the
// static-modal-in-layout pattern in meal-plan-modal.ejs.
//
// This must stay an external file: helmet's CSP is script-src 'self', so no
// inline handlers. State-changing fetches below pick up the x-csrf-token
// header from the window.fetch wrapper in main.js -- nothing here bypasses it.
//
// Function/variable names are deliberately prefixed with `cookbook`/`Cookbook`
// to avoid clashing with the similarly-shaped top-level helpers in
// meal-plans.js and likes.js, matching this repo's per-file helper convention.

document.addEventListener("DOMContentLoaded", () => {
  initializeCookbookModal();
});

let cookbookActiveToast = null;
let cookbookToastTimeout = null;
let cookbookCurrentRecipeId = null;

function initializeCookbookModal() {
  const modal = document.getElementById("cookbookModal");

  // Delegate clicks globally so this works for every "+ Cookbook" button on
  // the page, whether it's on a recipe card (many per grid page) or a single
  // recipe view -- no per-instance wiring needed.
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest(".cookbook-add-btn");
    if (addBtn) {
      e.preventDefault();

      if (addBtn.classList.contains("cookbook-add-btn-guest")) {
        showCookbookLoginPrompt();
        return;
      }

      const recipeId = addBtn.dataset.recipeId;
      if (!recipeId || !modal) return;

      openCookbookModal(recipeId);
      return;
    }

    if (!modal) return;

    if (e.target.id === "closeCookbookModal" || e.target === modal) {
      closeCookbookModal();
    }
  });

  if (!modal) return;

  const newToggle = document.getElementById("cookbookModalNewToggle");
  const newForm = document.getElementById("cookbookModalNewForm");

  if (newToggle && newForm) {
    newToggle.addEventListener("click", () => {
      const isHidden = newForm.style.display === "none";
      newForm.style.display = isHidden ? "block" : "none";
      newToggle.textContent = isHidden ? "Cancel" : "+ New cookbook";
    });

    newForm.addEventListener("submit", handleCreateCookbook);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.style.display !== "none") {
      closeCookbookModal();
    }
  });
}

function openCookbookModal(recipeId) {
  const modal = document.getElementById("cookbookModal");
  if (!modal) return;

  cookbookCurrentRecipeId = recipeId;
  modal.style.display = "flex";
  resetNewCookbookForm();
  loadCookbooks(recipeId);
}

function closeCookbookModal() {
  const modal = document.getElementById("cookbookModal");
  if (modal) modal.style.display = "none";
  cookbookCurrentRecipeId = null;
}

function resetNewCookbookForm() {
  const newForm = document.getElementById("cookbookModalNewForm");
  const newToggle = document.getElementById("cookbookModalNewToggle");
  if (newForm) {
    newForm.style.display = "none";
    newForm.reset();
  }
  if (newToggle) newToggle.textContent = "+ New cookbook";
}

async function loadCookbooks(recipeId) {
  const listEl = document.getElementById("cookbookModalList");
  const statusEl = document.getElementById("cookbookModalStatus");
  if (!listEl) return;

  listEl.innerHTML = "";
  if (statusEl) statusEl.textContent = "Loading your cookbooks…";

  try {
    const response = await fetch(`/api/cookbooks?recipeId=${encodeURIComponent(recipeId)}`, {
      headers: { "Content-Type": "application/json" },
    });

    if (response.status === 401) {
      if (statusEl) statusEl.textContent = "";
      closeCookbookModal();
      showCookbookLoginPrompt();
      return;
    }

    if (!response.ok) {
      if (statusEl) statusEl.textContent = "Failed to load your cookbooks.";
      return;
    }

    const data = await response.json();
    renderCookbookList(data.cookbooks || []);
  } catch (error) {
    console.error("Error loading cookbooks:", error);
    if (statusEl) statusEl.textContent = "Network error. Please try again.";
  }
}

function renderCookbookList(cookbooks) {
  const listEl = document.getElementById("cookbookModalList");
  const statusEl = document.getElementById("cookbookModalStatus");
  if (!listEl) return;

  if (statusEl) {
    statusEl.textContent = cookbooks.length
      ? "Select a cookbook to add this recipe to, or remove it below."
      : "You don't have any cookbooks yet. Create one below.";
  }

  listEl.innerHTML = "";

  cookbooks.forEach((cookbook) => {
    const row = document.createElement("div");
    row.className = "cookbook-modal-row";
    row.dataset.cookbookId = cookbook.id;

    const info = document.createElement("span");
    info.className = "cookbook-modal-row-info";

    const titleEl = document.createElement("strong");
    // textContent, never innerHTML: cookbook titles are user-controlled text.
    titleEl.textContent = cookbook.title;
    info.appendChild(titleEl);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline cookbook-toggle-btn";
    btn.dataset.cookbookId = cookbook.id;
    btn.dataset.inCookbook = cookbook.containsRecipe ? "true" : "false";
    btn.textContent = cookbook.containsRecipe ? "Remove" : "Add";
    btn.addEventListener("click", () => toggleCookbookMembership(cookbook.id, btn));

    row.appendChild(info);
    row.appendChild(btn);
    listEl.appendChild(row);
  });
}

async function toggleCookbookMembership(cookbookId, btn) {
  if (!cookbookCurrentRecipeId || btn.classList.contains("is-loading")) return;

  const currentlyIn = btn.dataset.inCookbook === "true";
  const method = currentlyIn ? "DELETE" : "POST";

  btn.classList.add("is-loading");
  btn.disabled = true;

  try {
    const response = await fetch(
      `/api/cookbooks/${cookbookId}/recipes/${cookbookCurrentRecipeId}`,
      { method, headers: { "Content-Type": "application/json" } }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      showCookbookErrorToast(data.error || "Failed to update cookbook");
      return;
    }

    btn.dataset.inCookbook = data.added ? "true" : "false";
    btn.textContent = data.added ? "Remove" : "Add";
  } catch (error) {
    console.error("Error updating cookbook membership:", error);
    showCookbookErrorToast("Network error. Please try again.");
  } finally {
    btn.classList.remove("is-loading");
    btn.disabled = false;
  }
}

async function handleCreateCookbook(e) {
  e.preventDefault();

  if (!cookbookCurrentRecipeId) return;

  const titleInput = document.getElementById("cookbookModalTitle");
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const title = titleInput ? titleInput.value : "";

  if (submitBtn) submitBtn.disabled = true;

  try {
    const createResponse = await fetch("/api/cookbooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });

    const createData = await createResponse.json().catch(() => ({}));

    if (!createResponse.ok) {
      showCookbookErrorToast(createData.error || "Failed to create cookbook");
      return;
    }

    // Immediately add the current recipe to the newly created cookbook, so
    // "Create & Add Recipe" does what it says in one click. The cookbook
    // itself was created successfully by this point, so a failed add is
    // surfaced but not treated as a failed create: the list below still
    // refreshes and shows the new (empty) cookbook, from which the user can
    // retry the add.
    //
    // The id is checked rather than dereferenced blindly: an OK response whose
    // body failed to parse (or arrived in an unexpected shape) would otherwise
    // throw a TypeError here, get swallowed by the outer catch, and be
    // reported to the user as a "Network error" that never happened.
    const newCookbookId = createData?.cookbook?.id;

    if (!newCookbookId) {
      showCookbookErrorToast(
        "Cookbook created, but the recipe could not be added. Please try adding it from the list."
      );
    } else {
      const addResponse = await fetch(
        `/api/cookbooks/${newCookbookId}/recipes/${cookbookCurrentRecipeId}`,
        { method: "POST", headers: { "Content-Type": "application/json" } }
      );

      if (!addResponse.ok) {
        const addData = await addResponse.json().catch(() => ({}));
        showCookbookErrorToast(
          addData.error || "Cookbook created, but the recipe could not be added"
        );
      }
    }

    resetNewCookbookForm();
    await loadCookbooks(cookbookCurrentRecipeId);
  } catch (error) {
    console.error("Error creating cookbook:", error);
    showCookbookErrorToast("Network error. Please try again.");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function showCookbookLoginPrompt() {
  const shouldLogin = confirm(
    "You need to log in to add recipes to a cookbook. Would you like to log in now?"
  );
  if (shouldLogin) {
    window.location.href = "/auth/login";
  }
}

function showCookbookErrorToast(message) {
  hideCookbookToast();

  const toast = document.createElement("div");
  toast.className = "toast toast-error";
  toast.textContent = message;

  document.body.appendChild(toast);
  cookbookActiveToast = toast;

  cookbookToastTimeout = setTimeout(() => {
    hideCookbookToast();
  }, 3000);
}

function hideCookbookToast() {
  if (cookbookToastTimeout) {
    clearTimeout(cookbookToastTimeout);
    cookbookToastTimeout = null;
  }

  if (cookbookActiveToast) {
    cookbookActiveToast.classList.add("toast-out");
    setTimeout(() => {
      if (cookbookActiveToast && cookbookActiveToast.parentNode) {
        cookbookActiveToast.parentNode.removeChild(cookbookActiveToast);
      }
      cookbookActiveToast = null;
    }, 300);
  }
}
