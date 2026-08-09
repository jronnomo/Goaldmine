// src/components/goal-assay/GoalAssayHero.tsx
//
// Server component — the permanent "Assay" hero (PRD 3.1.2, report §2.1
// items 1-2): the `GOAL COMPLETE` eyebrow + a filled Bullseye nested in the
// closed gold annulus, per the globals.css assay class contract
// (src/app/globals.css:517-647, esp. the ".assay-annulus" primitive at
// :747-760). Zero client JS of its own beyond the AssayFlourish leaf it
// mounts — the flying ring and any first-view choreography are entirely
// AssayFlourish's job (see that file's header for the full playFlourish
// contract), mounted here as a child of the SAME position:relative hero
// wrapper the annulus lives in, per the CSS contract's own note: ".assay-ring
// ... inside the same relative hero wrapper as .assay-annulus."
//
// Rule A ("static IS final", globals.css:531-540): every element here is
// authored in its FINISHED look. `.assay-annulus` is the ONE "assay-*"
// primitive class this file bakes into server HTML unconditionally — it is
// the PERMANENT ring (must render correctly on literally every view,
// flourish or not), and its own resting/base CSS already equals its
// keyframe's 100% state, so including it from the very first paint is safe:
// at worst it replays a subtle, harmless ~300ms pop-in on every fresh page
// load (Rule A guarantees the settled look is identical either way). Every
// OTHER "beat" primitive (assay-fade/rise/disc-rim/disc-inner/ring) is
// deliberately absent from this SSR output — see AssayFlourish.tsx's header
// comment for why, and for the `data-assay` seam the controller drives
// instead.
//
// aria: the eyebrow is real text (not hidden). Bullseye and the annulus div
// are both aria-hidden — decorative glyphs, per report §8.2 ("Every
// animated glyph ... is aria-hidden. The text is not.").
//
// testIDs: goal-assay-hero (wrapper) · goal-assay-annulus (annulus div).

import { Bullseye } from "@/components/Bullseye";
import { AssayFlourish } from "@/components/goal-assay/AssayFlourish";

/** ⚠ 200-240px per report §9 item 2 — matches globals.css's --assay-hero-size
 *  default (224px). Bullseye takes a plain numeric `size` prop (no CSS-var
 *  passthrough), so this constant is the single source of truth to keep the
 *  glyph and its CSS-derived annulus geometry in lockstep; if
 *  --assay-hero-size is ever retuned in globals.css, retune this too. */
const HERO_SIZE = 224;

export function GoalAssayHero() {
  return (
    <div className="flex flex-col items-center gap-4">
      <p
        className="text-xs font-bold uppercase"
        style={{ color: "var(--accent)", letterSpacing: "0.09em", background: "var(--background)" }}
      >
        GOAL COMPLETE
      </p>

      <div
        data-testid="goal-assay-hero"
        className="relative"
        style={{ width: HERO_SIZE, height: HERO_SIZE }}
      >
        <Bullseye size={HERO_SIZE} filled aria-hidden />
        <div
          data-testid="goal-assay-annulus"
          data-assay="annulus"
          className="assay-annulus"
          aria-hidden
        />
        <AssayFlourish />
      </div>
    </div>
  );
}
