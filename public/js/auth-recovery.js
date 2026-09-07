// public/js/auth-recovery.js
//
// Implicit-flow auth fragment handling (REW-57).
//
// Supabase's default email templates (and any misconfigured redirect_to)
// deliver the session as a URL hash fragment --
// "#access_token=...&refresh_token=...&type=recovery" -- instead of a query
// string. Fragments are never sent to the server, so this script:
//   1. Reads window.location.hash client-side.
//   2. Strips it from the address bar/history immediately via
//      history.replaceState (fragments are visible in browser history and
//      to any script on the page, so they must not linger).
//   3. Either forwards a reported error to the server-rendered error state,
//      or POSTs the tokens to the fragment-to-cookie bridge
//      (POST /auth/reset-password/session) so they become httpOnly cookies.
//
// This script is loaded on every page (a misdirected link can land on
// Home, not just /auth/reset-password) but only ever acts when the hash
// contains a recognised auth payload. It must never interfere with
// unrelated uses of the URL (e.g. public/js/main.js's history.replaceState
// for recipe-page instant scaling, which only touches the query string,
// never the hash).
(function () {
  "use strict";

  // error_code is only ever used to look up fixed copy server-side
  // (getRecoveryErrorMessage); constrain it to a safe character class here
  // too so nothing resembling a URL/HTML payload ever reaches the address
  // bar or server logs.
  var SAFE_CODE_PATTERN = /^[a-z_]+$/;
  var DEFAULT_ERROR_CODE = "invalid_link";

  function isOnCheckingState() {
    return document.getElementById("auth-recovery-checking") !== null;
  }

  function dropFragment() {
    var url = window.location.pathname + window.location.search;
    window.history.replaceState({}, document.title, url);
  }

  function goToErrorState(code) {
    var safeCode = typeof code === "string" && SAFE_CODE_PATTERN.test(code) ? code : DEFAULT_ERROR_CODE;
    // Fixed internal path only -- never derived from user/URL input.
    window.location.assign("/auth/reset-password?error_code=" + encodeURIComponent(safeCode));
  }

  function postToBridge(accessToken, refreshToken) {
    fetch("/auth/reset-password/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        type: "recovery",
        _csrf: "",
      }),
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            return { data: data };
          });
      })
      .then(function (result) {
        // Only ever navigate to a same-origin path returned by our own
        // server response -- never to anything derived from the URL/hash.
        var redirect =
          result.data && typeof result.data.redirect === "string"
            ? result.data.redirect
            : "/auth/reset-password?error_code=" + DEFAULT_ERROR_CODE;
        window.location.assign(redirect);
      })
      .catch(function () {
        goToErrorState(DEFAULT_ERROR_CODE);
      });
  }

  function handleAuthFragment() {
    var hash = window.location.hash;

    if (!hash || hash === "#") {
      // No fragment to read. If we're stuck on the "checking" screen with
      // nothing to verify, there's no way this link will ever resolve --
      // send the user to the error state instead of leaving them waiting.
      if (isOnCheckingState()) {
        goToErrorState(DEFAULT_ERROR_CODE);
      }
      return;
    }

    var params = new URLSearchParams(hash.slice(1));
    var errorCode = params.get("error_code") || params.get("error");
    var type = params.get("type");
    var accessToken = params.get("access_token");
    var refreshToken = params.get("refresh_token");

    if (errorCode) {
      dropFragment();
      goToErrorState(errorCode);
      return;
    }

    if (type === "recovery" && accessToken && refreshToken) {
      dropFragment();
      postToBridge(accessToken, refreshToken);
      return;
    }

    // Any other fragment (type=signup, an unrelated in-page anchor, etc.)
    // is left alone -- out of scope for this bridge.
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", handleAuthFragment);
  } else {
    handleAuthFragment();
  }
})();
