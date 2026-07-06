import { describe, it, expect } from "vitest";
import { isPublicPath } from "./route-access";

/**
 * Table-driven tests for the isPublicPath() route-access helper.
 *
 * Public paths → true  (middleware passes without cookie check)
 * Protected paths → false (middleware enforces session cookie)
 */

const PUBLIC_CASES: [string, string][] = [
  // Auth pages
  ["/signin", "sign-in page"],
  ["/request-access", "request-access page"],

  // Auth.js handler sub-paths
  ["/api/auth/callback/google", "Google OAuth callback"],
  ["/api/auth/providers", "providers endpoint"],
  ["/api/auth/session", "session endpoint"],
  ["/api/auth/csrf", "CSRF endpoint"],
  ["/api/auth/signout", "signout endpoint"],

  // MCP — exact and with sub-paths
  ["/api/mcp", "MCP root (exact)"],
  ["/api/mcp/tools", "MCP sub-path"],
  ["/api/mcp/some/deep/path", "MCP deep sub-path"],

  // Render-job peek
  ["/api/render-jobs/peek", "render-jobs peek"],

  // OAuth server (future C-1)
  ["/oauth/token", "OAuth token endpoint"],
  ["/oauth/authorize", "OAuth authorize endpoint"],

  // Well-known discovery (future C-1)
  ["/.well-known/oauth-authorization-server", "OAuth AS discovery"],
  ["/.well-known/openid-configuration", "OIDC discovery"],
];

const PROTECTED_CASES: [string, string][] = [
  // Dashboard and app pages
  ["/", "root / dashboard"],
  ["/history", "history page"],
  ["/goals/abc", "goal detail page"],
  ["/today", "today page"],
  ["/nutrition", "nutrition page"],
  ["/workout/new", "new workout page"],

  // Tricky prefix-safety checks
  ["/signinX", "does NOT match /signin (prefix safety)"],
  ["/signin-extra", "does NOT match /signin with dash"],
  ["/request-accessX", "does NOT match /request-access (prefix safety)"],

  // Tricky API prefix-safety checks
  ["/api/mcpx", "does NOT match /api/mcp (prefix safety)"],
  ["/api/mcp-other", "does NOT match /api/mcp with dash"],
  ["/api/auth", "does NOT match /api/auth/ without trailing slash"],
  ["/api/render-jobs/peekX", "does NOT match /api/render-jobs/peek with suffix"],
  ["/api/render-jobs", "does NOT match /api/render-jobs (peek sub-path only)"],

  // Other API routes that ARE protected
  ["/api/goals", "goals API"],
  ["/api/workouts", "workouts API"],
];

describe("isPublicPath()", () => {
  describe("public paths → true", () => {
    it.each(PUBLIC_CASES)("%s (%s)", (pathname) => {
      expect(isPublicPath(pathname)).toBe(true);
    });
  });

  describe("protected paths → false", () => {
    it.each(PROTECTED_CASES)("%s (%s)", (pathname) => {
      expect(isPublicPath(pathname)).toBe(false);
    });
  });
});
