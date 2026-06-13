// src/components/Bullseye.tsx
//
// Bullseye motif — single canonical SVG (viewBox 0 0 32 32) that scales to
// 6 / 10 / 14 / 20+ px and supports `filled`, hollow, and `progress=0..1` modes.
// Geometry per docs/ux-research/goaldmine-rebrand.md §2.
//
// Prop precedence (enforced statically by the discriminated union below):
//   - If `progress` is set, it controls the rings; `filled` is type-excluded.
//   - If `filled` is set, it controls the rings; `progress` is type-excluded.
//   - If neither is set, render the hollow base ring.
//
// Boundary fallthrough:
//   - size < 6   -> rendered as size=6 branch (single disc / hollow stroke).
//   - size > 20  -> rendered as size=20+ branch (full canonical 4-ring stack).
//
// A11y precedence:
//   - `aria-label` set -> role="img" + aria-label, decorative=false.
//   - `aria-hidden` explicitly set -> aria-hidden="true".
//   - Neither set -> default aria-hidden="true" (decorative).
import type { CSSProperties } from "react";

type BullseyeBase = {
  size?: number;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
};

type BullseyeA11y =
  | { "aria-label": string; "aria-hidden"?: never }
  | { "aria-hidden": true; "aria-label"?: never }
  | { "aria-label"?: undefined; "aria-hidden"?: undefined };

type BullseyeFill =
  | { filled: boolean; progress?: never }
  | { progress: number; filled?: never }
  | { filled?: undefined; progress?: undefined };

export type BullseyeProps = BullseyeBase & BullseyeA11y & BullseyeFill;

/**
 * Map (size, ringCount) -> JSX of concentric circles, center-out.
 * ringCount is the number of "filled steps" (0..maxForSize).
 *
 * Canonical 4-ring stack at size 20+:
 *   r=15 var(--target)  red outer
 *   r=11 var(--target-fg) white
 *   r=7  var(--target)  red
 *   r=3  var(--target-fg) white center dot
 *
 * For smaller sizes, we drop outer rings (the size IS the constraint —
 * tiny radii alternating get muddy on retina). Filled rings always grow
 * centripetally from the center out — fewer-ringed branches keep the
 * inner discs and drop the outer bands.
 */
function renderRings(size: number, ringCount: number): React.ReactNode {
  // Resolve size band.
  const band: 6 | 10 | 14 | 20 =
    size < 10 ? 6 : size < 14 ? 10 : size < 20 ? 14 : 20;

  if (ringCount <= 0) {
    // Hollow — a single thin stroke ring; no center dot.
    return (
      <circle
        cx={16}
        cy={16}
        r={14}
        fill="none"
        stroke="var(--muted)"
        strokeWidth={2}
      />
    );
  }

  // For each band, define the canonical filled stack as an array of
  // {r, fill}. Index 0 = outermost ring (drawn first), last = center dot.
  // Higher ringCount fills MORE rings; the "from center out" mapping means
  // we always keep the innermost N circles and drop outer ones beyond ringCount.
  const stacks: Record<typeof band, Array<{ r: number; fill: string }>> = {
    6: [{ r: 15, fill: "var(--target)" }],
    10: [
      { r: 15, fill: "var(--target)" },
      { r: 8, fill: "var(--target-fg)" },
    ],
    14: [
      { r: 15, fill: "var(--target)" },
      { r: 10, fill: "var(--target-fg)" },
      { r: 5, fill: "var(--target)" },
    ],
    20: [
      { r: 15, fill: "var(--target)" },
      { r: 11, fill: "var(--target-fg)" },
      { r: 7, fill: "var(--target)" },
      { r: 3, fill: "var(--target-fg)" },
    ],
  };

  const fullStack = stacks[band];
  const max = fullStack.length;
  const filledCount = Math.max(1, Math.min(max, ringCount));

  // Take the innermost `filledCount` rings (slice from the tail).
  const innerRings = fullStack.slice(max - filledCount);

  // Always render the canonical outer red disc behind partial fills so the
  // shape still reads as a bullseye when partially filled. (For full fill,
  // outer red is already in the slice.)
  const needsOuterShell = filledCount < max;

  return (
    <>
      {needsOuterShell && (
        <circle
          cx={16}
          cy={16}
          r={14}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={2}
        />
      )}
      {innerRings.map((ring) => (
        <circle key={ring.r} cx={16} cy={16} r={ring.r} fill={ring.fill} />
      ))}
    </>
  );
}

/**
 * Map a 0..1 progress value to discrete ring count by size band.
 *   size 6   -> {0, 1}                          step = 1.0
 *   size 10  -> {0, 1, 2}                       step = 0.5
 *   size 14  -> {0, 1, 2, 3}                    step ~= 0.33
 *   size 20+ -> {0, 1, 2, 3, 4}                 step = 0.25
 */
function progressToRings(size: number, progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  const max = size < 10 ? 1 : size < 14 ? 2 : size < 20 ? 3 : 4;
  // Snap by ceiling so progress > 0 always shows at least one inner ring,
  // EXCEPT at exactly progress === 0 (hollow).
  if (p === 0) return 0;
  return Math.max(1, Math.ceil(p * max));
}

export function Bullseye(props: BullseyeProps) {
  const {
    size = 16,
    className,
    style,
    "aria-label": ariaLabel,
    "aria-hidden": ariaHidden,
    "data-testid": dataTestId,
  } = props;
  const filled = "filled" in props ? props.filled : undefined;
  const progress = "progress" in props ? props.progress : undefined;

  // Decide ring count.
  let ringCount: number;
  if (typeof progress === "number") {
    ringCount = progressToRings(size, progress);
  } else if (filled === true) {
    ringCount = size < 10 ? 1 : size < 14 ? 2 : size < 20 ? 3 : 4;
  } else {
    // filled === false, filled === undefined, or no fill prop -> hollow.
    ringCount = 0;
  }

  // A11y: label wins; otherwise default hidden.
  const ariaProps =
    ariaLabel != null
      ? { role: "img" as const, "aria-label": ariaLabel }
      : ariaHidden
        ? { "aria-hidden": true as const }
        : { "aria-hidden": true as const };

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      data-testid={dataTestId}
      {...ariaProps}
    >
      {renderRings(size, ringCount)}
    </svg>
  );
}
