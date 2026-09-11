// Like/Unlike functionality with optimistic UI and undo toast

document.addEventListener("DOMContentLoaded", () => {
  initializeLikeButtons();
});

let activeToast = null;
let undoTimeout = null;

function initializeLikeButtons() {
  document.addEventListener("click", async (e) => {
    const likeBtn = e.target.closest(".like-btn");
    if (!likeBtn) return;

    // Check if this is a guest button (requires login)
    if (likeBtn.classList.contains("like-btn-guest")) {
      showLoginPrompt();
      return;
    }

    // Prevent double-clicks
    if (likeBtn.classList.contains("is-loading")) return;

    const recipeId = likeBtn.dataset.recipeId;
    const isCurrentlyLiked = likeBtn.dataset.liked === "true";

    // Optimistic UI update
    toggleLikeUI(likeBtn, !isCurrentlyLiked);

    // Send API request
    try {
      likeBtn.classList.add("is-loading");

      const response = await fetch(`/api/likes/${recipeId}`, {
        method: isCurrentlyLiked ? "DELETE" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        // Revert on error
        toggleLikeUI(likeBtn, isCurrentlyLiked);
        const data = await response.json();
        showErrorToast(data.error || "Failed to update favorite");
        return;
      }

      const data = await response.json();

      // Update with actual count from server
      updateLikeCount(likeBtn, data.count);

      // Show undo toast on unlike
      if (isCurrentlyLiked && !data.liked) {
        showUndoToast(recipeId, likeBtn);
      }
    } catch (error) {
      console.error("Error updating like:", error);
      // Revert on error
      toggleLikeUI(likeBtn, isCurrentlyLiked);
      showErrorToast("Network error. Please try again.");
    } finally {
      likeBtn.classList.remove("is-loading");
    }
  });
}

function toggleLikeUI(likeBtn, isLiked) {
  likeBtn.dataset.liked = isLiked ? "true" : "false";
  likeBtn.setAttribute(
    "aria-label",
    isLiked ? "Remove this recipe from favorites" : "Favorite this recipe"
  );

  // Update count optimistically
  const countSpan = likeBtn.querySelector(".like-btn-count");
  if (countSpan) {
    let count = parseInt(countSpan.textContent, 10) || 0;
    count = isLiked ? count + 1 : Math.max(0, count - 1);
    countSpan.textContent = count;
  }
}

function updateLikeCount(likeBtn, count) {
  const countSpan = likeBtn.querySelector(".like-btn-count");
  if (countSpan) {
    countSpan.textContent = count;
  }
}

function showLoginPrompt() {
  // Create and show a dialog or redirect to login
  const shouldLogin = confirm(
    "You need to log in to favorite recipes. Would you like to log in now?"
  );
  if (shouldLogin) {
    window.location.href = "/auth/login";
  }
}

function showUndoToast(recipeId, likeBtn) {
  // Remove any existing toast
  hideToast();

  const toast = document.createElement("div");
  toast.className = "toast toast-undo";
  toast.innerHTML = `
    Recipe removed from favorites.
    <button class="toast-undo-btn" type="button">Undo</button>
  `;

  document.body.appendChild(toast);
  activeToast = toast;

  // Handle undo click
  const undoBtn = toast.querySelector(".toast-undo-btn");
  undoBtn.addEventListener("click", async () => {
    hideToast();

    // Re-like the recipe
    try {
      const response = await fetch(`/api/likes/${recipeId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        toggleLikeUI(likeBtn, true);
        updateLikeCount(likeBtn, data.count);
      }
    } catch (error) {
      console.error("Error undoing unlike:", error);
      showErrorToast("Failed to undo. Please try again.");
    }
  });

  // Auto-hide after 5 seconds
  undoTimeout = setTimeout(() => {
    hideToast();
  }, 5000);
}

function showErrorToast(message) {
  hideToast();

  const toast = document.createElement("div");
  toast.className = "toast toast-error";
  toast.textContent = message;

  document.body.appendChild(toast);
  activeToast = toast;

  // Auto-hide after 3 seconds
  undoTimeout = setTimeout(() => {
    hideToast();
  }, 3000);
}

function hideToast() {
  if (undoTimeout) {
    clearTimeout(undoTimeout);
    undoTimeout = null;
  }

  if (activeToast) {
    activeToast.classList.add("toast-out");
    setTimeout(() => {
      if (activeToast && activeToast.parentNode) {
        activeToast.parentNode.removeChild(activeToast);
      }
      activeToast = null;
    }, 300);
  }
}
