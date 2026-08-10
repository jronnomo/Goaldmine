// src/components/SeamLine.tsx
//
// Pure server-rendered SVG sparkline (#290, UXR-PV-49/50 — R11: sparklines
// are a seam-line, NOT Recharts; a sparkline has no axes/tooltip/interaction
// and the house already hand-rolls Bullseye/ReachMeter/XpBar).
//
// Decoration-tier: one muted stroke, nothing else. Hard requirements from the
// research (each one is a regression test in SeamLine.test.ts):
//   - `preserveAspectRatio="none"` + `vector-effect="non-scaling-stroke"` —
//     the viewBox is stretched non-uniformly into the box, so the stroke must
//     not scale with it.
//   - NO terminal <circle> — non-uniform scale would render it as an ellipse.
//     The adjacent tabular-nums current value (rendered by the caller) is the
//     endpoint cue instead.
//   - 0 points → null (callers render a text hint, never an empty frame).
//   - 1 point → a flat rule across the box.
//   - min === max → every y at 50 (a flat series is a flat line mid-box).
//
// A11y: two-layer idiom — outer role="img" + aria-label, inner svg hidden.

export function SeamLine({
  points,
  width = 96,
  height = 20,
  stroke = "var(--muted)",
  ariaLabel,
  "data-testid": testId,
}: {
  points: readonly number[];
  width?: number;
  height?: number;
  stroke?: string;
  ariaLabel: string;
  "data-testid"?: string;
}) {
  if (points.length === 0) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  // Vertical padding (in 0..100 viewBox units) so extremes don't clip the stroke.
  const PAD = 8;
  const y = (v: number) =>
    max === min ? 50 : PAD + (1 - (v - min) / (max - min)) * (100 - 2 * PAD);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

  const coords =
    points.length === 1
      ? `0,${fmt(y(points[0]!))} 100,${fmt(y(points[0]!))}` // flat rule
      : points
          .map((v, i) => `${fmt((i / (points.length - 1)) * 100)},${fmt(y(v))}`)
          .join(" ");

  return (
    <span
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
      className="inline-block align-middle leading-none"
    >
      <svg
        aria-hidden="true"
        width={width}
        height={height}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="block"
      >
        <polyline
          points={coords}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}
