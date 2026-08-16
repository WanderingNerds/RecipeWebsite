/**
 * Recipe Import Client-Side JavaScript
 *
 * Handles file upload, drag-drop, parsing, preview display,
 * title validation, and recipe saving.
 */

document.addEventListener("DOMContentLoaded", function () {
  // Elements
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const browseButton = document.getElementById("browseButton");
  const dropZoneContent = document.getElementById("dropZoneContent");
  const uploadProgress = document.getElementById("uploadProgress");
  const uploadFileName = document.getElementById("uploadFileName");
  const uploadError = document.getElementById("uploadError");
  const uploadErrorMessage = document.getElementById("uploadErrorMessage");
  const uploadSection = document.getElementById("uploadSection");
  const previewSection = document.getElementById("previewSection");
  const importForm = document.getElementById("importForm");
  const startOverButton = document.getElementById("startOverButton");

  // Preview form elements
  const importTitle = document.getElementById("importTitle");
  const importIngredients = document.getElementById("importIngredients");
  const importInstructions = document.getElementById("importInstructions");
  const importPrepTime = document.getElementById("importPrepTime");
  const importCookTime = document.getElementById("importCookTime");
  const importServings = document.getElementById("importServings");
  const importSourceUrl = document.getElementById("importSourceUrl");
  const importDescription = document.getElementById("importDescription");
  const titleError = document.getElementById("titleError");
  const warningsSection = document.getElementById("warningsSection");
  const warningsList = document.getElementById("warningsList");
  const confidenceFill = document.getElementById("confidenceFill");

  if (!dropZone || !fileInput) return;

  // Get CSRF token
  const csrfInput = document.querySelector('input[name="_csrf"]');
  const csrfToken = csrfInput ? csrfInput.value : "";

  // Max file size in bytes (2MB)
  const MAX_FILE_SIZE = 2 * 1024 * 1024;

  // Allowed MIME types
  const ALLOWED_TYPES = [
    "application/json",
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  // Title validation debounce timer
  let titleValidationTimer = null;

  /**
   * Show error message
   */
  function showError(message) {
    uploadError.style.display = "block";
    uploadErrorMessage.textContent = message;
  }

  /**
   * Hide error message
   */
  function hideError() {
    uploadError.style.display = "none";
  }

  /**
   * Show upload progress
   */
  function showProgress(fileName) {
    dropZoneContent.style.display = "none";
    uploadProgress.style.display = "block";
    uploadFileName.textContent = fileName;
    hideError();
  }

  /**
   * Hide upload progress and show content
   */
  function hideProgress() {
    dropZoneContent.style.display = "block";
    uploadProgress.style.display = "none";
  }

  /**
   * Validate file before upload
   */
  function validateFile(file) {
    if (!file) {
      return "No file selected";
    }

    if (file.size > MAX_FILE_SIZE) {
      return "File must be under 2MB";
    }

    // Check MIME type
    if (!ALLOWED_TYPES.includes(file.type)) {
      // Also check file extension as fallback
      const ext = file.name.split(".").pop().toLowerCase();
      const allowedExtensions = ["json", "pdf", "jpg", "jpeg", "png", "webp"];
      if (!allowedExtensions.includes(ext)) {
        return "Please upload a JSON, PDF, or image file";
      }
    }

    return null;
  }

  /**
   * Upload and parse file
   */
  async function uploadFile(file) {
    const validationError = validateFile(file);
    if (validationError) {
      showError(validationError);
      return;
    }

    showProgress(file.name);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/recipes/import/parse", {
        method: "POST",
        headers: {
          "X-CSRF-Token": csrfToken,
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to parse file");
      }

      if (data.success && data.recipe) {
        displayPreview(data.recipe);
      } else {
        throw new Error("Invalid response from server");
      }
    } catch (error) {
      hideProgress();
      showError(error.message || "Failed to process file. Please try again.");
    }
  }

  /**
   * Display parsed recipe preview
   */
  function displayPreview(recipe) {
    // Fill form fields
    importTitle.value = recipe.title || "";
    importIngredients.value = recipe.ingredients || "";
    importInstructions.value = recipe.instructions || "";
    importPrepTime.value = recipe.prepTime || "";
    importCookTime.value = recipe.cookTime || "";
    importServings.value = recipe.servings || "";
    importSourceUrl.value = recipe.sourceUrl || "";
    importDescription.value = recipe.description || "";

    // Display confidence indicator
    const confidence = recipe.confidence || 0;
    const confidencePercent = Math.round(confidence * 100);
    confidenceFill.style.width = `${confidencePercent}%`;

    // Color based on confidence
    if (confidence >= 0.8) {
      confidenceFill.style.backgroundColor = "#28a745"; // Green
    } else if (confidence >= 0.5) {
      confidenceFill.style.backgroundColor = "#ffc107"; // Yellow
    } else {
      confidenceFill.style.backgroundColor = "#dc3545"; // Red
    }

    // Display warnings if any
    if (recipe.warnings && recipe.warnings.length > 0) {
      warningsSection.style.display = "block";
      warningsList.innerHTML = "";
      recipe.warnings.forEach(function (warning) {
        const li = document.createElement("li");
        li.textContent = warning;
        warningsList.appendChild(li);
      });
    } else {
      warningsSection.style.display = "none";
    }

    // Clear any previous title errors
    titleError.style.display = "none";
    importTitle.style.borderColor = "var(--border-color)";

    // Show preview section, hide upload section
    uploadSection.style.display = "none";
    previewSection.style.display = "block";

    // Focus on title for immediate editing
    importTitle.focus();

    // Validate title
    validateTitle(recipe.title);
  }

  /**
   * Validate title for duplicates
   */
  async function validateTitle(title) {
    if (!title || !title.trim()) {
      titleError.textContent = "Title is required";
      titleError.style.display = "block";
      importTitle.style.borderColor = "var(--error-color)";
      return false;
    }

    try {
      const response = await fetch("/recipes/import/check-title", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ title: title.trim() }),
      });

      const data = await response.json();

      if (data.exists) {
        titleError.textContent = data.message || "A recipe with this title already exists";
        titleError.style.display = "block";
        importTitle.style.borderColor = "var(--error-color)";
        return false;
      } else {
        titleError.style.display = "none";
        importTitle.style.borderColor = "var(--border-color)";
        return true;
      }
    } catch (error) {
      console.error("Title validation error:", error);
      return true; // Allow submission, server will validate
    }
  }

  /**
   * Reset to upload view
   */
  function startOver() {
    previewSection.style.display = "none";
    uploadSection.style.display = "block";
    hideProgress();
    hideError();
    fileInput.value = "";
  }

  /**
   * Save imported recipe
   */
  async function saveRecipe(action) {
    // Validate title first
    const titleValid = await validateTitle(importTitle.value);
    if (!titleValid) {
      importTitle.focus();
      return;
    }

    // Validate instructions
    if (!importInstructions.value.trim()) {
      alert("Instructions are required");
      importInstructions.focus();
      return;
    }

    // Disable submit buttons
    const saveDraftButton = document.getElementById("saveDraftButton");
    const publishButton = document.getElementById("publishButton");
    saveDraftButton.disabled = true;
    publishButton.disabled = true;

    try {
      const response = await fetch("/recipes/import/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          title: importTitle.value.trim(),
          description: importDescription.value.trim(),
          ingredients: importIngredients.value.trim(),
          instructions: importInstructions.value.trim(),
          prepTime: importPrepTime.value.trim(),
          cookTime: importCookTime.value.trim(),
          servings: importServings.value.trim(),
          sourceUrl: importSourceUrl.value.trim(),
          action: action,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.duplicateTitle) {
          titleError.textContent = data.error;
          titleError.style.display = "block";
          importTitle.style.borderColor = "var(--error-color)";
          importTitle.focus();
        } else {
          alert(data.error || "Failed to save recipe");
        }
        return;
      }

      // Success - redirect to recipes list
      window.location.href = "/recipes?success=" + encodeURIComponent(data.message);
    } catch (error) {
      console.error("Save error:", error);
      alert("Failed to save recipe. Please try again.");
    } finally {
      saveDraftButton.disabled = false;
      publishButton.disabled = false;
    }
  }

  // Event Listeners

  // Browse button click
  browseButton.addEventListener("click", function () {
    fileInput.click();
  });

  // Drop zone click
  dropZone.addEventListener("click", function (e) {
    if (e.target !== browseButton) {
      fileInput.click();
    }
  });

  // File input change
  fileInput.addEventListener("change", function () {
    if (fileInput.files.length > 0) {
      uploadFile(fileInput.files[0]);
    }
  });

  // Drag and drop
  dropZone.addEventListener("dragover", function (e) {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });

  dropZone.addEventListener("dragleave", function () {
    dropZone.classList.remove("dragover");
  });

  dropZone.addEventListener("drop", function (e) {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });

  // Start over button
  if (startOverButton) {
    startOverButton.addEventListener("click", startOver);
  }

  // Title validation on input (debounced)
  if (importTitle) {
    importTitle.addEventListener("input", function () {
      clearTimeout(titleValidationTimer);
      titleValidationTimer = setTimeout(function () {
        validateTitle(importTitle.value);
      }, 500);
    });
  }

  // Form submission
  if (importForm) {
    importForm.addEventListener("submit", function (e) {
      e.preventDefault();
      const action = e.submitter ? e.submitter.value : "draft";
      saveRecipe(action);
    });
  }
});
