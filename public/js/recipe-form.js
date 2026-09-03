// Recipe form image preview functionality
document.addEventListener('DOMContentLoaded', function() {
  const photoInput = document.getElementById('photo');
  const photoPreview = document.getElementById('photoPreview');
  const photoImage = document.getElementById('photoImage');
  const photoPlaceholder = document.getElementById('photoPlaceholder');

  if (!photoInput || !photoPreview || !photoImage || !photoPlaceholder) {
    return; // Not on a recipe form page
  }

  // Make the preview area clickable
  photoPreview.addEventListener('click', function() {
    photoInput.click();
  });

  // Handle file selection
  photoInput.addEventListener('change', function(event) {
    const file = event.target.files[0];
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
