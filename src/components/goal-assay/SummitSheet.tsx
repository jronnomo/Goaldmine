"use client";
// src/components/goal-assay/SummitSheet.tsx (REQ-004)
//
// Full-bleed portaled <dialog> — "The Summit Sheet" (phase-a Direction 1).
// Plays the staged first-view ceremony (B1 scrim -> B2 discs seat -> B3 gold
// rings break -> B4 objective -> B5 stat cells -> B6 Reach/badges/level ->
// B7 footer) on top of the existing BottomSheet foundation, then dismisses
// onto the permanent monument (REQ-003, not this file).
//
// ── Why this file, not "part of the controller" ────────────────────────────
// Kept as its own component (not folded into AssayCeremonyController) because
// it has a real, independently-testable responsibility split: this file owns
// DIALOG UI mechanics (portal/two-phase-mount, Skip/Close semantics, Esc/
// backdrop dismissal, scroll lock, post-landing focus management) while the
// controller owns ONLY the show/burn decision (V2/V3's single-authority
// rule). Neither needs to know the other's internals: the controller talks to
// this component through exactly one native surface — a forwarded ref to the
// <dialog> element, which it calls `.showModal()` on imperatively — and this
// component never reads/writes the ceremony token itself. That mirrors the
// "controller commands a dumb leaf" shape the architecture docs specify for
// AssayFlourish, applied here to the Sheet instead.
//
// ── Auto-open idiom (V4/C4) ─────────────────────────────────────────────────
// Unlike BottomSheet, this dialog has NO `open` boolean prop — there is no
// `useState(false)` + `setOpen(true)` anywhere in this file, which is exactly
// the "obvious" pattern architecture-critique.md C4 verified trips the live
// `react-hooks/set-state-in-effect` ESLint rule. Instead this dialog mounts
// UNCONDITIONALLY (always present, closed) and is opened purely imperatively
// by whoever holds its forwarded ref (the controller) calling
// `dialogRef.showModal()` — the same idiom already used by
// ScanFoodSheet.tsx/LibraryPickerOverlay.tsx for their own portaled dialogs,
// here applied to an externally-driven open rather than a locally-driven one.
//
// ── Skip/Close semantics (binding) ──────────────────────────────────────────
// Tap 1: adds `.landed` to the panel (globals.css's hard animation override —
// every beat jumps to its terminal state instantly) and swaps the button's
// label Skip -> Close via direct DOM mutation (classList/refs — no setState),
// SAME button node (never unmounts/remounts it, so focus is never lost).
// Tap 2 (now labelled Close), Esc (native `cancel`), and a backdrop click all
// call `dialog.close()` directly — none of them need the `.landed` step
// first. Native <dialog> restores focus to whatever had it before
// `showModal()` was called; nothing here fights that.
//
// ── Token burn — NOT here ───────────────────────────────────────────────────
// This component never touches localStorage. The controller burns the token
// immediately after a successful `showModal()` call, from ITS OWN effect —
// by the time this dialog is actually open, the token is already burned.
// This file's only obligation is dismissal UI, never the one-shot semantics.
//
// ── Split for testability ────────────────────────────────────────────────
// `SummitSheetContent` (below) is a plain, non-interactive, server-renderable
// function component holding all the actual beat markup (hero, objective,
// stat cells, Reach/badges/level, footer). `SummitSheet` (the "use client"
// dialog/portal/ref/Skip-semantics shell) renders it as its scrollable body.
// This split lets the render-smoke tests exercise real ceremony markup via
// `renderToStaticMarkup` without needing a portal, a real <dialog>, or jsdom
// (none of which this repo's Vitest config provides — see
// GoalCompletedCelebration.test.ts's precedent for why).

import { forwardRef, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Bullseye } from "@/components/Bullseye";
import { ReachMeter } from "@/components/ReachMeter";
import type { RarityTier } from "@/lib/rarity-core";

// Stable identity for useSyncExternalStore — same idiom as BottomSheet (see
// its docstring); this store never changes, the callback is never invoked.
function subscribeNever() {
  return () => {};
}

// ─────────────────────────────────────────────────────────
// Content props — plain scalars only (no Prisma types, no JSX), per PRD
// "server-renderable CONTENT passed as children/props." The caller (Stage 3's
// page integration) is responsible for shaping these from
// GoalCompletionSnapshot + goal-assay-core's heroStatPrecedence/honesty
// guards — this component only renders what it's given.
// ─────────────────────────────────────────────────────────

export type SummitSheetTier = "marker" | "ascent" | "summit";

export type SummitSheetStatCell = {
  /** Pre-formatted display value, e.g. "98", "7 of 9", "+700", "8 -> 89". */
  value: string;
  /** Uppercase stat label, e.g. "DAYS ELAPSED", "TARGETS MET". */
  label: string;
  /** Optional secondary line under the label — carries the honesty-framing
   *  caption for the weighted-progress cell (goal-assay-core's
   *  READINESS_FRAMING / coverage denominator), never invented here. */
  caption?: string;
};

export type SummitSheetBadge = { id: string; name: string };

export type SummitSheetReach = { tier: RarityTier; label: string };

export type SummitSheetContentProps = {
  tier: SummitSheetTier;
  /** Frozen objective text (GoalCompletionSnapshot.objective). */
  objective: string;
  /** Pre-formatted date line, e.g. "SEP 12, 2025" — caller formats via the
   *  existing pure string-split date formatter; NEVER `new Date(dateKey)`
   *  here (this component stays calendar/Prisma-free). */
  dateLabel: string;
  /** Backdated suffix, e.g. "(backdated)" — omit when not backdated. */
  backdatedSuffix?: string;
  /** 4 cells (Ascent/Summit) or 2 cells (Marker floor) — the row count is
   *  emergent from what's actually true (report §2.2 Rule C), never a
   *  `tier`-branched cell COUNT decided in this file. */
  statCells: SummitSheetStatCell[];
  /** Zero-target honest sentence, shown instead of a progress/targets cell
   *  (PRD §6 edge case: zero-target goal -> no readiness row, one honest
   *  line, per report's Marker floor). Rendered only when non-empty. */
  emptyTargetsHint?: string;
  /** null omits the Reach row entirely (unrated tier) — never render an
   *  empty 5-segment meter (PRD §6 edge case: "visible zero"). */
  reach: SummitSheetReach | null;
  /** Empty array omits the badges block (PRD §6 edge case: no badges). */
  badges: SummitSheetBadge[];
  /** Both non-null AND different -> render the level-crossing line; null or
   *  equal -> omit (PRD §6 edge case: levelBefore===levelAfter). Absent
   *  ceremony data (legacy snapshot, REQ-008/V5) should resolve to null
   *  upstream — this component never recomputes it. */
  levelBefore: number | null;
  levelAfter: number | null;
  /** For the footer's "Get the card" link. */
  goalId: string;
};

// ─────────────────────────────────────────────────────────
// SummitSheetContent — pure presentational core (no hooks, no client-only
// behavior). Server-renderable; exported for render-smoke tests.
// ─────────────────────────────────────────────────────────

const TESTID = {
  root: "summit-sheet-content",
  hero: "summit-sheet-hero",
  objective: "summit-sheet-objective",
  dateLine: "summit-sheet-date-line",
  statCell: (i: number) => `summit-sheet-stat-cell-${i}`,
  emptyHint: "summit-sheet-empty-hint",
  reach: "summit-sheet-reach",
  badges: "summit-sheet-badges",
  levelLine: "summit-sheet-level-line",
} as const;

export function SummitSheetContent(props: SummitSheetContentProps & { objectiveHeadingId: string }) {
  const {
    objective,
    dateLabel,
    backdatedSuffix,
    statCells,
    emptyTargetsHint,
    reach,
    badges,
    levelBefore,
    levelAfter,
    objectiveHeadingId,
  } = props;

  const showLevelLine = levelBefore !== null && levelAfter !== null && levelBefore !== levelAfter;

  return (
    <div data-testid={TESTID.root} className="flex flex-col items-center gap-6 px-5 pb-10 pt-2 text-center">
      {/* Eyebrow — plain background (NOT --accent-soft, which fails AA per
          report §8.4); fires at the SAME beat as the objective (B4) — the
          hero (B2/B3) finishes seating/breaking BEFORE this text rises. */}
      <p
        className="assay-fade assay-b4 text-xs font-semibold uppercase tracking-[0.09em]"
        style={{ color: "var(--accent)" }}
      >
        Goal achieved
      </p>

      {/* Hero — Bullseye discs (B2) + permanent gold annulus + 3 flying
          rings (B3, Direction-1's terminal-scale ring break) sharing the SAME
          .assay-disc-rim/.assay-disc-inner/.assay-annulus primitives the
          monument (REQ-003) uses, per globals.css's contract comment: "one
          Bullseye+annulus geometry, shared between the monument and the
          Sheet." Reduced motion swaps the 3 flying rings for 3 static
          "engraved rosette" hairlines via the @media block in globals.css —
          no JS branch needed here, both are always in the markup. */}
      <div
        data-testid={TESTID.hero}
        className="relative shrink-0"
        style={{ width: "var(--assay-hero-size)", height: "var(--assay-hero-size)" }}
        aria-hidden
      >
        <Bullseye size={224} filled className="absolute inset-0 assay-disc-rim assay-b2" />
        <div className="assay-annulus assay-b2" style={{ "--assay-delay": "260ms" } as React.CSSProperties} />
        <div className="assay-sheet-ring assay-sheet-ring--1 assay-b3" style={{ "--assay-delay": "600ms" } as React.CSSProperties} />
        <div className="assay-sheet-ring assay-sheet-ring--2 assay-b3" style={{ "--assay-delay": "720ms" } as React.CSSProperties} />
        <div className="assay-sheet-ring assay-sheet-ring--3 assay-b3" style={{ "--assay-delay": "840ms" } as React.CSSProperties} />
        <div className="assay-rosette-ring assay-rosette-ring--1" />
        <div className="assay-rosette-ring assay-rosette-ring--2" />
        <div className="assay-rosette-ring assay-rosette-ring--3" />
      </div>

      {/* Objective + date — real text, reading-order content (report §8.2:
          "the objective is the page's h1/h2 ... a screen reader simply reads
          the artifact"). This IS the dialog's accessible label. */}
      <div className="assay-rise assay-b4 flex flex-col items-center gap-1">
        <h2 id={objectiveHeadingId} data-testid={TESTID.objective} className="font-serif text-[34px] leading-[1.06]" style={{ color: "var(--foreground)" }}>
          {objective}
        </h2>
        <p data-testid={TESTID.dateLine} className="font-mono text-xs tracking-[0.06em]" style={{ color: "var(--muted)" }}>
          {dateLabel}
          {backdatedSuffix ? ` ${backdatedSuffix}` : ""}
        </p>
      </div>

      <div className="assay-fade assay-b4 h-px w-full" style={{ background: "var(--border)" }} />

      {/* Stat cells (B5) — 4 for Ascent/Summit, 2 for Marker; count is
          emergent from `statCells.length`, never branched on `tier` here
          (report §2.2 Rule C: "the hero never shrinks; the evidence
          scales"). The Marker floor case renders its (fewer) real cells
          AND the honest zero-target sentence TOGETHER (phase-a 1b: "14 /
          +150" cells, then "No targets were set on this goal." below them)
          — the two are not mutually exclusive; `emptyTargetsHint` only ever
          accompanies a reduced cell set, it never substitutes for one. */}
      {statCells.length > 0 && (
        <div className="grid w-full grid-cols-2 gap-x-4 gap-y-5">
          {statCells.map((cell, i) => (
            <div
              key={i}
              data-testid={TESTID.statCell(i)}
              className="assay-rise assay-b5 flex flex-col items-start gap-0.5 text-left"
              style={{ "--assay-delay": `${1000 + i * 60}ms` } as React.CSSProperties}
            >
              <span className="font-serif text-[40px] leading-none" style={{ color: "var(--foreground)" }}>
                {cell.value}
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[0.09em]" style={{ color: "var(--muted)" }}>
                {cell.label}
              </span>
              {cell.caption ? (
                <span className="text-[11px] uppercase tracking-[0.09em]" style={{ color: "var(--muted)" }}>
                  {cell.caption}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {emptyTargetsHint && (
        <p data-testid={TESTID.emptyHint} className="assay-fade assay-b5 text-[13px]" style={{ color: "var(--muted)" }}>
          {emptyTargetsHint}
        </p>
      )}

      {(reach || badges.length > 0 || showLevelLine) && (
        <div className="assay-fade assay-b4 h-px w-full" style={{ background: "var(--border)" }} />
      )}

      {/* Reach + badges + level (B6) — the row wrapper fades as a unit;
          ReachMeter ITSELF gets neither .assay-fade nor .assay-rise (UXR-63-21
          "never animates" — the meter must render at full opacity, no
          transform, ever, per globals.css's contract comment on .assay-b6). */}
      {reach && (
        <div data-testid={TESTID.reach} className="assay-fade assay-b6 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.09em]" style={{ color: "var(--muted)" }}>
            Reach
          </span>
          <ReachMeter tier={reach.tier} label size="md" />
        </div>
      )}

      {badges.length > 0 && (
        <div data-testid={TESTID.badges} className="assay-fade assay-b6 flex flex-wrap justify-center gap-4">
          {badges.map((badge) => (
            <div key={badge.id} className="flex flex-col items-center gap-1" style={{ maxWidth: 96 }}>
              <div
                aria-hidden
                className="flex items-center justify-center rounded-full"
                style={{ width: 76, height: 76, background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                <span className="text-lg font-semibold">
                  {badge.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
              </div>
              <span className="text-xs" style={{ color: "var(--foreground)" }}>
                {badge.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {showLevelLine && (
        <p data-testid={TESTID.levelLine} className="assay-fade assay-b6 font-mono text-[13px]" style={{ color: "var(--foreground)" }}>
          Level {levelBefore} → {levelAfter}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// applySkipTap — the Skip/Close state transition, extracted as a pure
// function over minimal DOM-surface interfaces so it's unit-testable without
// a real <dialog>/jsdom (this repo's Vitest config runs "node", not jsdom —
// see GoalCompletedCelebration.test.ts's precedent). Tap 1: land every beat
// instantly + swap the button's own label (same node, never
// unmount/remount — so focus is never lost) + move focus to Continue since
// the composition is now terminal. Tap 2 (now labelled Close): dismiss.
// Returns the new `tapped` flag for the caller to persist in its ref.
// ─────────────────────────────────────────────────────────

export type SkipTapPanelLike = { classList: { add(className: string): void } };
export type SkipTapButtonLike = { textContent: string; setAttribute(name: string, value: string): void };
export type SkipTapFocusableLike = { focus(): void };
export type SkipTapDialogLike = { close(): void };

export function applySkipTap(params: {
  alreadyTapped: boolean;
  panel: SkipTapPanelLike;
  skipButton: SkipTapButtonLike;
  continueButton: SkipTapFocusableLike;
  dialog: SkipTapDialogLike;
}): true {
  if (!params.alreadyTapped) {
    params.panel.classList.add("landed");
    params.skipButton.textContent = "Close";
    params.skipButton.setAttribute("aria-label", "Close");
    params.continueButton.focus();
  } else {
    params.dialog.close();
  }
  return true; // tapped-at-least-once is permanent for the lifetime of one ceremony view
}

// ─────────────────────────────────────────────────────────
// SummitSheet — the "use client" dialog/portal shell
// ─────────────────────────────────────────────────────────

export const SummitSheet = forwardRef<HTMLDialogElement, SummitSheetContentProps>(function SummitSheet(
  props,
  forwardedRef,
) {
  const { goalId } = props;
  const objectiveHeadingId = useId();

  const localDialogRef = useRef<HTMLDialogElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const skipBtnRef = useRef<HTMLButtonElement | null>(null);
  const continueBtnRef = useRef<HTMLButtonElement | null>(null);
  const skipTappedRef = useRef(false);
  const scrollYRef = useRef(0);
  const prevBodyOverflowRef = useRef("");

  // Two-phase mount — same idiom as BottomSheet/ScanFoodSheet (see
  // BottomSheet.tsx's docstring). createPortal needs `document`, absent
  // during SSR; both the server render and the client's hydration render
  // call getServerSnapshot (false), so they agree — no mismatch. React's
  // post-hydration recheck flips this to true on the next client commit.
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  // Merge the forwarded ref (the controller's handle, used to call
  // `.showModal()`) with a local ref (used below for Skip/Esc/backdrop/scroll
  // handling) — both point at the same node.
  function setDialogRef(node: HTMLDialogElement | null) {
    localDialogRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) (forwardedRef as React.RefObject<HTMLDialogElement | null>).current = node;
  }

  // Scroll lock + reduced-motion post-open focus, both driven off the
  // dialog's native `open` ATTRIBUTE rather than any React-tracked state
  // (there is none) — a MutationObserver is the correct primitive for
  // "notify me when this externally-driven native property changes."
  // Gated on `mounted`: the real <dialog> node (and thus a target to
  // observe) only exists once the portal above has actually mounted.
  //
  // M1 fix (QA): this is also where the three `.assay-sheet-ring` elements'
  // `will-change` gets armed — imperatively, JS-side, at the exact moment
  // the dialog is about to actually open — rather than baking a permanent
  // `will-change` into `.assay-sheet-ring`'s CSS rule (which would pin a
  // compositor layer on every achieved-goal page view, since this dialog
  // stays mounted-but-closed for the page's whole lifetime per V4's
  // imperative idiom). Cleared on each ring's own `animationend`, mirroring
  // AssayFlourish.tsx's add-with-the-animation/remove-on-animationend
  // contract for the monument's single ring.
  useEffect(() => {
    if (!mounted) return;
    const dialog = localDialogRef.current;
    if (!dialog) return;

    const onOpenAttrChange = () => {
      if (dialog.open) {
        scrollYRef.current = window.scrollY;
        prevBodyOverflowRef.current = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        // Reduced motion has no animation chain to end, so the normal
        // "focus Continue after the last beat's animationend" path (below,
        // on the footer) never fires — the composition is already terminal
        // per Rule A, so focus Continue right away instead. It also means
        // the rings never animate (globals.css hides `.assay-sheet-ring`
        // under the reduced-motion media query), so there is nothing to
        // arm.
        const reduceMotion =
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduceMotion) {
          continueBtnRef.current?.focus();
        } else {
          const rings = panelRef.current?.querySelectorAll<HTMLElement>(".assay-sheet-ring") ?? [];
          rings.forEach((ring) => {
            ring.style.willChange = "transform, opacity";
            ring.addEventListener(
              "animationend",
              () => {
                ring.style.willChange = "auto";
              },
              { once: true },
            );
          });
        }
      } else {
        document.body.style.overflow = prevBodyOverflowRef.current;
        window.scrollTo(0, scrollYRef.current);
      }
    };

    const observer = new MutationObserver(onOpenAttrChange);
    observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, [mounted]);

  function handleSkipClick() {
    const dialog = localDialogRef.current;
    const panel = panelRef.current;
    const skipBtn = skipBtnRef.current;
    const continueBtn = continueBtnRef.current;
    if (!dialog || !panel || !skipBtn || !continueBtn) return;
    skipTappedRef.current = applySkipTap({
      alreadyTapped: skipTappedRef.current,
      panel,
      skipButton: skipBtn,
      continueButton: continueBtn,
      dialog,
    });
  }

  function handleFooterAnimationEnd() {
    // Normal (animated) path: the footer is the LAST beat (.assay-b7) to
    // fade in — its animationend is the signal the ceremony has fully
    // landed. Reduced motion's equivalent signal is handled above via the
    // MutationObserver (no animation ever runs there, so this never fires).
    continueBtnRef.current?.focus();
  }

  if (!mounted) return null;

  return createPortal(
    <dialog
      ref={setDialogRef}
      className="bottom-sheet"
      aria-labelledby={objectiveHeadingId}
      data-testid="summit-sheet-dialog"
      // Esc arrives as the native `cancel` event; default behavior already
      // closes the dialog (dispatching `close`), so no handler is needed to
      // route it anywhere — this dialog has no external `open` state for Esc
      // to get out of sync with.
      onClick={(e) => {
        // Backdrop click: the dialog element itself is the click target only
        // when the click landed on the scrim, not a descendant (same guard
        // BottomSheet/ScanFoodSheet use).
        if (e.target === e.currentTarget) localDialogRef.current?.close();
      }}
    >
      <div ref={panelRef} className="summit-sheet-panel">
        <div className="flex justify-end px-3 pt-[calc(env(safe-area-inset-top)+12px)]">
          <button
            ref={skipBtnRef}
            type="button"
            data-testid="summit-sheet-skip"
            onClick={handleSkipClick}
            aria-label="Skip"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border text-sm font-medium transition-colors active:bg-[var(--accent)]/20"
            style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--muted)" }}
          >
            Skip
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <SummitSheetContent {...props} objectiveHeadingId={objectiveHeadingId} />
        </div>

        <div
          className="assay-fade assay-b7 flex gap-3 border-t px-5 py-3"
          style={{ borderColor: "var(--border)", paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
          onAnimationEnd={handleFooterAnimationEnd}
        >
          <a
            href={`/recap/completion?goalId=${encodeURIComponent(goalId)}`}
            data-testid="summit-sheet-share"
            className="flex min-h-11 flex-1 items-center justify-center rounded-lg text-sm font-medium transition-opacity active:opacity-80"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            Get the card
          </a>
          <button
            ref={continueBtnRef}
            type="button"
            data-testid="summit-sheet-continue"
            onClick={() => localDialogRef.current?.close()}
            className="flex min-h-11 flex-1 items-center justify-center rounded-lg border text-sm font-medium transition-colors active:bg-[var(--accent)]/20"
            style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
          >
            Continue
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
});
