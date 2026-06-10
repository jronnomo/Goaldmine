// src/components/game/XpBar.tsx
// Accessible overall or per-attribute XP progress bar.
// Server component — no "use client".

type XpBarProps = {
  value: number;
  max: number;
  label?: string;
  "data-testid"?: string;
};

export function XpBar({ value, max, label, "data-testid": testId }: XpBarProps) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;

  return (
    <div className="flex items-center gap-2 w-full" data-testid={testId}>
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? `${value} of ${max} XP`}
        className="flex-1 h-1.5 rounded-full overflow-hidden"
        style={{ background: "var(--accent-soft)" }}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${Math.round(pct * 100)}%`,
            background: "var(--accent)",
          }}
        />
      </div>
      {label && (
        <span
          className="text-xs tabular-nums shrink-0"
          style={{ color: "var(--muted)" }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
