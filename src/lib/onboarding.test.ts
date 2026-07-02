/**
 * Unit tests for D-1 onboarding: redirectTo whitelist + kind passthrough logic.
 *
 * These verify the exact FormData-parsing and validation logic in createGoal
 * without exercising the DB or server-action plumbing.
 */
import { describe, it, expect } from "vitest";

// ── Inline replicas of the exact guard logic from goal-actions.ts ─────────────
// These must stay in sync with the production code.

function resolveRedirectTo(raw: FormDataEntryValue | null): string | null {
  const SAFE_REDIRECTS = new Set(["/", "/goals", "/onboarding/connect"]);
  return typeof raw === "string" && SAFE_REDIRECTS.has(raw) ? raw : null;
}

function resolveKind(raw: FormDataEntryValue | null): "fitness" | "project" {
  return raw === "project" ? "project" : "fitness";
}

// ── redirectTo whitelist ──────────────────────────────────────────────────────

describe("redirectTo whitelist", () => {
  it('accepts "/"', () => {
    expect(resolveRedirectTo("/")).toBe("/");
  });

  it('accepts "/goals"', () => {
    expect(resolveRedirectTo("/goals")).toBe("/goals");
  });

  it("rejects null (absent field)", () => {
    expect(resolveRedirectTo(null)).toBeNull();
  });

  it("rejects empty string", () => {
    expect(resolveRedirectTo("")).toBeNull();
  });

  it('rejects "//" (protocol-relative)', () => {
    expect(resolveRedirectTo("//evil.com")).toBeNull();
  });

  it('rejects "http://evil.com"', () => {
    expect(resolveRedirectTo("http://evil.com")).toBeNull();
  });

  it('rejects "/\\evil.com" (backslash bypass)', () => {
    expect(resolveRedirectTo("/\\evil.com")).toBeNull();
  });

  it('rejects "/%2Fevil.com" (percent-encoded bypass)', () => {
    expect(resolveRedirectTo("/%2Fevil.com")).toBeNull();
  });

  it('rejects an arbitrary path like "/onboarding"', () => {
    // Only "/", "/goals", and "/onboarding/connect" are allowed — not arbitrary paths
    expect(resolveRedirectTo("/onboarding")).toBeNull();
  });

  it('accepts "/onboarding/connect" (D-2 step-2 route)', () => {
    expect(resolveRedirectTo("/onboarding/connect")).toBe("/onboarding/connect");
  });

  it('rejects "/onboarding/connect/evil" (exact-match only — no startsWith)', () => {
    expect(resolveRedirectTo("/onboarding/connect/evil")).toBeNull();
  });

  it('rejects "/onboarding/connectX" (exact-match only)', () => {
    expect(resolveRedirectTo("/onboarding/connectX")).toBeNull();
  });
});

// ── kind passthrough ──────────────────────────────────────────────────────────

describe("kind passthrough", () => {
  it('resolves "project" when form field is "project"', () => {
    expect(resolveKind("project")).toBe("project");
  });

  it('defaults to "fitness" when field is absent (null)', () => {
    expect(resolveKind(null)).toBe("fitness");
  });

  it('defaults to "fitness" when field is empty string', () => {
    expect(resolveKind("")).toBe("fitness");
  });

  it('defaults to "fitness" for unrecognized values', () => {
    expect(resolveKind("hike")).toBe("fitness");
    expect(resolveKind("PROJECT")).toBe("fitness"); // case-sensitive
  });

  it('resolves "fitness" when field is explicitly "fitness"', () => {
    expect(resolveKind("fitness")).toBe("fitness");
  });
});
