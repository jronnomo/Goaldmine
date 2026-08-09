"use client";
// src/components/goal-assay/AssayCeremonyController.tsx (REQ-004)
//
// THE single authority for "The Assay" ceremony's show/burn decision
// (architecture-v2-revisions.md V2/V3, architecture-critique.md C2/C3).
// Exactly one component reads/writes the ceremony token and decides whether
// the SummitSheet overlay opens or the monument flourish plays instead — no
// other component (SummitSheet, the future AssayFlourish) touches storage or
// makes that decision independently. This is the direct fix for
// architecture-critique.md's C2 (double-ceremony / burn race) and C3 (burn
// decoupled from the actual visual commitment).
//
// ── Token namespace (V1/C1) ────────────────────────────────────────────────
// `goaldmine.assay.<goalId>.<capturedAt>` — a NEW namespace, deliberately
// disjoint from GoalCompletedCelebration's `goaldmine.celebrated.goal.*` keys
// (see celebrationStorageKey in GoalCompletedCelebration.tsx, untouched by
// this feature). Reusing that legacy namespace would mean every goal a user
// already viewed once under the currently-shipped ring-burst — including the
// founder's own reference Elbert completion — silently gets ZERO ceremony on
// ship day (exactly the bug this feature exists to fix, recurring by key
// collision). `capturedAt` is frozen at completion time (never changes for a
// given completion), so the pair (goalId, capturedAt) uniquely and stably
// identifies one completion's one-shot ceremony.
//
// ── State machine (V2/V3, binding) ──────────────────────────────────────────
//   mount:
//     burned            -> SETTLED   (monument static, no sheet, no flourish, no write)
//     !document.visible -> WAITING   (one-shot 'visibilitychange' listener, no write)
//     else               -> attemptShow()
//   attemptShow():
//     try   { dialog.showModal(); burn(); }               // the ONE visual commitment
//                                                          // overlay shown => flourish
//                                                          // NEVER plays (no double ceremony)
//     catch { burn(); play monument flourish (fallback IS the ceremony) }
//   Sheet dismissed (skip x2 / esc / backdrop / Continue) -> SETTLED, no further writes.
//     (SummitSheet owns dismissal UI; it never touches the token — see its own
//     header comment.)
//
// Exactly one write site (`burn`), gated on exactly one successful decision
// per mount, executed AFTER the visual commitment (or its catch-fallback) —
// never before. Storage read/write failures (private browsing, quota) degrade
// to "ceremony may repeat" rather than throwing (PRD §6 edge case: accepted).
//
// ── The controller<->flourish interface (RESOLVED — Stage 3 reconciliation)
// ────────────────────────────────────────────────────────────────────────
// AssayFlourish.tsx (now present in this worktree) ships as a dumb,
// effect-free leaf: it exports exactly one imperative function,
// `playFlourish(rootEl)`, and touches no storage/state/listeners of its own
// (see that file's header comment — "owns no storage, no useEffect, no
// useState"). Reconciling that with the speculative CustomEvent contract this
// comment used to describe had two options: (a) give AssayFlourish its own
// `useEffect` + an `"assay:play-flourish"` listener on a self-tagged root, or
// (b) have this controller import `playFlourish` and call it directly. (a)
// would force AssayFlourish to grow exactly the effect/state machinery its
// header explicitly forbids, purely to re-invent a call this controller can
// already make now that both files live in the same tree — so (b) wins as
// the smaller, contract-preserving change. The dead half — dispatching a
// CustomEvent nothing was ever wired to listen for — is retired below.
//
// `playFlourishFallback` still needs a `document.querySelector` (not a React
// ref) because the controller and the monument (AssayMonument.tsx, which
// composes GoalAssayHero) are SIBLINGS in the page tree — there is no ref
// path between them. It targets AssayMonument's own outer wrapper, which
// carries `data-assay-flourish-root`, rather than GoalAssayHero's narrower
// `goal-assay-hero` testid div: playFlourish's header sanctions passing any
// ancestor of every `[data-assay]` node ("passing the whole page is safe but
// wasteful"), and the objective/rows/badges/CTA markers all live OUTSIDE
// GoalAssayHero's small hero wrapper — only AssayMonument's root is an
// ancestor of all of them. If no such element is mounted (e.g. this
// controller is exercised standalone), this is a silent no-op — the token is
// still burned (this view IS the shown ceremony per V2/V3), and the page
// simply shows its already-settled monument. AssayFlourish itself does NOT
// read or write the token (V2/V3: "it does not touch storage").

import { useEffect, useRef, useSyncExternalStore } from "react";
import { shouldBurnToken } from "@/lib/goal-assay-core";
import { playFlourish } from "./AssayFlourish";
import { SummitSheet, type SummitSheetContentProps } from "./SummitSheet";

// Stable identity for useSyncExternalStore — same idiom as BottomSheet /
// ScanFoodSheet / LibraryPickerOverlay (see BottomSheet.tsx's docstring for
// why this isn't useState + useEffect: it would trip
// react-hooks/set-state-in-effect). This store never changes; the callback is
// never invoked, but its identity must be stable across renders.
function subscribeNever() {
  return () => {};
}

// ─────────────────────────────────────────────────────────
// Pure token-key builder + state-machine decision (exported for unit tests —
// no DOM/React required to exercise this logic; see AssayCeremonyController.test.ts)
// ─────────────────────────────────────────────────────────

export const ASSAY_TOKEN_NAMESPACE = "goaldmine.assay";

/** Versioned ceremony token key (V1/C1) — deliberately disjoint from GoalCompletedCelebration's `goaldmine.celebrated.goal.*` namespace. */
export function assayTokenKey(goalId: string, capturedAt: string): string {
  return `${ASSAY_TOKEN_NAMESPACE}.${goalId}.${capturedAt}`;
}

/** Minimal surface this module needs from a `<dialog>` — mockable without real DOM. */
export type AssayDialogLike = { showModal(): void };

/** Minimal surface this module needs from localStorage — mockable without real DOM. */
export type AssayStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type AssayCeremonyOutcome =
  | "settled" // already burned — do nothing
  | "waiting" // not visible yet — caller must re-invoke attemptAssayCeremony once visible
  | "shown" // showModal() succeeded; burned; flourish must NOT play
  | "flourish-fallback"; // showModal() threw; burned; flourish fallback should play

/**
 * Best-effort burn — a storage write failure (private browsing, quota)
 * degrades silently to "ceremony may repeat" (PRD §6 edge case: accepted),
 * never throws.
 */
function burn(storage: AssayStorageLike, key: string): void {
  try {
    storage.setItem(key, "1");
  } catch {
    // storage blocked — degrade silently, per PRD edge cases.
  }
}

/**
 * The single-authority decision + the single write site (V2/V3). Pure enough
 * to unit test with fakes: no module-level state, every dependency is passed
 * in. Callers (the controller's effect below) supply the real `document`/
 * `localStorage`; tests supply fakes.
 *
 * NOTE on `alreadyBurned`: reading storage can itself throw (rare, but the
 * same class of failure `burn` guards against) — callers should wrap their
 * own `storage.getItem` read defensively and pass the resolved boolean in,
 * exactly as `attemptAssayCeremony` (the component-facing wrapper below) does.
 */
export function decideAssayCeremony(params: {
  storage: AssayStorageLike;
  key: string;
  alreadyBurned: boolean;
  visibilityState: string;
  dialog: AssayDialogLike;
  onFlourishFallback: () => void;
}): AssayCeremonyOutcome {
  const { storage, key, alreadyBurned, visibilityState, dialog, onFlourishFallback } = params;

  if (alreadyBurned) return "settled";

  // shouldBurnToken(vis, false) === (vis === "visible") — reused from
  // goal-assay-core rather than re-implemented, since `alreadyBurned` is
  // already known-false at this point (the true case returned above).
  if (!shouldBurnToken(visibilityState, false)) return "waiting";

  // The ONE visual commitment. Burn happens AFTER, gated on the outcome —
  // never before (architecture-critique.md C3).
  try {
    dialog.showModal();
    burn(storage, key);
    return "shown";
  } catch {
    burn(storage, key);
    onFlourishFallback();
    return "flourish-fallback";
  }
}

/**
 * Component-facing wrapper: resolves `alreadyBurned` from real storage
 * (defensively — a blocked read is treated as "unburned," matching the
 * PRD's "storage blocked -> ceremony may repeat" edge case) and delegates to
 * `decideAssayCeremony`.
 */
export function attemptAssayCeremony(params: {
  goalId: string;
  capturedAt: string;
  storage: AssayStorageLike;
  visibilityState: string;
  dialog: AssayDialogLike;
  onFlourishFallback: () => void;
}): AssayCeremonyOutcome {
  const key = assayTokenKey(params.goalId, params.capturedAt);
  let alreadyBurned: boolean;
  try {
    alreadyBurned = params.storage.getItem(key) !== null;
  } catch {
    alreadyBurned = false;
  }
  return decideAssayCeremony({
    storage: params.storage,
    key,
    alreadyBurned,
    visibilityState: params.visibilityState,
    dialog: params.dialog,
    onFlourishFallback: params.onFlourishFallback,
  });
}

/**
 * The DOM half of the controller<->flourish interface (see header comment
 * above). Isolated into its own function so the decision logic above
 * (`decideAssayCeremony`) can inject it as a plain no-arg callback — tests
 * exercise that logic with a `vi.fn()` stand-in instead of a real DOM.
 */
function playFlourishFallback(): void {
  if (typeof document === "undefined") return;
  const root = document.querySelector("[data-assay-flourish-root]");
  if (!root) return; // no monument mounted (standalone use) — silent no-op
  playFlourish(root as HTMLElement);
}

// ─────────────────────────────────────────────────────────
// The component
// ─────────────────────────────────────────────────────────

export type AssayCeremonyControllerProps = {
  /** The goal this completion belongs to. */
  goalId: string;
  /** GoalCompletionSnapshot.capturedAt — the frozen ISO instant that makes the token unique per completion. */
  capturedAt: string;
  /** Ceremony tier (report §2.2 Rule C) — routes SummitSheet's beat count/stat-cell count. Reduced motion is irrelevant here; globals.css's @media block handles it structurally. */
  tier: SummitSheetContentProps["tier"];
} & Omit<SummitSheetContentProps, "tier">;

/**
 * AssayCeremonyController — mounts SummitSheet unconditionally (always
 * present, closed) and, on mount, runs the state machine above exactly once
 * per (goalId, capturedAt) pair to decide whether it opens.
 *
 * NO setState anywhere in this component: the dialog's open/closed state is
 * native (`<dialog>`'s own `open` property, driven imperatively via
 * `dialog.showModal()`), and the mount-detection below reuses the
 * project's precedented `useSyncExternalStore(subscribeNever, ...)` two-phase
 * idiom (BottomSheet/ScanFoodSheet/LibraryPickerOverlay) rather than
 * `useState` + `useEffect(() => setMounted(true), [])`, which would trip
 * `react-hooks/set-state-in-effect`.
 *
 * Ref-population timing: SummitSheet's `<dialog>` only exists in the DOM
 * once ITS OWN two-phase mount (identical idiom) flips — both this
 * controller's and SummitSheet's `mounted` flags flip together on React's
 * single post-hydration consistency recheck, in the SAME commit, and DOM
 * refs attach during commit, before any effect runs. So by the time this
 * effect (dependent on `mounted`) fires, `dialogElRef.current` is already
 * populated. See architecture-critique.md's "Multi-commit hydration gap"
 * Concern — this is the documented, accepted design fact, not a bug: there is
 * a brief window where only the SSR-painted monument is visible before the
 * dialog can appear.
 */
export function AssayCeremonyController(props: AssayCeremonyControllerProps) {
  const { capturedAt, tier, ...contentProps } = props;
  // `goalId` stays IN `contentProps` (SummitSheet needs it for the "Get the
  // card" link) — read separately here rather than destructured out.
  const { goalId } = contentProps;

  const dialogElRef = useRef<HTMLDialogElement | null>(null);
  const decidedRef = useRef(false);
  const listenerAddedRef = useRef(false);
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!mounted || decidedRef.current) return;
    const dialog = dialogElRef.current;
    if (!dialog) return; // defensive — should already be attached once mounted flips (see docstring)
    decidedRef.current = true;

    const tryAttempt = (): AssayCeremonyOutcome =>
      attemptAssayCeremony({
        goalId,
        capturedAt,
        dialog,
        storage: window.localStorage,
        visibilityState: document.visibilityState,
        onFlourishFallback: playFlourishFallback,
      });

    const outcome = tryAttempt();
    if (outcome === "waiting" && !listenerAddedRef.current) {
      listenerAddedRef.current = true;
      const onVisible = () => {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", onVisible);
        tryAttempt();
      };
      document.addEventListener("visibilitychange", onVisible);
    }
    // outcome "settled" / "shown" / "flourish-fallback": nothing further to do —
    // exactly one write already happened (or none, for "settled").
  }, [mounted, goalId, capturedAt]);

  return <SummitSheet ref={dialogElRef} tier={tier} {...contentProps} />;
}
