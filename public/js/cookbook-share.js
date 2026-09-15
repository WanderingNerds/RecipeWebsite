/**
 * Cookbook share link (REW-19)
 *
 * Copy-to-clipboard for the share URL on the cookbook detail page. Loaded as
 * an external file because the CSP is scriptSrc: ["'self'"] -- no inline
 * handlers, no inline script bodies.
 *
 * The Clipboard API is unavailable outside a secure context (plain http on a
 * non-localhost host) and in older browsers, so there is a select-the-text
 * fallback; the link is always visible and selectable regardless.
 */
document.addEventListener('DOMContentLoaded', function () {
  const panel = document.querySelector('[data-cookbook-share]');
  if (!panel) return;

  const urlInput = panel.querySelector('[data-cookbook-share-url]');
  const copyButton = panel.querySelector('[data-cookbook-share-copy]');
  const feedback = panel.querySelector('[data-cookbook-share-feedback]');
  if (!urlInput || !copyButton) return;

  let resetTimer = null;

  function announce(message) {
    if (!feedback) return;
    feedback.textContent = message;
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(function () {
      feedback.textContent = '';
    }, 3000);
  }

  function selectLink() {
    urlInput.focus();
    urlInput.select();
    if (typeof urlInput.setSelectionRange === 'function') {
      urlInput.setSelectionRange(0, urlInput.value.length);
    }
  }

  copyButton.addEventListener('click', function () {
    const link = urlInput.value;

    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      selectLink();
      announce('Press Ctrl+C (Cmd+C on Mac) to copy.');
      return;
    }

    navigator.clipboard.writeText(link).then(
      function () {
        announce('Link copied.');
      },
      function () {
        selectLink();
        announce('Press Ctrl+C (Cmd+C on Mac) to copy.');
      }
    );
  });
});
