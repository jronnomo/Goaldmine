// src/components/goal-assay/AssayFlourish.tsx
//
// ════════════════════════════════════════════════════════════════════════
// THE FLOURISH LEAF CONTRACT (verbatim — read this before wiring the
// ceremony controller, REQ-004/architecture-v2-revisions.md V2+V3).
//
// AssayFlourish is DUMB: it owns no storage, no useEffect, no useState, no
// knowledge of tokens/visibility/tiers. It renders the flying-ring div AT
// REST (opacity 0, per the CSS contract's designed exception —
// globals.css:762-792 — the ring's finished state IS invisible) and exports
// one imperative function:
//
//     playFlourish(rootEl: HTMLElement): void
//
// Call it exactly once, from the controller's effect, after the controller
// has already decided (via shouldBurnToken / the attemptShow try/catch in
// V2/V3) that THIS view should animate. `rootEl` must be the same
// position:relative hero wrapper GoalAssayHero renders (data-testid
// "goal-assay-hero") — every element playFlourish touches is scoped to a
// querySelector inside it, so passing the whole page is safe but wasteful,
// and passing a detached/wrong subtree simply arms nothing (no throw).
//
// What playFlourish does, in order:
//   1. Finds every `[data-assay="<name>"]` descendant (GoalAssayHero's own
//      .assay-annulus div carries one too, `data-assay="annulus"`, purely
//      for uniformity — it already has its permanent class, see below) and
//      `classList.add`s the ONE primitive class that name maps to:
//        "ring"            -> "assay-ring"
//        "annulus"         -> "assay-annulus" (no-op if already applied)
//        "objective"       -> "assay-rise"
//        "row-<n>"         -> "assay-rise" (any string starting "row-")
//        anything else     -> "assay-fade" (eyebrow/subline/fact-line/
//                             hairline/what-moved-label/reach-row/badges/
//                             permanence/cta — every plain text/line entry)
//   2. For the ring specifically, attaches a ONE-TIME `animationend`
//      listener that clears `will-change` via an inline-style override
//      (`el.style.willChange = "auto"`) — CSS cannot remove a
//      class-declared `will-change` itself; only a subsequent style write
//      can outrank it. This is the "added with the class, removed on
//      animationend" contract from globals.css:598-603/791.
//   3. Separately seats Bullseye's rim + 3 inner discs via a STRUCTURAL
//      `querySelectorAll("svg circle")` scoped to rootEl (see
//      seatBullseyeDiscs below) — Bullseye.tsx exposes no per-circle hook
//      (deliberately unmodified, report §5.1 F1), so there is no
//      `data-assay` seam into its own markup. This is a documented
//      CSS-contract gap, not an oversight: it is positional and will
//      silently mis-seat if Bullseye's internal circle count/order ever
//      changes. Flag at merge if a more robust seam is wanted.
//
// Per-element stagger (`--assay-delay`) is NEVER computed by playFlourish —
// GoalAssayHero/AssayMonument/AssayTargetRows set it as an inline
// `style={{ "--assay-delay": "360ms" }}` at author/SSR time (harmless: a
// custom property has no visual effect until its element's animation class
// is present — see the Rule A discussion below). playFlourish only adds the
// class; the delay ladder is baked into the DOM before it ever runs.
//
// Why none of the "beat" primitive classes (.assay-fade/.assay-rise/
// .assay-disc-rim/.assay-disc-inner/.assay-ring) are present in this file's
// (or any sibling monument component's) SERVER-rendered JSX: every one of
// those classes carries BOTH a resting state AND an unconditional
// `animation: ... both` declaration in globals.css. If baked into SSR HTML
// from the start, the browser would autoplay them on every fresh paint —
// first view AND every repeat visit — defeating the one-shot token
// entirely. Per report §7.5 ("Known risk — the SSR pre-hydration rewind"),
// the settled/server-rendered composition is deliberately class-free for
// these primitives; the controller adds them post-hydration, exactly once,
// only when shouldBurnToken says so. `.assay-annulus` is the ONE exception
// GoalAssayHero bakes in directly (it is the PERMANENT ring, not a "beat" —
// see that file's header comment for why its case differs).
// ════════════════════════════════════════════════════════════════════════

"use client";

/** Maps a `data-assay` attribute value to the one CSS primitive class that
 *  arms it. Unrecognized/future values fall through to the opacity-only
 *  entrance (`assay-fade`) rather than throwing — a forward-compatible
 *  default, never a broken ceremony over an unknown beat name. */
function classForDataAssay(value: string): string {
  if (value === "ring") return "assay-ring";
  if (value === "annulus") return "assay-annulus";
  if (value === "objective" || value.startsWith("row-")) return "assay-rise";
  return "assay-fade";
}

/**
 * Structural (not data-assay) seating of Bullseye's own <circle> elements —
 * see the header comment's point 3. Scoped to `rootEl` so multiple
 * Bullseyes on a page (there is only ever one in the monument, but this
 * stays defensive) never cross-contaminate.
 */
function seatBullseyeDiscs(rootEl: HTMLElement): void {
  const circles = rootEl.querySelectorAll<SVGCircleElement>("svg circle");
  if (circles.length === 0) return;
  const [rim, ...inner] = Array.from(circles);
  rim?.classList.add("assay-disc-rim");
  inner.forEach((circle, i) => {
    circle.classList.add("assay-disc-inner");
    circle.style.setProperty("--assay-delay", `${40 + i * 40}ms`);
  });
}

/**
 * Arms the flourish exactly once. Idempotent-ish in practice (re-calling it
 * just re-adds classes that are already present, a no-op for classList),
 * but the controller owns NOT calling it twice — see the header contract.
 */
export function playFlourish(rootEl: HTMLElement): void {
  const nodes = rootEl.querySelectorAll<HTMLElement>("[data-assay]");

  for (const el of nodes) {
    const key = el.dataset.assay;
    if (!key) continue;
    const cls = classForDataAssay(key);
    el.classList.add(cls);

    if (cls === "assay-ring") {
      el.addEventListener(
        "animationend",
        () => {
          el.style.willChange = "auto";
        },
        { once: true },
      );
    }
  }

  seatBullseyeDiscs(rootEl);
}

/**
 * The flying/transient ring (§2.1 item 2's garnish, report §5.1 F2) — the
 * ONLY DOM node this component renders. At rest it is invisible and
 * unclassed (see header comment); playFlourish adds `.assay-ring`, which
 * supplies its real geometry (border, position, scale) AND triggers the
 * `assay-ring-break` keyframe in the same stroke, since the class is fresh.
 * `data-testid`/`aria-hidden`/`pointer-events:none` per report §7.2/§8.2 —
 * it occupies no layout and announces nothing at rest or mid-flight.
 */
export function AssayFlourish() {
  return (
    <div
      data-testid="goal-assay-flourish-ring"
      data-assay="ring"
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "9999px",
        pointerEvents: "none",
        opacity: 0,
      }}
    />
  );
}
