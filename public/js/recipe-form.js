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
