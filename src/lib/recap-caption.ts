// src/lib/recap-caption.ts
// Pure, deterministic caption composer for weekly recap sharing (Instagram / build-in-public).
// Goal-generic: zero hardcoded verticals or currency amounts — all content derives from
// the WeeklyRecap bundle produced by computeWeeklyRecap().
//
// Instagram caption limit: 2,200 Unicode codepoints (characters).
// JavaScript String.length counts UTF-16 code units, which is >= codepoints for any valid
// string (surrogate-pair emoji inflate .length, never shrink it). Using .length <= 2200
// is therefore a safe CONSERVATIVE proxy — it may trim slightly early on emoji-heavy
// captions, but it can never let an over-limit caption through.

import type { WeeklyRecap, RecapHighlight, ResolvedStatSlot } from "@/lib/recap";

// Hashtag map — extend here for new goal kinds; no other file changes needed.
// Partial<Record> makes the value type string | undefined so the ?? fallback
// is type-visible and the compiler will flag any attempt to remove it.
const KIND_HASHTAG: Partial<Record<string, string>> = {
  fitness: "#fitness",
  project: "#projectgoal",
};

// ─── Section builders ────────────────────────────────────────────────────────

/**
 * Build the opener line.
 *
 * Branch priority is driven by goal.kind FIRST (FIX-3):
 *   - kind === "project" → weeks-to-target frame (if header.weeksToTarget != null)
 *   - kind === "fitness" / null / unknown → program-week frame (if header.programWeek != null)
 *   - fallback → date-range-only
 *
 * This prevents a project goal from being assigned a fitness "Week N · Day M" opener
 * when both programWeek and weeksToTarget happen to be non-null simultaneously
 * (i.e. a project focus goal while an active fitness plan also exists).
 */
function buildOpener(recap: WeeklyRecap): string {
  const { header, goal, dateRangeLabel } = recap;
  const kind = goal?.kind ?? null;

  if (kind === "project" && header.weeksToTarget !== null) {
    const toDate = header.targetDateLabel ?? "target";
    const body = goal?.objective ?? dateRangeLabel;
    return `${header.weeksToTarget} weeks to ${toDate} — ${body}`;
  }

  if (kind !== "project" && header.programWeek !== null) {
    const day = header.dayOfProgram ?? "?";
    const body = goal?.objective ?? dateRangeLabel;
    return `Week ${header.programWeek} · Day ${day} — ${body}`;
  }

  // No goal / someday / mismatched kind+header combo
  if (header.weeksToTarget !== null) {
    const toDate = header.targetDateLabel ?? "target";
    const body = goal?.objective ?? dateRangeLabel;
    return `${header.weeksToTarget} weeks to ${toDate} — ${body}`;
  }

  return dateRangeLabel;
}

/**
 * Build the highlight callout line.
 * Template: "${icon} ${label}${meta ? ` — ${meta}` : ""}${sub ? ` — ${sub}` : ""}"
 * (label is the name; meta carries the stats since the card split them onto two lines)
 */
function buildHighlight(h: RecapHighlight): string {
  const head = h.meta !== null ? `${h.icon} ${h.label} — ${h.meta}` : `${h.icon} ${h.label}`;
  return h.sub !== null ? `${head} — ${h.sub}` : head;
}

/**
 * Build the stats line from resolved stat slots.
 * Null slots (isNull: true) are skipped — goal-generic, never hardcodes labels.
 * Returns "" when all slots are null — caller must guard before pushing.
 */
function buildStatsLine(slots: ResolvedStatSlot[]): string {
  const active = slots.filter((s) => !s.isNull);
  if (active.length === 0) return "";
  return active.map((s) => `${s.label} ${s.value}`).join(" · ");
}

/**
 * Build the hashtag section.
 * kind === null → no kind tag (no goal context to imply).
 * Unknown kind → "#goals" fallback via the Partial<Record> ?? chain.
 */
function buildHashtags(kind: string | null): string {
  const kindTag = kind !== null ? (KIND_HASHTAG[kind] ?? "#goals") : null;
  return ["#buildinpublic", kindTag, "#goaldmine"].filter(Boolean).join(" ");
}

// ─── Truncation ──────────────────────────────────────────────────────────────

const CAPTION_LIMIT = 2200;

/**
 * Rebuild caption WITHOUT the stats line (drops stats first — most expendable section).
 * Called when the full caption exceeds CAPTION_LIMIT.
 */
function rebuildWithoutStats(recap: WeeklyRecap, highlight: RecapHighlight | null): string {
  const sections: string[] = [];
  sections.push(buildOpener(recap));
  if (highlight !== null) sections.push(buildHighlight(highlight));
  // Stats line intentionally omitted
  if (recap.emptyWeek) sections.push("A quiet week — back at it.");
  if (recap.streakDays > 0) sections.push(`🔥 ${recap.streakDays}-day streak`);
  sections.push(buildHashtags(recap.goal?.kind ?? null));
  return sections.join("\n\n");
}

/**
 * Enforce the 2,200-character cap.
 *
 * Priority order (last to drop = highest priority):
 *   1. Opener   — identity, always required
 *   2. Hashtags — discoverability, always required
 *   3. Highlight — high engagement callout
 *   4. Streak   — social signal
 *   5. Stats    — most expendable; drops first
 *
 * Step 1: drop stats, rebuild.
 * Step 2: if still over limit, hard-trim to 2199 chars + "…" (U+2026, .length === 1).
 */
function truncateCaption(
  full: string,
  recap: WeeklyRecap,
  highlight: RecapHighlight | null,
): string {
  // Fast path — typical case, no truncation needed
  if (full.length <= CAPTION_LIMIT) return full;

  // Step 1: rebuild without the stats line
  const withoutStats = rebuildWithoutStats(recap, highlight);
  if (withoutStats.length <= CAPTION_LIMIT) return withoutStats;

  // Step 2: hard-trim (reachable only if opener alone is ~2200+ chars — very rare)
  // "…" is U+2026, a BMP character — .length === 1; slice(0,2199) + "…" = 2200 chars
  return withoutStats.slice(0, 2199) + "…";
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compose an Instagram caption from a fully-resolved WeeklyRecap bundle.
 *
 * Pure function — no I/O, no DB, no env reads. Safe to call in any context
 * (server component, client component, Vitest, Node script).
 *
 * @param recap    The weekly recap bundle (produced by computeWeeklyRecap).
 * @param highlight The featured highlight callout, or null to omit the section.
 * @returns A caption string guaranteed to be ≤ 2,200 characters.
 */
export function composeCaption(recap: WeeklyRecap, highlight: RecapHighlight | null): string {
  const sections: string[] = [];

  // 1. Opener — always present
  sections.push(buildOpener(recap));

  // 2. Highlight — omit when null
  if (highlight !== null) {
    sections.push(buildHighlight(highlight));
  }

  // 3. Stats OR quiet-week copy.
  // IMPORTANT: check emptyWeek BEFORE statSlots — an empty week can have non-null "0"
  // slots (e.g. WORKOUTS 0) that would be misleading if emitted. emptyWeek takes
  // precedence and suppresses all stats unconditionally.
  if (recap.emptyWeek) {
    sections.push("A quiet week — back at it.");
  } else {
    const statsLine = buildStatsLine(recap.statSlots);
    // Guard: if ALL slots are null, statsLine is "" — do not push (no dangling separator)
    if (statsLine) sections.push(statsLine);
  }

  // 4. Streak — omit when 0
  if (recap.streakDays > 0) {
    sections.push(`🔥 ${recap.streakDays}-day streak`);
  }

  // 5. Hashtags — always present
  sections.push(buildHashtags(recap.goal?.kind ?? null));

  const full = sections.join("\n\n");
  return truncateCaption(full, recap, highlight);
}
