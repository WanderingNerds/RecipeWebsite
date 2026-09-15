// Recipe form image preview functionality
document.addEventListener('DOMContentLoaded', function() {
  const photoInput = document.getElementById('photo');
  const photoPreview = document.getElementById('photoPreview');
  const photoImage = document.getElementById('photoImage');
  const photoPlaceholder = document.getElementById('photoPlaceholder');
  const photoError = document.getElementById('photoError');

  if (!photoInput || !photoPreview || !photoImage || !photoPlaceholder) {
    return; // Not on a recipe form page
  }

  // Max photo size in bytes (4MB) - must stay at or below the server limit in
  // src/routes/recipeRoutes.js (MAX_RECIPE_IMAGE_SIZE_BYTES). This is UX only:
  // the multer limit on the server is the actual enforcement.
  const MAX_PHOTO_SIZE = 4 * 1024 * 1024;

  // Copy derived from MAX_PHOTO_SIZE so a limit change cannot leave stale text
  // behind. Mirrors RECIPE_IMAGE_TOO_LARGE_MESSAGE on the server.
  const MAX_PHOTO_SIZE_LABEL = `${MAX_PHOTO_SIZE / (1024 * 1024)}MB`;
  const PHOTO_TOO_LARGE_MESSAGE = `Photo must be under ${MAX_PHOTO_SIZE_LABEL}`;

  function setPhotoError(message) {
    if (!photoError) return;
    photoError.textContent = message || '';
    photoError.style.display = message ? 'block' : 'none';
  }

  // Snapshot of the preview as the page loaded. The oversize path restores this
  // rather than simply leaving whatever is on screen, so a just-previewed file
  // is dropped along with the cleared input - while a photo already saved on
  // the recipe (the edit form) is preserved, since that one really is still
  // what the server holds.
  const initialPreview = {
    src: photoImage.getAttribute('src') || '',
    display: photoImage.style.display,
    objectFit: photoImage.style.objectFit,
    placeholderDisplay: photoPlaceholder.style.display,
    solidBackground: photoPreview.classList.contains('photo-placeholder'),
  };

  function restoreInitialPreview() {
    if (initialPreview.src) {
      photoImage.src = initialPreview.src;
    } else {
      // Avoid assigning an empty src, which browsers resolve to the current URL.
      photoImage.removeAttribute('src');
    }
    photoImage.style.display = initialPreview.display;
    photoImage.style.objectFit = initialPreview.objectFit;
    photoPlaceholder.style.display = initialPreview.placeholderDisplay;
    photoPreview.classList.remove(
      initialPreview.solidBackground ? 'photo-placeholder-pattern' : 'photo-placeholder'
    );
    photoPreview.classList.add(
      initialPreview.solidBackground ? 'photo-placeholder' : 'photo-placeholder-pattern'
    );
  }

  // Make the preview area clickable
  photoPreview.addEventListener('click', function() {
    photoInput.click();
  });

  // Handle file selection
  photoInput.addEventListener('change', function(event) {
    const file = event.target.files[0];

    if (file && file.size > MAX_PHOTO_SIZE) {
      // Clear the input so the oversize file cannot be submitted, and put the
      // preview back to its load-time state so the user is never looking at an
      // image the form will not send.
      photoInput.value = '';
      restoreInitialPreview();
      setPhotoError(PHOTO_TOO_LARGE_MESSAGE);
      return;
    }

    setPhotoError('');

    if (file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        photoImage.src = e.target.result;
        photoImage.style.display = 'block';
        photoImage.style.objectFit = 'contain';
        photoPlaceholder.style.display = 'none';
        // Switch from pattern to solid background using CSS class
        photoPreview.classList.remove('photo-placeholder-pattern');
        photoPreview.classList.add('photo-placeholder');
      };
      reader.readAsDataURL(file);
    }
  });
});

// REW-52: require Prep Time and Total Time (cookTime) before a recipe can be saved.
document.addEventListener('DOMContentLoaded', function() {
  const recipeForm = document.querySelector('.recipe-form');
  const prepTimeInput = document.getElementById('prepTime');
  const cookTimeInput = document.getElementById('cookTime');

  if (!recipeForm || !prepTimeInput || !cookTimeInput) {
    return; // Not on a recipe create/edit form
  }

  function setFieldError(input, hasError) {
    const group = input.closest('.form-group');
    if (!group) return;

    if (hasError) {
      group.classList.add('has-error');
      input.setAttribute('aria-invalid', 'true');
    } else {
      group.classList.remove('has-error');
      input.setAttribute('aria-invalid', 'false');
    }
  }

  recipeForm.addEventListener('submit', function(event) {
    const fields = [prepTimeInput, cookTimeInput];
    let firstInvalid = null;

    fields.forEach(function(input) {
      const isBlank = !input.value.trim();
      setFieldError(input, isBlank);
      if (isBlank && !firstInvalid) {
        firstInvalid = input;
      }
    });

    if (firstInvalid) {
      event.preventDefault();
      firstInvalid.focus();
    }
  });

  [prepTimeInput, cookTimeInput].forEach(function(input) {
    input.addEventListener('input', function() {
      if (input.value.trim()) {
        setFieldError(input, false);
      }
    });
  });
});
