/**
 * Guard against open-redirect attacks.
 * Only honor same-origin relative paths (start with "/" but not "//").
 * Exported separately from auth-actions.ts because "use server" modules
 * require all exports to be async functions.
 */
export function safeNext(next?: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return "/";
}
