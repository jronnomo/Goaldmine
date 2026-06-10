// OtherGoalsStrip — SERVER COMPONENT
// Shows non-focus active goals' events for today and the next 7 days.
// Inserted between CharacterHeader and the hero section on the Today page.
//
// UXR-62-05: PRD-fixed placement (between CharacterHeader and hero); honored here.
// UXR-62-07: race-window ≤ 7d (today-strip loud threshold); lookahead horizon = 7 days.
// Anti-banner-blindness: renders null (no DOM node) when there is nothing to show.

import type { GoalEvent } from "@/lib/goal-events";
import type { CrossGoalConflict } from "@/lib/goal-conflicts";
import { addDays, dateKey, parseDateKey } from "@/lib/calendar";

// UXR-62-07: a target-date event within this many days from today triggers loud variant.
const RACE_WINDOW_DAYS = 7;

export function OtherGoalsStrip({
  events,
  conflicts,
  todayKey,
}: {
  events: GoalEvent[];
  conflicts: CrossGoalConflict[];
  todayKey: string;
}) {
  // Only non-focus events appear in the strip.
  const nonFocusEvents = events.filter((e) => !e.isFocusGoal);

  const todayDate = parseDateKey(todayKey);
  // Lookahead window: today through +6 days (7 days total).
  const weekEndKey = dateKey(addDays(todayDate, 6));

  const todayEvents = nonFocusEvents.filter((e) => e.dateKey === todayKey);
  const weekAheadEvents = nonFocusEvents.filter(
    (e) => e.dateKey > todayKey && e.dateKey <= weekEndKey,
  );
  const todayConflicts = conflicts.filter((c) => c.dateKey === todayKey);

  // Anti-banner-blindness: render nothing when empty (UXR-62-07).
  if (todayEvents.length === 0 && weekAheadEvents.length === 0 && todayConflicts.length === 0) {
    return null;
  }

  // Loudness: any target-date event within RACE_WINDOW_DAYS from today → loud variant.
  // UXR-62-06: loud = accent-soft bg + 2px var(--target) left rail.
  const nearestTargetDays = nonFocusEvents
    .filter((e) => e.type === "target-date")
    .map((e) => {
      const d = parseDateKey(e.dateKey);
      return Math.floor((d.getTime() - todayDate.getTime()) / (24 * 3600 * 1000));
    })
    .filter((d) => d >= 0)
    .sort((a, b) => a - b)[0];

  const isLoud =
    nearestTargetDays !== undefined && nearestTargetDays <= RACE_WINDOW_DAYS;

  // UXR-62-06: loud variant = accent-soft bg + 2px target left rail.
  const containerClass = isLoud
    ? "rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] border-l-2 border-l-[var(--target)] px-3 py-2.5 space-y-1.5"
    : "rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 space-y-1.5";

  return (
    <div
      data-testid={isLoud ? "other-goals-strip-loud" : "other-goals-strip"}
      className={containerClass}
      aria-label="Other goals this week"
    >
      {/* Today's events — "Also today: {icon} {label} — {objective}" */}
      {todayEvents.map((event) => (
        <div
          key={`${event.goalId}-${event.type}`}
          className="flex items-baseline gap-1.5 text-sm"
        >
          <span className="text-[var(--muted)] text-[10px] font-medium uppercase tracking-wide shrink-0">
            Also today:
          </span>
          {/* UXR-62-01/02: claim-ring foreign marker */}
          <span
            aria-hidden
            className="leading-none opacity-[0.65] shrink-0"
            style={{
              outline: "1px solid var(--muted)",
              outlineOffset: "1px",
              borderRadius: "9999px",
            }}
          >
            {event.icon}
          </span>
          <span className="font-medium">{event.label}</span>
          <span className="text-[var(--muted)] min-w-0 truncate">
            — {event.goalObjective}
          </span>
        </div>
      ))}

      {/* This-week lookahead — "This week: {icon} {label} (weekday)" in muted text */}
      {weekAheadEvents.length > 0 && (
        <p className="text-sm text-[var(--muted)] flex items-baseline gap-1 flex-wrap">
          <span className="text-[10px] font-medium uppercase tracking-wide shrink-0">
            This week:
          </span>
          {weekAheadEvents.map((event, idx) => {
            const weekday = parseDateKey(event.dateKey).toLocaleDateString(undefined, {
              weekday: "short",
            });
            return (
              <span key={`${event.goalId}-${event.type}-${event.dateKey}`} className="flex items-baseline gap-0.5">
                {idx > 0 && <span className="mx-0.5 text-[var(--border)]">·</span>}
                {/* UXR-62-01/02: claim-ring */}
                <span
                  aria-hidden
                  className="leading-none opacity-[0.65]"
                  style={{
                    outline: "1px solid var(--muted)",
                    outlineOffset: "1px",
                    borderRadius: "9999px",
                  }}
                >
                  {event.icon}
                </span>
                <span className="ml-0.5">{event.label}</span>
                <span className="text-[10px] ml-0.5">({weekday})</span>
              </span>
            );
          })}
        </p>
      )}

      {/* Cross-goal conflict touching today — UXR-62-09: ◣ glyph + label verbatim.
          Body copy in --foreground for AA contrast; --warning on the glyph only. */}
      {todayConflicts.map((c) => (
        <p key={`${c.dateKey}-${c.kind}`} className="text-sm flex items-baseline gap-1.5">
          <span className="text-[var(--warning)]" aria-hidden>
            ◣
          </span>
          <span className="text-[var(--foreground)]">{c.label}</span>
        </p>
      ))}
    </div>
  );
}
