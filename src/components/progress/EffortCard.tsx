// src/components/progress/EffortCard.tsx
//
// Manifest key 10 — "Effort this Program" (UXR-PROG-42/43/44). THE one game
// signal on this page, and the ONLY one, governed by two rules recorded here
// verbatim so future proposals arrive pre-answered:
//
//   R-GAME  — no monotone number may share a viewport with a number that can
//             regress, unless the monotone number is scoped to the same
//             bounded window as the honest one.
//   R-SPLIT — /character shows game STATE (levels, totals, badges, streaks —
//             monotone, lifetime); /progress shows game DELTAS scoped to the
//             Program window (bounded, resettable, can be zero). NO number
//             appears on both surfaces. Checkable: a TOTAL → /character; a
//             change over the Program window → here.
//
// Spec (UXR-PROG-43): four labelled rows sorted desc; max-normalized bars in
// var(--muted) — NEVER --accent; NO role="progressbar" — the block is one
// role="img" whose aria-label lists all four values (that triple distinction
// is what stops these reading as XpBar/AttributeBar). Label "Strength ·
// 340 XP", never "Strength +340". Footnote "Effort, not outcome." Zero
// window XP → EmptyState, never four rows of 0 XP. Zero-Program → the key is
// absent entirely (never a substituted 30-day window).
//
// UXR-PROG-45: streaks NEVER move here (suppressesExpectation is render-
// layer-only — a streak here would count observance days as misses).
// UXR-PROG-46: ReachMeter is forbidden on /progress (rolling targets are
// permanently "unknown" to the rarity engine — a frozen decoration beside a
// live measurement).
//
// Server component; zero motion (a bar is a fact, not an event).

import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import type { EffortModel } from "@/lib/progress-data";

export function EffortCard({ model }: { model: EffortModel }) {
  const rows = [...model.rows].sort((a, b) => b.xp - a.xp);
  const total = rows.reduce((s, r) => s + r.xp, 0);
  const max = rows.reduce((m, r) => Math.max(m, r.xp), 0);

  if (total === 0) {
    return (
      <Card data-testid="effort-card" title="Effort this Program">
        <EmptyState
          title="No effort logged in this Program yet"
          body="Attribute XP lands here as you train — scoped to this Program's window, so it can be zero and can reset."
        />
      </Card>
    );
  }

  const ariaLabel = `Effort this Program: ${rows
    .map((r) => `${r.label} ${r.xp} XP`)
    .join(", ")}`;

  return (
    <Card data-testid="effort-card" title="Effort this Program">
      <div role="img" aria-label={ariaLabel}>
        <div aria-hidden="true" className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2" data-testid={`effort-row-${r.id}`}>
              <span className="w-24 shrink-0 truncate text-sm">{r.label}</span>
              <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--border)]/60">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-[var(--muted)]"
                  style={{ width: `${max > 0 ? Math.round((r.xp / max) * 100) : 0}%` }}
                />
              </span>
              <span className="w-20 shrink-0 text-right text-sm tabular-nums">
                {r.xp.toLocaleString("en-US")} XP
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs italic text-[var(--muted)]">Effort, not outcome.</p>
    </Card>
  );
}
