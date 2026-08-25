// BottomSheet — the nested-sheet close cascade (founder-reported 2026-08-25).
//
// Symptom: adding a saved meal ("recipe") to the composer closed the whole Log
// sheet. Cause: `close` and `cancel` do NOT bubble in the DOM, but React
// dispatches them up the REACT tree, and createPortal keeps a portal's
// React-tree ancestry no matter where it lands in the DOM. Every nested sheet
// (saved-meal, scan, library picker, meal-edit) is portaled to document.body
// yet is still a React descendant of the Log sheet's <dialog> — so React
// delivered the INNER dialog's close event straight into the OUTER sheet's
// onClose. (React skips ancestor accumulation only for `scroll`/`scrollend`;
// see accumulateTargetOnly in react-dom-client.) The un-guarded onCancel was
// worse still: the outer handler's preventDefault() fired against the inner
// dialog's own Esc.
//
// Source-level assertions: the sheets render null on the server (two-phase
// portal mount), so no markup test can reach these handlers.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const DIALOG_COMPONENTS = [
  "./BottomSheet.tsx",
  "./ScanFoodSheet.tsx",
  "./LibraryPickerOverlay.tsx",
] as const;

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

describe("portaled dialogs — close/cancel target guard", () => {
  for (const rel of DIALOG_COMPONENTS) {
    const src = read(rel);

    it(`${rel} guards onClose against a nested sheet's close event`, () => {
      const handler = src.slice(src.indexOf("onClose={("));
      expect(handler).toContain("onClose={(");
      // The handler body must bail before calling onClose() when the event came
      // from a descendant dialog.
      const guard = handler.indexOf("e.target !== e.currentTarget");
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(handler.indexOf("onClose();"));
    });

    it(`${rel} guards onCancel (Esc) the same way, before preventDefault`, () => {
      const handler = src.slice(src.indexOf("onCancel={("));
      const guard = handler.indexOf("e.target !== e.currentTarget");
      expect(guard).toBeGreaterThan(-1);
      // preventDefault must NOT run for a descendant's cancel — it would cancel
      // the inner dialog's own close.
      expect(guard).toBeLessThan(handler.indexOf("e.preventDefault()"));
    });

    it(`${rel} never passes onClose straight through unguarded`, () => {
      expect(src).not.toMatch(/onClose=\{onClose\}/);
    });

    it(`${rel} locks page scroll through the shared refcounted lock`, () => {
      expect(src).toContain('from "@/lib/body-scroll-lock"');
      expect(src).toContain("return lockBodyScroll();");
      // No hand-rolled lock: nested sheets must not unlock each other's page.
      expect(src).not.toContain("document.body.style.overflow");
    });
  }
});
