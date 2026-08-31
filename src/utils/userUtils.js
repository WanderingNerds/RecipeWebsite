/**
 * Shared helpers for deriving user-facing display information from a
 * Supabase auth user object.
 */

/**
 * Get the display name to use for a logged-in account.
 *
 * Prefers the account's registered display name (`user_metadata.name`),
 * falling back to the account's email address if no name is set (or the
 * name is only whitespace). Returns `null` if neither is available.
 *
 * @param {object|null|undefined} user - A Supabase auth user object (e.g. `req.user`).
 * @returns {string|null} The account display name, or `null` if unavailable.
 */
export function getAccountDisplayName(user) {
  const name = user?.user_metadata?.name;

  if (typeof name === "string" && name.trim()) {
    return name.trim();
  }

  return user?.email || null;
}
