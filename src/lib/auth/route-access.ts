/**
 * Route-access helper — pure, edge-safe, unit-testable.
 *
 * isPublicPath(pathname) returns true when the path must NEVER be redirected
 * to /signin, regardless of cookie presence.
 *
 * Belt-and-suspenders role: this is the CORRECTNESS layer.
 * The middleware matcher config is the PERFORMANCE layer (skips static files
 * entirely so the function is never called for them), but isPublicPath is the
 * final gatekeeper on every path that does reach the middleware.
 *
 * Public surfaces:
 *   - /signin, /request-access            – auth UI (unauthenticated flows)
 *   - /api/auth/*                          – Auth.js handler (sign-in, callback, …)
 *   - /api/mcp, /api/mcp/*                – bearer-token gated MCP endpoint
 *   - /api/render-jobs/peek               – worker-token gated peek endpoint
 *   - /oauth/*                            – future C-1 OAuth server endpoints
 *   - /.well-known/*                      – future C-1 OAuth discovery endpoints
 */
export function isPublicPath(pathname: string): boolean {
  // Auth pages
  if (pathname === "/signin") return true;
  if (pathname === "/request-access") return true;

  // Auth.js handler — all sub-paths (sign-in, callback, session, providers, …)
  if (pathname.startsWith("/api/auth/")) return true;

  // MCP endpoint — exact match AND sub-paths
  if (pathname === "/api/mcp") return true;
  if (pathname.startsWith("/api/mcp/")) return true;

  // Render-job worker peek
  if (pathname === "/api/render-jobs/peek") return true;

  // Future C-1 OAuth server (include now per PRD)
  if (pathname.startsWith("/oauth/")) return true;

  // Future C-1 OAuth discovery (include now per PRD)
  if (pathname.startsWith("/.well-known/")) return true;

  return false;
}
