// Hamburger navigation toggle for the mobile header.
// - Toggles the collapsible menu on hamburger click.
// - Closes the menu on: repeat hamburger tap, nav-link click, outside click/tap.
// - Keeps aria-hidden in sync with both the open state and the current breakpoint,
//   since the menu is always visible (not collapsible) on desktop widths.
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('navbar-toggle');
  const menu = document.getElementById('navbar-menu');

  if (!toggle || !menu) return;

  // Must match the navbar breakpoint in styles.css (max-width: 768px).
  const desktopQuery = window.matchMedia('(min-width: 769px)');

  function isOpen() {
    return menu.classList.contains('is-open');
  }

  function syncAriaHidden() {
    // On desktop the menu is always visible, so it should never be hidden from
    // assistive tech regardless of the (irrelevant) open/closed toggle state.
    menu.setAttribute('aria-hidden', desktopQuery.matches ? 'false' : String(!isOpen()));
  }

  function setOpen(nextOpen) {
    menu.classList.toggle('is-open', nextOpen);
    toggle.setAttribute('aria-expanded', String(nextOpen));
    syncAriaHidden();
  }

  function closeMenu() {
    if (isOpen()) {
      setOpen(false);
    }
  }

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(!isOpen());
  });

  // Close when a nav link inside the menu is selected.
  menu.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      closeMenu();
    }
  });

  // Close on outside click/tap.
  document.addEventListener('click', (event) => {
    if (!isOpen()) return;
    if (menu.contains(event.target) || toggle.contains(event.target)) return;
    closeMenu();
  });

  // Close on Escape for keyboard users, returning focus to the toggle.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      closeMenu();
      toggle.focus();
    }
  });

  // Reset state when crossing the desktop/mobile breakpoint (e.g. rotating a
  // tablet) so the menu doesn't get stuck open/closed in the wrong mode.
  function handleBreakpointChange() {
    closeMenu();
    syncAriaHidden();
  }

  if (typeof desktopQuery.addEventListener === 'function') {
    desktopQuery.addEventListener('change', handleBreakpointChange);
  } else if (typeof desktopQuery.addListener === 'function') {
    // Safari < 14 fallback.
    desktopQuery.addListener(handleBreakpointChange);
  }

  syncAriaHidden();
});
