// src/lib/day-save-error-copy.test.ts
//
// Coverage for the Day Override editor's save-error banner rewrite
// (#235 iter2, UXR-235-09). The server-thrown baseline-guard message
// (assertBaselineDecisionMade, day-template-validation.ts) is deliberately
// kept identical to the MCP tool path's own message — so this module's job
// is purely a UI-layer rewrite, never a change to what the server throws.

import { describe, it, expect } from "vitest";
import { formatSaveErrorBanner } from "@/lib/day-save-error-copy";

describe("formatSaveErrorBanner", () => {
  it("rewrites the baseline-guard throw into coach-voiced copy with the rotation names interpolated", () => {
    const raw =
      "Audible on 2026-01-05 touches the workout but didn't make a baseline decision. " +
      "Rotation default for this date: [Pull-Up Max Reps]. " +
      "Re-pass baselineTestNames explicitly: same list to keep them, [] to suppress, or a different set to swap. " +
      "Don't punt this to the UI — own the call.";
    const banner = formatSaveErrorBanner(raw);
    expect(banner.headline).toBe("Baseline check needed.");
    expect(banner.body).toContain("a baseline test (Pull-Up Max Reps)");
    expect(banner.body).not.toContain("Don't punt this to the UI");
    expect(banner.hint).toBe("Fine-grained control lives in Advanced JSON, or ask your coach in chat.");
  });

  it("interpolates multiple rotation names verbatim", () => {
    const raw =
      "Audible on 2026-01-05 touches the workout but didn't make a baseline decision. " +
      "Rotation default for this date: [Pull-Up Max Reps, Bike 5k Time]. " +
      "Re-pass baselineTestNames explicitly.";
    const banner = formatSaveErrorBanner(raw);
    expect(banner.body).toContain("a baseline test (Pull-Up Max Reps, Bike 5k Time)");
  });

  it("falls back to a generic subject when the rotation-names bracket is missing (defensive, message drifted)", () => {
    const raw = "touches the workout but didn't make a baseline decision.";
    const banner = formatSaveErrorBanner(raw);
    expect(banner.headline).toBe("Baseline check needed.");
    expect(banner.body).toContain("a baseline test.");
  });

  it("passes any non-guard error through verbatim, with no headline/hint", () => {
    const raw = "Invalid workout JSON: Unexpected token } in JSON at position 42";
    const banner = formatSaveErrorBanner(raw);
    expect(banner.body).toBe(raw);
    expect(banner.headline).toBeUndefined();
    expect(banner.hint).toBeUndefined();
  });

  it("passes the generic 'No active plan' error through verbatim", () => {
    const banner = formatSaveErrorBanner("No active plan");
    expect(banner.body).toBe("No active plan");
    expect(banner.headline).toBeUndefined();
  });

  it("the rewritten copy fits the UX report's ≤3-line-at-390px budget (rough proxy: total length)", () => {
    const raw =
      "Audible on 2026-01-05 touches the workout but didn't make a baseline decision. " +
      "Rotation default for this date: [Pull-Up Max Reps]. " +
      "Re-pass baselineTestNames explicitly: same list to keep them, [] to suppress, or a different set to swap. " +
      "Don't punt this to the UI — own the call.";
    const banner = formatSaveErrorBanner(raw);
    // ~45 chars/line at text-sm/390px * 3 lines ≈ 135; headline+body is the
    // primary paragraph (hint is a separate, shorter second line).
    expect((banner.headline?.length ?? 0) + banner.body.length).toBeLessThan(230);
  });
});
