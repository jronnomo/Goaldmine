"use client";

import { useMemo, useState, useTransition } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { MacroInputs, type MacroDefaults, type MacroValues } from "@/components/MacroInputs";
import { Bullseye } from "@/components/Bullseye";
import { useFoodComposer } from "@/components/useFoodComposer";
import { useFormFeedback } from "@/lib/use-form-feedback";
import { logNutrition, updateNutrition } from "@/lib/workout-actions";
import { estimateMealMacros, type MealMacroEstimate } from "@/lib/food-actions";
import { parseItemsText, serializeItems } from "@/lib/items-text";
import { dateKey, shiftWallClock, toDatetimeLocalValue } from "@/lib/calendar-core";
import type { LibraryFood } from "@/lib/food-types";
import type { NutritionItem } from "@/lib/nutrition-log-ops";
import type { DayMacros } from "@/lib/nutrition-macros";
import { MEAL_LABELS } from "@/lib/nutrition-macros";
import { MEAL_SLOTS, type MealSlot } from "@/lib/nutrition-plan";
import {
  recomposeWithResidual,
  recalcItemMacros,
  addMacroValues,
  buildQtyDisplay,
  unitsForFood,
} from "@/lib/food-units";

// ── Types ────────────────────────────────────────────────────────────────────

const MEAL_TYPES = MEAL_SLOTS.map((s) => ({ value: s, label: MEAL_LABELS[s] }));

type MealType = MealSlot;

/** Structured seed for edit mode — items as a typed array, not a text blob. */
export type MealDefaults = {
  mealType: string;
  items: NutritionItem[];
  notes: string;
  /** datetime-local value ("YYYY-MM-DDTHH:MM") in USER_TZ. */
  date: string;
  macros?: MacroDefaults;
};

/**
 * Snapshot handed to `onDeleted` so the host can restore the meal without a
 * server round-trip. Edit-mode Delete is now NON-destructive: MealComposer
 * does NOT call deleteNutrition itself (UXR-meal-edit-13). The host decides
 * when/whether to commit — the BottomSheet host defers the commit behind a
 * ~5s Undo window; the full-page host commits immediately.
 */
export type MealDeleteSnapshot = {
  id: string;
  mealType: string;
  items: NutritionItem[];
  notes: string;
  /** datetime-local value ("YYYY-MM-DDTHH:MM") in USER_TZ. */
  date: string;
  macros: MacroValues;
};

/** Shared optional props for day-level context (create mode primary; edit gracefully ignores). */
type DayContextProps = {
  /**
   * Today's already-logged macro total (from RSC). When present, the header shows
   * the projected fill: (trackedSoFar + thisMeal) / dayTarget.
   * When absent (edit mode, NutritionToday's embedded form, etc.), the header
   * degrades to the existing single-meal readout. NO behavior regression.
   */
  trackedSoFar?: DayMacros;
  /**
   * Today's plan target (null when no plan is set).
   * null → hollow Bullseye + "No plan set — showing what's been logged".
   * undefined → not provided (same degraded behavior as null for the header).
   */
  dayTarget?: DayMacros | null;
  /** Pre-loaded library foods for the Browse-library picker. Passed to useFoodComposer. */
  libraryFoods?: LibraryFood[];
};

export type MealComposerProps =
  | ({
      mode: "create";
      quickPickFoods?: LibraryFood[];
      /** Planned calorie target for this slot, when known. Host-provided (TODO). */
      plannedTarget?: number;
      /** Called after a successful log (post-revalidatePath, form already
       *  reset) — lets the host refetch a list it owns. See LogNutritionForm. */
      onLogged?: () => void;
    } & DayContextProps)
  | ({
      mode: "edit";
      id: string;
      defaults: MealDefaults;
      quickPickFoods?: LibraryFood[];
      plannedTarget?: number;
      onSaved?: () => void;
      /** Non-destructive: receives the snapshot; host owns the commit decision. */
      onDeleted?: (snapshot: MealDeleteSnapshot) => void;
    } & DayContextProps);

// ── Pure helpers ─────────────────────────────────────────────────────────────

function defaultMeal(): MealType {
  const h = new Date().getHours();
  if (h < 10) return "breakfast";
  if (h < 14) return "lunch";
  if (h < 17) return "snack";
  return "dinner";
}

/**
 * Stable hash of the items array for staleness detection.
 * Includes amount and unit so structured edits are detected even if a future code
 * path changes them without explicitly resetting the hash (defense-in-depth).
 */
function hashItems(items: NutritionItem[]): string {
  return JSON.stringify(
    items.map((i) => [i.name, i.qty ?? "", i.notes ?? "", i.amount ?? "", i.unit ?? ""])
  );
}

/** True when qty starts with a number the stepper can bump. */
function hasNumericPrefix(qty: string | undefined): boolean {
  return qty != null && /^\s*\d/.test(qty);
}

/**
 * Bump the leading numeric prefix of a qty string by `delta`, preserving the
 * unit suffix and any decimal precision. "8 oz" → "9 oz", "2 slices" → "3 slices",
 * "0.5 cup" → "1.5 cup". Returns qty unchanged when there is no leading number.
 */
function bumpQty(qty: string | undefined, delta: number): string | undefined {
  if (qty == null) return qty;
  const m = qty.match(/^(\s*)(\d+(?:\.\d+)?)(.*)$/);
  if (!m) return qty;
  const [, lead, numStr, rest] = m;
  const isDecimal = numStr.includes(".");
  let next = parseFloat(numStr) + delta;
  if (next < 0) next = 0;
  const nextStr = isDecimal ? String(parseFloat(next.toFixed(4))) : String(next);
  return `${lead}${nextStr}${rest}`;
}

/** Format a Date into the read-only "Today 1:24 PM" resolved label (calendar-routed). */
function formatResolvedWhen(d: Date): string {
  const dv = toDatetimeLocalValue(d); // "YYYY-MM-DDTHH:MM"
  const [datePart, timePart] = dv.split("T");
  const todayKey = dateKey(new Date());
  const yesterdayKey = dateKey(shiftWallClock(new Date(), { days: -1 }));
  const dayLabel =
    datePart === todayKey
      ? "Today"
      : datePart === yesterdayKey
        ? "Yesterday"
        : datePart;
  const [hhStr, mm] = timePart.split(":");
  const hh = Number(hhStr);
  const ampm = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${dayLabel} ${h12}:${mm} ${ampm}`;
}

function macroNum(v: number | null | undefined): string {
  return v == null ? "—" : String(v);
}

/** True when the user asked for reduced motion (CSS animations are no-ops, so
 *  any JS that waits on transitionend must take an instant path instead). */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

const FLASHABLE_MACROS = ["calories", "proteinG", "carbsG", "fatG"] as const;

// ── Component ────────────────────────────────────────────────────────────────

export function MealComposer(props: MealComposerProps) {
  const isEdit = props.mode === "edit";
  const quickPickFoods = props.quickPickFoods;
  const plannedTarget = props.plannedTarget;
  const trackedSoFar  = props.trackedSoFar;
  const dayTarget     = props.dayTarget;
  const libraryFoods  = props.libraryFoods;

  // ── Canonical state ────────────────────────────────────────────────────────
  const seedItems = isEdit ? props.defaults.items : [];
  const [items, setItems] = useState<NutritionItem[]>(seedItems);
  const [mealType, setMealType] = useState<MealType>(
    isEdit ? ((props.defaults.mealType as MealType) ?? defaultMeal()) : defaultMeal(),
  );
  const [notes, setNotes] = useState(isEdit ? props.defaults.notes : "");
  const [whenDate, setWhenDate] = useState<Date>(() =>
    isEdit && props.defaults.date ? new Date(props.defaults.date) : new Date(),
  );
  // Heal-on-seed: a fully food-resolved meal (every item carries `source`) derives
  // its total from the items, so trust the items over the stored macro columns —
  // this auto-corrects logs saved before the add-path residual bug was fixed. Meals
  // with any freehand/legacy item (no source) keep their stored macros so manually
  // entered values are never clobbered.
  const seedAllStructured =
    isEdit && seedItems.length > 0 && seedItems.every((i) => !!i.source);
  const [macros, setMacros] = useState<MacroValues>(
    seedAllStructured
      ? recomposeWithResidual({}, [], seedItems)
      : {
          calories: isEdit ? props.defaults.macros?.calories ?? null : null,
          proteinG: isEdit ? props.defaults.macros?.proteinG ?? null : null,
          carbsG: isEdit ? props.defaults.macros?.carbsG ?? null : null,
          fatG: isEdit ? props.defaults.macros?.fatG ?? null : null,
          fiberG: isEdit ? props.defaults.macros?.fiberG ?? null : null,
          sodiumMg: isEdit ? props.defaults.macros?.sodiumMg ?? null : null,
        },
  );

  // Raw-paste escape hatch
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState("");

  // Exact-time disclosure
  const [showExactTime, setShowExactTime] = useState(false);

  // Macro staleness snapshot — initialized to the seeded items.
  const [snapshotHash, setSnapshotHash] = useState<string>(() => hashItems(seedItems));

  // Recompute preview
  const [preview, setPreview] = useState<MealMacroEstimate | null>(null);
  const [recomputing, startRecompute] = useTransition();

  // Edit-mode submit plumbing
  const [editPending, startEdit] = useTransition();
  const [editError, setEditError] = useState<string | null>(null);
  // Client-side pre-submit validation (create mode) — server throws are redacted
  // in prod, so the "nothing to log" case must be caught here with a real message.
  const [clientError, setClientError] = useState<string | null>(null);
  // Quiet-confirm: briefly show ✓ before onSaved closes the sheet (UXR-18).
  const [editSaved, setEditSaved] = useState(false);

  // ── Motion wiring (F4/F5/F6) ───────────────────────────────────────────────
  // Row REMOVE: the row stays mounted with `.is-exiting` until its collapse
  // transition ends, then we splice (UXR-meal-edit-19). null = nothing exiting.
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);
  // Stepper numeral tick: re-key the bumped row's numeral so the one-shot
  // animation replays on every tap, even rapid repeats (UXR-meal-edit-20).
  const [bumpState, setBumpState] = useState<{ idx: number; n: number } | null>(null);
  // Apply tint-flash: which macro numerals changed + a nonce to re-fire the
  // one-shot flash (UXR-meal-edit-21).
  const [flashMacros, setFlashMacros] = useState<{ keys: Set<string>; n: number } | null>(null);

  // Create-mode submit plumbing
  const {
    pending: createPending,
    error: createError,
    saved: createSaved,
    formRef: createFormRef,
    submit: createSubmit,
  } = useFormFeedback();

  // ── Derived ──────────────────────────────────────────────────────────────
  // In raw mode the visible textarea (rawText) is the source of truth; parse it
  // for hashing / recompute / the hidden submit value.
  const effectiveItems = useMemo(
    () => (rawMode ? parseItemsText(rawText) : items),
    [rawMode, rawText, items],
  );
  const stale = hashItems(effectiveItems) !== snapshotHash;

  // A loggable meal needs items OR at least one entered macro (macros-only
  // "custom" logs are valid — mirrors the logNutrition/updateNutrition rule).
  const emptyDraft =
    effectiveItems.length === 0 && !Object.values(macros).some((v) => v != null);

  // Bullseye meter: only a real meter when a planned target exists AND macros are
  // fresh; otherwise hollow. TODO(next slice): host passes `plannedTarget` from
  // the day's nutrition plan slot; until then this is always hollow.
  const cal = macros.calories ?? null;
  const showMeter = plannedTarget != null && !stale && cal != null;
  const meterPct = showMeter
    ? Math.max(0, Math.min(1, cal / plannedTarget!))
    : 0;

  // ── Day-projected header (REQ-003) ────────────────────────────────────────────
  // Only shown in create mode, when day context was provided, and draft has items.
  const thisMealCal   = macros.calories  ?? 0;
  const thisMealProt  = macros.proteinG  ?? 0;
  const thisMealCarbs = macros.carbsG    ?? 0;
  const thisMealFat   = macros.fatG      ?? 0;

  const hasItems = effectiveItems.length > 0;

  // "showDayContext": create mode + caller provided trackedSoFar.
  // dayTarget may be null (no plan) — that's the "hollow + honest" path below.
  const showDayContext = !isEdit && trackedSoFar != null;

  const projectedCal   = showDayContext ? trackedSoFar!.calories + thisMealCal   : null;
  const projectedProt  = showDayContext ? trackedSoFar!.proteinG  + thisMealProt  : null;
  const projectedCarbs = showDayContext ? trackedSoFar!.carbsG    + thisMealCarbs : null;
  const projectedFat   = showDayContext ? trackedSoFar!.fatG      + thisMealFat   : null;

  // Bullseye progress for the enriched header.
  // Only compute when dayTarget is present and positive.
  const dayTargetCal = dayTarget?.calories ?? 0;
  const projectedProgress =
    showDayContext && dayTarget != null && dayTargetCal > 0 && hasItems
      ? Math.max(0, Math.min(1, projectedCal! / dayTargetCal))
      : null;

  // Remaining: positive = budget, negative = over.
  // Over-target uses words, never color alone (UXR-lib-20, a11y).
  const remainingCal =
    showDayContext && dayTarget != null && projectedCal != null
      ? dayTargetCal - projectedCal
      : null;
  const isOver = remainingCal != null && remainingCal < 0;

  // ── addItemToComposer — the `addItem` callback passed to useFoodComposer ────
  // SINGLE MACRO AUTHORITY: the hook no longer touches macros; this function owns
  // the total and derives it from the items array — symmetric with
  // updateItemAmountUnit/requestRemoveItem. That invariant (total ===
  // sumStructuredMacros(items) + residual) is what fixes the phantom-residual /
  // "cached values" bug; the old add path summed food×servings independently and the
  // gap accreted into residual.
  // B-2: compute `next`/`newMacros` OUTSIDE all setters; call setters sequentially.
  // B-3: this is the ONLY add path for food-resolved items; setItemsText is NEVER
  //       called from food-resolved add paths.
  function addItemToComposer(item: NutritionItem): void {
    if (rawMode) {
      // rawMode: append text only; snapshotHash is NOT reset (rawMode is always
      // considered stale — intentional; user hits Recompute to reconcile). Items are
      // freehand text here (not structured), so bump the total by the item's own
      // contribution rather than re-summing structured items. recalcItemMacros is
      // null for a freehand "Add anyway" item → leave macros untouched.
      const line = item.qty ? `${item.name} | ${item.qty}` : item.name;
      setRawText((prev) => prev + (prev.trim() ? "\n" : "") + line);
      const added = recalcItemMacros(item);
      if (added) {
        const newMacros = addMacroValues(macros, added);
        handleMacrosChanged(macros, newMacros); // flash BEFORE set (UXR-lib-16)
        setMacros(newMacros);
      }
      return;
    }
    // B-2: next/newMacros computed outside any setter; sequential calls below.
    const next = [...items, item];
    setItems(next);
    setSnapshotHash(hashItems(next));
    // Structured item → recompute the total from items, preserving the freehand
    // residual. Freehand item (no source, e.g. "Add anyway") contributes nothing to
    // the structured sum, so the total is unchanged — matches prior behavior.
    if (item.source) {
      const newMacros = recomposeWithResidual(macros, items, next);
      handleMacrosChanged(macros, newMacros); // flash BEFORE set (UXR-lib-16)
      setMacros(newMacros);
    }
  }

  // ── updateItemAmountUnit — T2 transition (structured amount/unit change) ───
  // Full re-sum approach (B-1 fix): captures residual → rebuilds next → recomposes.
  // Sequential setters (B-2 fix): no setter inside another setter.
  function updateItemAmountUnit(idx: number, amount: number, unit: string): void {
    // Build updated items array (refreshes qty display string too), then recompose
    // the total from items while preserving the freehand/manual residual.
    const next = items.map((it, j) =>
      j === idx
        ? { ...it, amount, unit, qty: buildQtyDisplay(amount, unit, it.source!) }
        : it,
    );
    const newMacros = recomposeWithResidual(macros, items, next);

    // B-2: sequential setters — never inside a functional updater.
    setItems(next);
    setMacros(newMacros);
    setSnapshotHash(hashItems(next));
    // stale = (hashItems(next) !== snapshotHash of next) = false immediately ✓
  }

  // ── Food composer wiring ─────────────────────────────────────────────────
  // Food-resolved adds go through addItemToComposer (B-3 rule).
  // setItemsText / itemsText removed from the hook — rawMode text writes stay
  // in toggleRawMode (above) and are purely in MealComposer scope.
  const { controls, sheet } = useFoodComposer({
    addItem: addItemToComposer,
    quickPickFoods,
    libraryFoods,
  });

  // ── Item ops ───────────────────────────────────────────────────────────────
  function updateItemQty(index: number, delta: number) {
    setItems((prev) =>
      prev.map((it, i) =>
        i === index ? { ...it, qty: bumpQty(it.qty, delta) } : it,
      ),
    );
    // F5 — re-key the bumped numeral so its one-shot tick replays each tap.
    setBumpState((prev) => ({ idx: index, n: (prev?.n ?? 0) + 1 }));
  }
  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }
  // F4 — request a remove. Branches on item.source (T3 transition):
  //
  //   STRUCTURED item (source present): re-sum macros without this item → stays
  //     Fresh (no stale flag). No animation needed (instant remove).
  //
  //   FREEHAND / LEGACY item (no source): existing behavior — stale flag fires;
  //     user hits Recompute to reconcile the macro total. Animation plays.
  function requestRemoveItem(index: number) {
    const item = items[index];
    if (item?.source) {
      // T3 STRUCTURED PATH: recompute macros from items excluding this one → Fresh.
      const next = items.filter((_, i) => i !== index);
      const newMacros = recomposeWithResidual(macros, items, next);
      // B-2: sequential setters.
      setItems(next);
      setMacros(newMacros);
      setSnapshotHash(hashItems(next));
      return;
    }
    // FREEHAND / LEGACY PATH: existing behavior — stale flag fires.
    if (prefersReducedMotion()) {
      removeItem(index);
      return;
    }
    setRemovingIndex(index);
  }
  function moveItem(index: number, dir: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function toggleRawMode() {
    if (rawMode) {
      // Leaving raw → materialize rows
      setItems(parseItemsText(rawText));
      setRawMode(false);
    } else {
      setRawText(serializeItems(items));
      setRawMode(true);
    }
  }

  // ── Macro honesty ──────────────────────────────────────────────────────────
  function handleMacroChange(key: keyof MacroValues, val: number | null) {
    setMacros((prev) => ({ ...prev, [key]: val }));
    // Manual edit → Fresh (snapshot resets to current items).
    setSnapshotHash(hashItems(effectiveItems));
  }

  function handleRecompute() {
    startRecompute(async () => {
      const result = await estimateMealMacros(effectiveItems);
      setPreview(result);
    });
  }
  function applyRecompute() {
    if (!preview) return;
    // F6 — flash only the numerals that actually changed (NOT bullseye-pop;
    // UXR-meal-edit-27 cut). Compare before writing the new totals.
    const changed = new Set<string>();
    for (const k of FLASHABLE_MACROS) {
      if ((macros[k] ?? null) !== (preview.totals[k] ?? null)) changed.add(k);
    }
    setMacros({ ...preview.totals });
    setSnapshotHash(hashItems(effectiveItems)); // Apply → Fresh
    setPreview(null);
    setFlashMacros(changed.size > 0 ? { keys: changed, n: Date.now() } : null);
  }
  function cancelRecompute() {
    setPreview(null);
  }

  // ── Create reset ───────────────────────────────────────────────────────────
  function resetCreate() {
    setItems([]);
    setRawMode(false);
    setRawText("");
    setMealType(defaultMeal());
    setNotes("");
    setWhenDate(new Date());
    setMacros({
      calories: null,
      proteinG: null,
      carbsG: null,
      fatG: null,
      fiberG: null,
      sodiumMg: null,
    });
    setSnapshotHash(hashItems([]));
    setPreview(null);
    setClientError(null);
    setRemovingIndex(null);
    setBumpState(null);
    setFlashMacros(null);
  }

  // Flash macro numerals on the food-add path (UXR-lib-16).
  // Compares prev vs next to find which keys changed, then fires flashMacros.
  // Called from addItemToComposer (the single macro authority) right before setMacros.
  // applyRecompute() continues to set flashMacros directly — no double-fire because
  // applyRecompute does not route through addItemToComposer.
  function handleMacrosChanged(prev: MacroValues, next: MacroValues) {
    const changed = new Set<string>();
    for (const k of FLASHABLE_MACROS) {
      if ((prev[k] ?? null) !== (next[k] ?? null)) changed.add(k);
    }
    if (changed.size > 0) {
      setFlashMacros({ keys: changed, n: Date.now() });
    }
  }

  const unmatchedNames = preview
    ? preview.perItem.filter((p) => !p.matched).map((p) => p.name)
    : [];
  const matchedCount = preview
    ? preview.perItem.filter((p) => p.matched).length
    : 0;

  // F6 — render a macro numeral, re-keyed + tint-flashed when it just changed
  // via recompute-Apply (UXR-meal-edit-21). The whole flash set clears on the
  // first numeral's animationend (all run 270ms, so they finish together).
  function flashNumeral(key: string, value: number | null | undefined) {
    const flashing = flashMacros?.keys.has(key) === true;
    return (
      <span
        key={flashing ? `${key}-${flashMacros!.n}` : key}
        className={flashing ? "macro-flash px-0.5" : undefined}
        onAnimationEnd={flashing ? () => setFlashMacros(null) : undefined}
      >
        {macroNum(value)}
      </span>
    );
  }

  // ── Shared body (rendered inside the <form>) ─────────────────────────────────
  const lastIndex = items.length - 1;

  const body = (
    <>
      {/* Hidden submit fields consumed by logNutrition / updateNutrition */}
      <input type="hidden" name="mealType" value={mealType} />

      {/* ── Macro summary / projected header ──────────────────────────────────
          Sticky (UXR-meal-edit-14/29). Accent-soft-over-card wash.
          In create mode WITH day context: shows projected fill + remaining.
          All other modes (edit, no context): existing single-meal readout.
          ⚠ verify on iOS Safari with keyboard open — fallback = Direction C route. */}
      <div
        className="sticky top-0 z-10 rounded-xl border border-[var(--border)] px-4 py-3"
        style={{
          background: "linear-gradient(var(--accent-soft), var(--accent-soft)), var(--card)",
        }}
      >
        {showDayContext && hasItems ? (
          /* ── ENRICHED: projected vs today (REQ-003) ──────────────────────── */
          <>
            {/* Hero row: projected calories + size-24 Bullseye */}
            <div className="flex items-center gap-3">
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-[28px] font-semibold leading-none text-[var(--foreground)]">
                  {flashNumeral("calories", projectedCal ?? macros.calories)}
                </span>
                <span className="text-[13px] text-[var(--muted)]">cal</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {projectedProgress != null ? (
                  <Bullseye
                    size={24}
                    progress={projectedProgress}
                    aria-label={`Projected ${Math.round(projectedProgress * 100)}% of daily target`}
                    data-testid="composer-bullseye-meter"
                  />
                ) : (
                  /* No target: hollow */
                  <Bullseye
                    size={24}
                    aria-label="No daily target set"
                    data-testid="composer-bullseye-meter"
                  />
                )}
              </div>
            </div>
            {/* Macro P/C/F row */}
            <div className="mt-1 font-mono text-[13px] text-[var(--foreground)]">
              <span className="text-[var(--muted)]">P</span>{" "}
              {flashNumeral("proteinG", projectedProt)}{" "}
              <span className="mx-1 text-[var(--muted)]">·</span>
              <span className="text-[var(--muted)]">C</span>{" "}
              {flashNumeral("carbsG", projectedCarbs)}{" "}
              <span className="mx-1 text-[var(--muted)]">·</span>
              <span className="text-[var(--muted)]">F</span>{" "}
              {flashNumeral("fatG", projectedFat)}
            </div>

            {dayTarget != null ? (
              /* HAS TARGET: show full projected line + remaining */
              <>
                {/* "so far + this meal = projected / target" line */}
                <div
                  data-testid="composer-projected-line"
                  className="mt-2 text-xs uppercase tracking-wide text-[var(--muted)]"
                >
                  Today {Math.round(trackedSoFar!.calories)}{" "}
                  + this meal {Math.round(thisMealCal)}{" "}
                  = {Math.round(projectedCal!)} / {Math.round(dayTargetCal)} cal target
                </div>
                {/* Remaining / over — never color as the sole signal (a11y) */}
                <div
                  data-testid="composer-remaining"
                  className={`mt-1 ${
                    isOver
                      ? "text-[13px] font-semibold text-[var(--warning)]"
                      : "text-xs font-medium text-[var(--muted)]"
                  }`}
                >
                  {isOver
                    ? `−${Math.round(Math.abs(remainingCal!))} over target`
                    : `${Math.round(remainingCal!)} cal remaining`}
                </div>
              </>
            ) : (
              /* NO TARGET: honest degraded note */
              <p className="mt-2 text-xs text-[var(--muted)] italic">
                No plan set — showing what&apos;s been logged
              </p>
            )}
          </>
        ) : (
          /* ── FALLBACK: existing single-meal readout ───────────────────────── */
          /* This path runs for: edit mode, create with no day context, empty draft. */
          <>
            <div className="flex items-center gap-3">
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-[28px] font-semibold leading-none text-[var(--foreground)]">
                  {flashNumeral("calories", macros.calories)}
                </span>
                <span className="text-[13px] text-[var(--muted)]">cal</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Bullseye
                  size={24}
                  {...(showMeter
                    ? {
                        progress: meterPct,
                        "aria-label": `Meal macros at ${Math.round(meterPct * 100)} percent of target`,
                      }
                    : { "aria-label": "No macro target set" })}
                  data-testid="composer-bullseye-meter"
                />
                <span className="max-w-[92px] text-[11px] leading-tight text-[var(--muted)]">
                  {showMeter ? `${Math.round(meterPct * 100)}% · of target` : "no target"}
                </span>
              </div>
            </div>
            <div className="mt-2 font-mono text-[13px] text-[var(--foreground)]">
              <span className="text-[var(--muted)]">P</span> {flashNumeral("proteinG", macros.proteinG)}{" "}
              <span className="mx-1 text-[var(--muted)]">·</span>
              <span className="text-[var(--muted)]">C</span> {flashNumeral("carbsG", macros.carbsG)}{" "}
              <span className="mx-1 text-[var(--muted)]">·</span>
              <span className="text-[var(--muted)]">F</span> {flashNumeral("fatG", macros.fatG)}
            </div>
            {showDayContext && !hasItems && (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Add items to see projected totals
              </p>
            )}
          </>
        )}

        {/* ── Staleness flag + recompute — UNCHANGED (do not modify) ─────────── */}
        {stale && (
          <div
            className="stale-flag-in mt-3 flex flex-wrap items-center gap-2.5"
            aria-live="polite"
          >
            <span
              data-testid="macro-stale-flag"
              className="flex items-center gap-1.5 text-sm font-medium text-[var(--warning)]"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M8 1.2l6.6 12.2H1.4L8 1.2z" />
                <rect x="7.3" y="6" width="1.4" height="4" fill="var(--card)" />
                <rect x="7.3" y="11" width="1.4" height="1.4" fill="var(--card)" />
              </svg>
              Macros may be stale — items changed
            </span>
            <button
              type="button"
              data-testid="macro-recompute"
              onClick={handleRecompute}
              disabled={recomputing || effectiveItems.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] px-3 py-2 text-[13px] font-semibold text-[var(--accent)] disabled:opacity-50"
            >
              ⟳ {recomputing ? "Recomputing…" : "Recompute from items"}
            </button>
          </div>
        )}

        {/* ── Recompute preview — UNCHANGED (do not modify) ──────────────────── */}
        {preview && (
          <div
            className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5"
            aria-live="polite"
          >
            <p className="sr-only">
              Recompute preview: {matchedCount} item{matchedCount === 1 ? "" : "s"} matched,{" "}
              {preview.unmatchedCount} item{preview.unmatchedCount === 1 ? "" : "s"} with no estimate.
            </p>
            <p className="text-xs font-medium text-[var(--muted)]">Proposed totals</p>
            <p className="mt-1 font-mono text-[13px] text-[var(--foreground)]">
              {macroNum(preview.totals.calories)} cal
              <span className="mx-1 text-[var(--muted)]">·</span>P{" "}
              {macroNum(preview.totals.proteinG)}
              <span className="mx-1 text-[var(--muted)]">·</span>C{" "}
              {macroNum(preview.totals.carbsG)}
              <span className="mx-1 text-[var(--muted)]">·</span>F{" "}
              {macroNum(preview.totals.fatG)}
            </p>
            {preview.unmatchedCount > 0 && (
              <p className="mt-1.5 text-sm font-medium text-[var(--warning)]">
                {preview.unmatchedCount} item
                {preview.unmatchedCount === 1 ? "" : "s"} had no estimate
                {unmatchedNames.length > 0 && (
                  <span className="font-normal text-[var(--muted)]">
                    {" "}
                    — {unmatchedNames.join(", ")}
                  </span>
                )}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                data-testid="macro-recompute-apply"
                onClick={applyRecompute}
                className="flex-1 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-fg)] min-h-[44px]"
              >
                Apply
              </button>
              <button
                type="button"
                data-testid="macro-recompute-cancel"
                onClick={cancelRecompute}
                className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] min-h-[44px]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Items ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Items
        </span>
        <button
          type="button"
          data-testid="items-raw-toggle"
          onClick={toggleRawMode}
          className="text-xs text-[var(--accent)]"
        >
          {rawMode ? "Structured rows" : "Edit as text"}
        </button>
      </div>

      {rawMode ? (
        <textarea
          name="items"
          rows={5}
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={
            "One item per line. Optional qty after a |\n97% beef | 8 oz\nKroger hamburger buns | 1"
          }
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm font-mono resize-y"
        />
      ) : (
        <>
          {/* Hidden serialized items — text fallback for rawMode / MCP path */}
          <textarea name="items" hidden readOnly value={serializeItems(items)} />
          {/* Authoritative structured items — read by logNutrition / updateNutrition.
              Empty string in rawMode → server falls back to text `items` field. */}
          <input
            type="hidden"
            name="itemsJson"
            value={rawMode ? "" : JSON.stringify(items)}
          />

          {items.length === 0 ? (
            <p className="text-sm text-[var(--muted)] italic">
              No items yet — add one below, e.g. &ldquo;medium banana&rdquo;.
            </p>
          ) : (
            <ul className="flex flex-col">
              {items.map((item, i) => {
                const isStructured = !!item.source;
                // Structured: compute unit options for the select (T2).
                const unitOptions = isStructured ? unitsForFood(item.source!) : [];
                const storedUnitInOptions = unitOptions.some((o) => o.key === item.unit);
                const canStep = !isStructured && hasNumericPrefix(item.qty);
                const bumping = bumpState?.idx === i;
                const exiting = removingIndex === i;
                return (
                  // F3/F4 — `item-row-anim` animates the grid row in on mount
                  // (@starting-style) and out when `.is-exiting` toggles; the
                  // inner wrapper clips the content so the collapse is clean.
                  // The splice runs on the grid-template-rows transitionend.
                  // NOTE: structured removes go through requestRemoveItem's instant
                  // path (no animation) — exiting will never be true for them.
                  <li
                    key={i}
                    data-testid="item-row"
                    className={`item-row-anim${exiting ? " is-exiting" : ""}`}
                    onTransitionEnd={(e) => {
                      if (
                        e.propertyName === "grid-template-rows" &&
                        removingIndex === i
                      ) {
                        removeItem(i);
                        setRemovingIndex(null);
                      }
                    }}
                  >
                    <div className="item-row-inner border-b border-[var(--border)] px-1 py-2.5">
                      {/* Name + move buttons — UNCHANGED */}
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex-1 text-sm ${
                            item.name
                              ? "text-[var(--foreground)]"
                              : "text-[var(--muted)]"
                          }`}
                        >
                          {item.name || "Unnamed item"}
                        </span>
                        <div className="flex flex-col rounded-lg border border-[var(--border)] text-[var(--muted)]">
                          <button
                            type="button"
                            data-testid="item-move-up"
                            aria-label={`Move ${item.name} up`}
                            disabled={i === 0 || removingIndex !== null}
                            onClick={() => moveItem(i, -1)}
                            className="px-1.5 leading-none disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            data-testid="item-move-down"
                            aria-label={`Move ${item.name} down`}
                            disabled={i === lastIndex || removingIndex !== null}
                            onClick={() => moveItem(i, 1)}
                            className="px-1.5 leading-none disabled:opacity-30"
                          >
                            ↓
                          </button>
                        </div>
                      </div>

                      {/* Qty row — BRANCHED on item.source */}
                      {isStructured ? (
                        /* ── Structured row: amount input + unit select (T2) ── */
                        <div className="mt-2 flex items-center gap-2.5">
                          <input
                            type="number"
                            inputMode="decimal"
                            aria-label={`Amount for ${item.name}`}
                            // Render 0/empty as a blank, clearable field: an empty
                            // input parses to 0, and `?? ""` would pin a stuck "0"
                            // the user can't delete. `|| ""` shows it blank instead.
                            value={item.amount || ""}
                            placeholder="0"
                            min={0}
                            step="any"
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              updateItemAmountUnit(
                                i,
                                isFinite(v) && v >= 0 ? v : 0,
                                item.unit ?? "g",
                              );
                            }}
                            className="w-20 min-h-[44px] rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base text-center font-mono"
                          />
                          <select
                            aria-label={`Unit for ${item.name}`}
                            value={item.unit ?? ""}
                            onChange={(e) =>
                              updateItemAmountUnit(i, item.amount ?? 1, e.target.value)
                            }
                            className="flex-1 min-h-[44px] rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                          >
                            {/* S-3: disabled fallback when stored unit no longer in snapshot */}
                            {!storedUnitInOptions && item.unit && (
                              <option key="__stored" value={item.unit} disabled>
                                {item.unit} (not available)
                              </option>
                            )}
                            {unitOptions.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            data-testid="item-remove"
                            aria-label={`Remove ${item.name}`}
                            disabled={removingIndex !== null}
                            onClick={() => requestRemoveItem(i)}
                            className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--danger)] disabled:opacity-30"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        /* ── Freehand / legacy row: existing stepper (UNCHANGED) ── */
                        <div className="mt-2 flex items-center gap-2.5">
                          <button
                            type="button"
                            data-testid="item-qty-dec"
                            aria-label={`Decrease ${item.name} quantity`}
                            disabled={!canStep}
                            onClick={() => updateItemQty(i, -1)}
                            className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] text-xl leading-none text-[var(--accent)] disabled:opacity-30"
                          >
                            −
                          </button>
                          {/* F5 — re-keyed so the one-shot tick replays each tap. */}
                          <span
                            key={bumping ? `bump-${bumpState!.n}` : "static"}
                            className={`min-w-[62px] text-center font-mono text-sm text-[var(--foreground)]${
                              bumping ? " qty-bump" : ""
                            }`}
                          >
                            {item.qty || "—"}
                          </span>
                          <button
                            type="button"
                            data-testid="item-qty-inc"
                            aria-label={`Increase ${item.name} quantity`}
                            disabled={!canStep}
                            onClick={() => updateItemQty(i, 1)}
                            className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] text-xl leading-none text-[var(--accent)] disabled:opacity-30"
                          >
                            ＋
                          </button>
                          <button
                            type="button"
                            data-testid="item-remove"
                            aria-label={`Remove ${item.name}`}
                            disabled={removingIndex !== null}
                            onClick={() => requestRemoveItem(i)}
                            className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--danger)] disabled:opacity-30"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* ── Add item (chips / scan / estimate) — inside the form ─────────────── */}
      {controls}

      {/* ── Meal type chips ─────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Meal
        </p>
        <div className="flex flex-wrap gap-2">
          {MEAL_TYPES.map((m) => {
            const selected = m.value === mealType;
            return (
              <button
                key={m.value}
                type="button"
                data-testid="mealtype-chip"
                aria-pressed={selected}
                onClick={() => setMealType(m.value)}
                className={`inline-flex min-h-[38px] items-center rounded-full border px-3.5 text-[13px] ${
                  selected
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted)]"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── When nudges ─────────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          When
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="when-nudge"
            onClick={() => setWhenDate((d) => shiftWallClock(d, { days: -1 }))}
            className="inline-flex min-h-[38px] items-center rounded-full border border-[var(--border)] px-3.5 text-[13px] text-[var(--muted)]"
          >
            Yesterday
          </button>
          <button
            type="button"
            data-testid="when-nudge"
            onClick={() => setWhenDate((d) => shiftWallClock(d, { hours: -2 }))}
            className="inline-flex min-h-[38px] items-center rounded-full border border-[var(--border)] px-3.5 text-[13px] text-[var(--muted)]"
          >
            −2h
          </button>
          <button
            type="button"
            data-testid="when-nudge"
            onClick={() => setWhenDate(new Date())}
            className="inline-flex min-h-[38px] items-center rounded-full border border-[var(--border)] px-3.5 text-[13px] text-[var(--muted)]"
          >
            Now
          </button>
          <span className="ml-1 text-xs text-[var(--muted)]">
            {formatResolvedWhen(whenDate)}
          </span>
          <button
            type="button"
            onClick={() => setShowExactTime((s) => !s)}
            className="text-xs text-[var(--accent)]"
          >
            {showExactTime ? "hide" : "exact time"}
          </button>
        </div>
        {/* Single name="date" — submits whether shown or hidden. */}
        <input
          type="datetime-local"
          name="date"
          hidden={!showExactTime}
          value={toDatetimeLocalValue(whenDate)}
          onChange={(e) => {
            const d = new Date(e.target.value);
            if (!Number.isNaN(d.getTime())) setWhenDate(d);
          }}
          className="mt-2 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </div>

      {/* ── Notes — unified single textarea for both modes ──────────────────── */}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Notes
        </span>
        <textarea
          name="notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="meal notes (optional)"
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-none"
        />
      </label>

      {/* ── Macro manual entry ──────────────────────────────────────────────── */}
      <MacroInputs values={macros} onChange={handleMacroChange} />
    </>
  );

  // ── Mode-specific shells ─────────────────────────────────────────────────────
  if (isEdit) {
    return (
      <>
        <form
          data-testid="meal-composer"
          action={(fd) =>
            startEdit(async () => {
              setEditError(null);
              if (emptyDraft) {
                setEditError("Add at least one item, or enter macros below.");
                return;
              }
              try {
                await updateNutrition(props.id, fd);
                // Quiet confirm (UXR-18): flip to ✓ and hold ~150ms so the
                // crossfade is seen before onSaved closes the sheet. NOT
                // bullseye-pop — an edit-save is housekeeping, not a win.
                setEditSaved(true);
                await new Promise((r) => setTimeout(r, 150));
                props.onSaved?.();
              } catch (e) {
                if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
                setEditSaved(false);
                setEditError(e instanceof Error ? e.message : String(e));
              }
            })
          }
          className="flex flex-col gap-3"
        >
          {body}

          {editError && (
            <p className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
              {editError}
            </p>
          )}

          {/* STICKY footer (UXR-meal-edit-14/29): pins Save above the soft
              keyboard inside the sheet's scroll container. -mx-4/px-4 bleed to
              the panel edges; the card bg lets content scroll under it.
              ⚠ verify on iOS Safari with keyboard open; fallback = Direction C
              full-page route. */}
          <div className="sticky bottom-0 z-10 -mx-4 flex gap-2 border-t border-[var(--border)] bg-[var(--card)] px-4 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-3">
            <button
              type="submit"
              data-testid="meal-composer-save"
              disabled={editPending || editSaved}
              aria-live="polite"
              className="relative flex-1 rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              {/* label↔icon opacity crossfade (~150ms), reduced-motion snaps. */}
              <span
                className={`save-confirm-fade ${editSaved ? "opacity-0" : "opacity-100"}`}
              >
                {editPending ? "Saving…" : "Save"}
              </span>
              <span
                aria-hidden
                className={`save-confirm-fade absolute inset-0 flex items-center justify-center ${
                  editSaved ? "opacity-100" : "opacity-0"
                }`}
              >
                ✓ Saved
              </span>
            </button>
            <ConfirmButton
              label="Delete"
              confirmLabel="Delete meal · confirm"
              disabled={editPending || editSaved}
              variant="danger"
              // Non-destructive (UXR-meal-edit-13): DO NOT mutate the server
              // here. Hand the host a restore snapshot; the host defers (sheet
              // host: ~5s Undo window) or commits immediately (full-page host).
              onConfirm={() =>
                props.onDeleted?.({
                  id: props.id,
                  mealType,
                  items: effectiveItems,
                  notes,
                  date: toDatetimeLocalValue(whenDate),
                  macros,
                })
              }
              className="rounded-lg border border-[var(--danger)]/40 px-3 py-2 text-sm text-[var(--danger)]"
            />
          </div>
        </form>
        {sheet}
      </>
    );
  }

  // create
  return (
    <>
      <form
        data-testid="meal-composer"
        ref={createFormRef}
        onSubmit={(e) => {
          e.preventDefault();
          if (emptyDraft) {
            setClientError("Add at least one item, or enter macros below.");
            return;
          }
          setClientError(null);
          createSubmit(logNutrition, {
            successMsg: "✓ Meal logged",
            onSuccess: () => {
              resetCreate();
              props.onLogged?.();
            },
          });
        }}
        className="flex flex-col gap-3"
      >
        {body}

        <p className="min-h-[1rem] text-xs" aria-live="polite">
          {createSaved && (
            <span className="text-[var(--success)]">{createSaved}</span>
          )}
          {(clientError || createError) && !createSaved && (
            <span className="text-[var(--danger)]">{clientError ?? createError}</span>
          )}
        </p>

        <button
          type="submit"
          data-testid="meal-composer-save"
          disabled={createPending}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-[var(--accent-fg)] disabled:opacity-50"
        >
          {createPending ? "Saving…" : "Log meal"}
        </button>
      </form>
      {sheet}
    </>
  );
}
