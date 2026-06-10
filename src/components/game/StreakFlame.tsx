// src/components/game/StreakFlame.tsx
// Hand-rolled streak flame SVG + count. Server component — no "use client".
// House style: 16–20px, currentColor via var(--warning), single-path approach.
// Active = filled; broken/0 = hollow stroked outline only.

type StreakFlameProps = {
  count: number;
  active: boolean;
};

export function StreakFlame({ count, active }: StreakFlameProps) {
  return (
    <div
      className="flex items-center gap-1 shrink-0"
      data-testid="streak-flame"
      // SR text: visible count + state (glyph is aria-hidden)
      aria-label={`${count} day streak${active ? "" : " — broken"}`}
    >
      {/* Flame SVG — 18px, single path, currentColor = var(--warning) */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        style={{ color: "var(--warning)" }}
      >
        {active ? (
          // Filled flame: solid path
          <path
            d="M10 2C10 2 6 6.5 6 10a4 4 0 0 0 8 0c0-1.5-1-3-1-3s-0.5 1.5-2 2c0-2-1-3-1-5z
               M9 14.5c-1 0-2-0.5-2-1.5 0-0.8 0.6-1.4 1-2 0.3 0.8 1 1.4 1.5 1.8 0.3-0.6 0.5-1.2 0.5-1.8
               0.4 0.6 0.5 1.2 0.5 1.8 0.5-0.4 1.2-1 1.5-1.8 0.4 0.6 1 1.2 1 2 0 1-1 1.5-2 1.5z"
            fill="currentColor"
          />
        ) : (
          // Hollow flame: stroked outline
          <path
            d="M10 2C10 2 6 6.5 6 10a4 4 0 0 0 8 0c0-1.5-1-3-1-3s-0.5 1.5-2 2c0-2-1-3-1-5z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      <span
        className="text-sm font-semibold tabular-nums"
        style={{ color: active ? "var(--warning)" : "var(--muted)" }}
      >
        {count}
      </span>
    </div>
  );
}
