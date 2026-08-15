/**
 * Tags Input Component
 * Interactive tag input with add/remove functionality and autocomplete
 */
document.addEventListener('DOMContentLoaded', function() {
  const tagsContainer = document.querySelector('.tags-input-container');
  if (!tagsContainer) return;

  const tagsInput = tagsContainer.querySelector('.tags-input');
  const tagsHiddenInput = tagsContainer.querySelector('.tags-hidden-input');
  const tagsList = tagsContainer.querySelector('.tags-list');
  const suggestionsContainer = tagsContainer.querySelector('.tags-suggestions');

  // Get existing tags for autocomplete from data attribute
  let existingTags = [];
  try {
    existingTags = JSON.parse(tagsContainer.dataset.existingTags || '[]');
  } catch (e) {
    console.error('Error parsing existing tags:', e);
  }

  // Get pre-selected tags
  let selectedTags = [];
  try {
    selectedTags = JSON.parse(tagsContainer.dataset.selectedTags || '[]');
  } catch (e) {
    console.error('Error parsing selected tags:', e);
  }

  // Initialize with pre-selected tags
  selectedTags.forEach(tagName => {
    if (tagName && tagName.trim()) {
      addTagChip(tagName.trim());
    }
  });

  // Update hidden input
  updateHiddenInput();

  // Handle input
  tagsInput.addEventListener('input', function(e) {
    const value = e.target.value;

    // Check for comma to add tag
    if (value.includes(',')) {
      const parts = value.split(',');
      parts.forEach((part, index) => {
        const trimmed = part.trim();
        if (trimmed && index < parts.length - 1) {
          addTag(trimmed);
        }
      });
      // Keep the last part in input (after the last comma)
      tagsInput.value = parts[parts.length - 1].trim();
    }

    // Show suggestions
    showSuggestions(value.replace(',', '').trim());
  });

  // Handle enter and backspace
  tagsInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = tagsInput.value.trim();
      if (value) {
        addTag(value);
        tagsInput.value = '';
        hideSuggestions();
      }
    } else if (e.key === 'Backspace' && !tagsInput.value) {
      // Remove last tag
      const chips = tagsList.querySelectorAll('.tag-chip');
      if (chips.length > 0) {
        const lastChip = chips[chips.length - 1];
        removeTag(lastChip.dataset.tag);
      }
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });

  // Handle blur - add tag if there's text
  tagsInput.addEventListener('blur', function() {
    const value = tagsInput.value.trim();
    if (value) {
      addTag(value);
      tagsInput.value = '';
    }
    // Delay hiding to allow clicking suggestions
    setTimeout(hideSuggestions, 200);
  });

  // Focus input when clicking container
  tagsContainer.addEventListener('click', function(e) {
    if (e.target === tagsContainer || e.target === tagsList) {
      tagsInput.focus();
    }
  });

  function addTag(name) {
    const normalizedName = name.trim();
    if (!normalizedName) return;

    // Check if tag already exists
    const existingChips = tagsList.querySelectorAll('.tag-chip');
    for (const chip of existingChips) {
      if (chip.dataset.tag.toLowerCase() === normalizedName.toLowerCase()) {
        return; // Don't add duplicate
      }
    }

    addTagChip(normalizedName);
    updateHiddenInput();
  }

  function addTagChip(name) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.dataset.tag = name;
    chip.innerHTML = `
      <span class="tag-chip-text">${escapeHtml(name)}</span>
      <button type="button" class="tag-chip-remove" aria-label="Remove tag">&times;</button>
    `;

    // Handle remove button
    chip.querySelector('.tag-chip-remove').addEventListener('click', function(e) {
      e.stopPropagation();
      removeTag(name);
    });

    tagsList.appendChild(chip);
  }

  function removeTag(name) {
    const chips = tagsList.querySelectorAll('.tag-chip');
    chips.forEach(chip => {
      if (chip.dataset.tag === name) {
        chip.remove();
      }
    });
    updateHiddenInput();
  }

  function updateHiddenInput() {
    const chips = tagsList.querySelectorAll('.tag-chip');
    const tags = Array.from(chips).map(chip => chip.dataset.tag);
    tagsHiddenInput.value = tags.join(',');
  }

  function showSuggestions(query) {
    if (!query || query.length < 1) {
      hideSuggestions();
      return;
    }

    const lowerQuery = query.toLowerCase();
    const currentTags = Array.from(tagsList.querySelectorAll('.tag-chip')).map(c => c.dataset.tag.toLowerCase());

    const matches = existingTags.filter(tag =>
      tag.name.toLowerCase().includes(lowerQuery) &&
      !currentTags.includes(tag.name.toLowerCase())
    ).slice(0, 5); // Limit to 5 suggestions

    if (matches.length === 0) {
      hideSuggestions();
      return;
    }

    suggestionsContainer.innerHTML = '';
    matches.forEach(tag => {
      const item = document.createElement('div');
      item.className = 'tags-suggestion-item';
      item.textContent = tag.name;
      item.addEventListener('mousedown', function(e) {
        e.preventDefault();
        addTag(tag.name);
        tagsInput.value = '';
        hideSuggestions();
        tagsInput.focus();
      });
      suggestionsContainer.appendChild(item);
    });
    suggestionsContainer.style.display = 'block';
  }

  function hideSuggestions() {
    suggestionsContainer.style.display = 'none';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});

/**
 * Filter Tags Input Component (for recipe index page)
 */
document.addEventListener('DOMContentLoaded', function() {
  const filterTagsContainer = document.querySelector('.filter-tags-container');
  if (!filterTagsContainer) return;

  const filterForm = filterTagsContainer.closest('form');
  const tagsInput = filterTagsContainer.querySelector('.filter-tags-input');
  const tagsHiddenInput = filterTagsContainer.querySelector('.filter-tags-hidden');
  const tagsList = filterTagsContainer.querySelector('.filter-tags-list');
  const suggestionsContainer = filterTagsContainer.querySelector('.filter-tags-suggestions');

  // Get existing tags for autocomplete
  let existingTags = [];
  try {
    existingTags = JSON.parse(filterTagsContainer.dataset.existingTags || '[]');
  } catch (e) {
    console.error('Error parsing existing tags:', e);
  }

  // Get pre-selected tags (from URL)
  const selectedTagSlugs = (tagsHiddenInput.value || '').split(',').filter(t => t.trim());
  selectedTagSlugs.forEach(slug => {
    const tag = existingTags.find(t => t.slug === slug);
    if (tag) {
      addFilterTagChip(tag.name, tag.slug);
    }
  });

  // Handle input
  tagsInput.addEventListener('input', function(e) {
    showFilterSuggestions(e.target.value.trim());
  });

  tagsInput.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      hideFilterSuggestions();
    }
  });

  tagsInput.addEventListener('blur', function() {
    setTimeout(hideFilterSuggestions, 200);
  });

  tagsInput.addEventListener('focus', function() {
    if (tagsInput.value.trim()) {
      showFilterSuggestions(tagsInput.value.trim());
    }
  });

  function addFilterTagChip(name, slug) {
    // Check for duplicates
    const existing = tagsList.querySelectorAll('.filter-tag-chip');
    for (const chip of existing) {
      if (chip.dataset.slug === slug) return;
    }

    const chip = document.createElement('span');
    chip.className = 'filter-tag-chip';
    chip.dataset.slug = slug;
    chip.dataset.name = name;
    chip.innerHTML = `
      <span class="filter-tag-text">${escapeHtml(name)}</span>
      <button type="button" class="filter-tag-remove">&times;</button>
    `;

    chip.querySelector('.filter-tag-remove').addEventListener('click', function(e) {
      e.stopPropagation();
      chip.remove();
      updateFilterHiddenInput();
      if (filterForm) filterForm.submit();
    });

    tagsList.appendChild(chip);
    updateFilterHiddenInput();
  }

  function updateFilterHiddenInput() {
    const chips = tagsList.querySelectorAll('.filter-tag-chip');
    const slugs = Array.from(chips).map(chip => chip.dataset.slug);
    tagsHiddenInput.value = slugs.join(',');
  }

  function showFilterSuggestions(query) {
    if (!query || query.length < 1) {
      hideFilterSuggestions();
      return;
    }

    const lowerQuery = query.toLowerCase();
    const currentSlugs = Array.from(tagsList.querySelectorAll('.filter-tag-chip')).map(c => c.dataset.slug);

    const matches = existingTags.filter(tag =>
      tag.name.toLowerCase().includes(lowerQuery) &&
      !currentSlugs.includes(tag.slug)
    ).slice(0, 5);

    if (matches.length === 0) {
      hideFilterSuggestions();
      return;
    }

    suggestionsContainer.innerHTML = '';
    matches.forEach(tag => {
      const item = document.createElement('div');
      item.className = 'filter-tags-suggestion-item';
      item.textContent = tag.name;
      item.addEventListener('mousedown', function(e) {
        e.preventDefault();
        addFilterTagChip(tag.name, tag.slug);
        tagsInput.value = '';
        hideFilterSuggestions();
        if (filterForm) filterForm.submit();
      });
      suggestionsContainer.appendChild(item);
    });
    suggestionsContainer.style.display = 'block';
  }

  function hideFilterSuggestions() {
    suggestionsContainer.style.display = 'none';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
