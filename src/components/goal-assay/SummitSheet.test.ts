// src/components/goal-assay/SummitSheet.test.ts
//
// Two kinds of coverage, matching this repo's established split for
// "use client" leafs with imperative DOM behavior (no jsdom in this repo's
// Vitest config — see GoalCompletedCelebration.test.ts's precedent):
//
//   1. `applySkipTap` — the Skip/Close state transition — is a pure function
//      over minimal fake DOM-surface objects (classList.add, textContent,
//      setAttribute, focus, close), so it's tested directly with fakes.
//   2. `SummitSheetContent` — the presentational core holding all the actual
//      ceremony markup — is a plain, non-interactive function component
//      (no hooks), so it's rendered via `react-dom/server`'s
//      `renderToStaticMarkup`, mirroring BetweenGoalsToday.test.ts's
//      established render-smoke pattern. Summit and Marker fixtures cover
//      the "hero never shrinks, evidence scales" floor-case contrast (report
//      §2.2 Rule C) the research explicitly calls out as the real test.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  applySkipTap,
  SummitSheetContent,
  type SkipTapButtonLike,
  type SkipTapDialogLike,
  type SkipTapFocusableLike,
  type SkipTapPanelLike,
  type SummitSheetContentProps,
} from "@/components/goal-assay/SummitSheet";

// ─────────────────────────────────────────────────────────
// applySkipTap
// ─────────────────────────────────────────────────────────

function fakeSkipTapEnv() {
  const classes = new Set<string>();
  const panel: SkipTapPanelLike = { classList: { add: (c: string) => classes.add(c) } };
  const attrs = new Map<string, string>();
  const skipButton: SkipTapButtonLike = {
    textContent: "Skip",
    setAttribute: (name: string, value: string) => attrs.set(name, value),
  };
  const continueButton: SkipTapFocusableLike & { focusCalls: number } = {
    focusCalls: 0,
    focus() {
      this.focusCalls += 1;
    },
  };
  const dialog: SkipTapDialogLike & { closeCalls: number } = {
    closeCalls: 0,
    close() {
      this.closeCalls += 1;
    },
  };
  return { classes, attrs, panel, skipButton, continueButton, dialog };
}

describe("applySkipTap", () => {
  it("tap 1: adds `.landed` to the panel, swaps the SAME button's label Skip -> Close, and focuses Continue", () => {
    const env = fakeSkipTapEnv();

    const tapped = applySkipTap({
      alreadyTapped: false,
      panel: env.panel,
      skipButton: env.skipButton,
      continueButton: env.continueButton,
      dialog: env.dialog,
    });

    expect(tapped).toBe(true);
    expect(env.classes.has("landed")).toBe(true);
    expect(env.skipButton.textContent).toBe("Close"); // same node — label swap via property mutation, not remount
    expect(env.attrs.get("aria-label")).toBe("Close");
    expect(env.continueButton.focusCalls).toBe(1);
    expect(env.dialog.closeCalls).toBe(0); // tap 1 never closes
  });

  it("tap 2 (alreadyTapped=true): does NOT re-land or re-swap the label — just closes the dialog", () => {
    const env = fakeSkipTapEnv();
    env.skipButton.textContent = "Close"; // as left by a prior tap 1

    const tapped = applySkipTap({
      alreadyTapped: true,
      panel: env.panel,
      skipButton: env.skipButton,
      continueButton: env.continueButton,
      dialog: env.dialog,
    });

    expect(tapped).toBe(true);
    expect(env.classes.has("landed")).toBe(false); // this call never touched the panel
    expect(env.skipButton.textContent).toBe("Close"); // unchanged
    expect(env.continueButton.focusCalls).toBe(0); // tap 2 doesn't re-focus
    expect(env.dialog.closeCalls).toBe(1);
  });

  it("a full tap1 -> tap2 sequence lands then closes, using the returned flag to drive the next call", () => {
    const env = fakeSkipTapEnv();
    let tapped = false;

    tapped = applySkipTap({
      alreadyTapped: tapped,
      panel: env.panel,
      skipButton: env.skipButton,
      continueButton: env.continueButton,
      dialog: env.dialog,
    });
    expect(env.classes.has("landed")).toBe(true);
    expect(env.dialog.closeCalls).toBe(0);

    tapped = applySkipTap({
      alreadyTapped: tapped,
      panel: env.panel,
      skipButton: env.skipButton,
      continueButton: env.continueButton,
      dialog: env.dialog,
    });
    expect(env.dialog.closeCalls).toBe(1);
    expect(tapped).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────
// SummitSheetContent render-smoke — Summit + Marker fixtures
// ─────────────────────────────────────────────────────────

const SUMMIT_PROPS: SummitSheetContentProps & { objectiveHeadingId: string } = {
  tier: "summit",
  objective: "Summit Mt. Elbert",
  dateLabel: "SEP 12, 2025",
  statCells: [
    { value: "98", label: "DAYS ELAPSED" },
    { value: "7 of 9", label: "TARGETS MET" },
    { value: "+700", label: "XP AWARDED" },
    { value: "8 → 89", label: "WEIGHTED PROGRESS", caption: "across your targets" },
  ],
  reach: { tier: "legendary", label: "Legendary" },
  badges: [
    { id: "badge-1", name: "First Summit" },
    { id: "badge-2", name: "Body of Proof" },
  ],
  levelBefore: 11,
  levelAfter: 14,
  goalId: "goal-elbert",
  objectiveHeadingId: "objective-heading-summit",
};

const MARKER_PROPS: SummitSheetContentProps & { objectiveHeadingId: string } = {
  tier: "marker",
  objective: "Rebuild the morning routine",
  dateLabel: "MAR 03, 2026",
  statCells: [
    { value: "14", label: "DAYS ELAPSED" },
    { value: "+150", label: "XP AWARDED" },
  ],
  emptyTargetsHint: "No targets were set on this goal.",
  reach: null, // unrated -> omit the Reach row entirely, never a visible-zero meter
  badges: [{ id: "badge-1", name: "First Summit" }],
  levelBefore: 6,
  levelAfter: 7,
  goalId: "goal-marker",
  objectiveHeadingId: "objective-heading-marker",
};

describe("SummitSheetContent — Summit tier fixture", () => {
  it("renders the objective, all 4 stat cells, Reach, both badges, and the level-crossing line", () => {
    const html = renderToStaticMarkup(createElement(SummitSheetContent, SUMMIT_PROPS));

    expect(html).toContain("Summit Mt. Elbert");
    expect(html).toContain("SEP 12, 2025");
    expect(html).toContain('id="objective-heading-summit"');

    // Hero never shrinks — the fixed geometry token, not a tier-branched size.
    expect(html).toContain("var(--assay-hero-size)");

    // All 4 stat cells present, real text (not aria-hidden).
    expect(html).toContain("98");
    expect(html).toContain("DAYS ELAPSED");
    expect(html).toContain("7 of 9");
    expect(html).toContain("TARGETS MET");
    expect(html).toContain("+700");
    expect(html).toContain("XP AWARDED");
    expect(html).toContain("8 → 89");
    expect(html).toContain("WEIGHTED PROGRESS");
    expect(html).toContain("across your targets");

    // No zero-target hint on a goal that had targets.
    expect(html).not.toContain("No targets were set");

    // Reach row (rendered via ReachMeter, role=img + aria-label carries the
    // real text — see ReachMeter.tsx).
    expect(html).toContain("Reach: Legendary");

    // Badges — both rendered, monogrammed, real names as text.
    expect(html).toContain("First Summit");
    expect(html).toContain("Body of Proof");

    // Level crossing (11 !== 14 -> shown).
    expect(html).toContain("Level 11");
    expect(html).toContain("14");

    // No live regions anywhere in the ceremony content (report §8.2).
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain('role="status"');
  });
});

describe("SummitSheetContent — Marker floor-case fixture", () => {
  it("renders the SAME 224px hero, but only 2 stat cells + the honest zero-target sentence, no Reach row", () => {
    const html = renderToStaticMarkup(createElement(SummitSheetContent, MARKER_PROPS));

    expect(html).toContain("Rebuild the morning routine");
    expect(html).toContain("MAR 03, 2026");

    // Hero geometry is IDENTICAL to the Summit fixture — nothing scales down
    // (report §2.2 Rule C: "the hero never shrinks; the evidence scales").
    expect(html).toContain("var(--assay-hero-size)");

    // Only 2 cells — no "targets met" / "weighted progress" cells invented
    // for a goal that had none.
    expect(html).toContain("14");
    expect(html).toContain("DAYS ELAPSED");
    expect(html).toContain("+150");
    expect(html).toContain("XP AWARDED");
    expect(html).not.toContain("TARGETS MET");
    expect(html).not.toContain("WEIGHTED PROGRESS");

    // The honest zero-target sentence renders instead of an invented cell.
    expect(html).toContain("No targets were set on this goal.");

    // Reach omitted entirely (unrated) — never an empty/visible-zero meter.
    expect(html).not.toContain("Reach:");
    expect(html).not.toContain("data-testid=\"summit-sheet-reach\"");

    // The one real badge still renders.
    expect(html).toContain("First Summit");

    // Level crossing (6 !== 7 -> shown even on the floor case).
    expect(html).toContain("Level 6");
  });

  it("omits the level-crossing line when levelBefore === levelAfter (PRD §6 edge case)", () => {
    const html = renderToStaticMarkup(
      createElement(SummitSheetContent, { ...MARKER_PROPS, levelBefore: 6, levelAfter: 6 }),
    );
    expect(html).not.toContain("Level 6 →");
  });

  it("omits the badges block entirely when there are no badges (PRD §6 edge case)", () => {
    const html = renderToStaticMarkup(createElement(SummitSheetContent, { ...MARKER_PROPS, badges: [] }));
    expect(html).not.toContain('data-testid="summit-sheet-badges"');
  });
});
