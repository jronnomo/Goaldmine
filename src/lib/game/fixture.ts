// src/lib/game/fixture.ts
// FIXTURE_GAME_STATE for Stream C UI development.
// All values verified against levelFromXp (ATTR_LEVEL_BASE=60, OVERALL_LEVEL_BASE=150).
// DELETE this file after integration (REQ-009) is complete.

import type { GameState } from "@/lib/game/types";

// Level curve verification (ATTR_LEVEL_BASE=60):
//   Total XP to reach level L: 60 * L*(L-1)/2
//   L5=600, L6=900, L7=1260, L8=1680, L9=2160
// Overall curve (OVERALL_LEVEL_BASE=150):
//   L5=1500, L6=2250, L7=3150, L8=4200, L9=5400

export const FIXTURE_GAME_STATE: GameState = {
  goalKind: "fitness",
  level: 8,          // 4200 <= 4500 < 5400 → level 8 ✓
  xp: 4500,
  xpIntoLevel: 300,  // 4500 - 4200 = 300 ✓
  xpToNext: 1200,    // 150 * 8 = 1200 ✓
  progress: 0.25,    // 300/1200 ✓
  attributes: [
    { id: "STR", label: "Strength",     level: 8, xp: 1800, xpIntoLevel: 120, xpToNext: 480, progress: 0.25 },
    //   1680 <= 1800 < 2160 → L8 ✓; 1800-1680=120 ✓; 60*8=480 ✓
    { id: "END", label: "Endurance",    level: 5, xp:  720, xpIntoLevel: 120, xpToNext: 300, progress: 0.40 },
    //   600 <= 720 < 900 → L5 ✓; 720-600=120 ✓; 60*5=300 ✓
    { id: "MOB", label: "Mobility",     level: 5, xp:  630, xpIntoLevel:  30, xpToNext: 300, progress: 0.10 },
    //   600 <= 630 < 900 → L5 ✓; 630-600=30 ✓; 60*5=300 ✓
    { id: "CON", label: "Consistency",  level: 7, xp: 1350, xpIntoLevel:  90, xpToNext: 420, progress: 0.214 },
    //   1260 <= 1350 < 1680 → L7 ✓; 1350-1260=90 ✓; 60*7=420 ✓
  ],
  // Sum of attr xp: 1800+720+630+1350=4500 = overall xp (no unattributed in fixture) ✓
  streak: { current: 12, longest: 18, todayCounted: true },
  badges: [
    { def: { id: "first-blood",      name: "First Blood",        hint: "Complete your first workout",                      monogram: "1st" },                                       dateKey: "2026-03-01" },
    { def: { id: "on-record",        name: "On Record",          hint: "Set your first PR",                                monogram: "PR" },                                        dateKey: "2026-03-05" },
    { def: { id: "pr-machine",       name: "PR Machine",         hint: "Set 10 PRs",                                       monogram: "×10" },                                       dateKey: "2026-04-02" },
    { def: { id: "baseline-scholar", name: "Baseline Scholar",   hint: "Log all initial baseline tests",                   monogram: "BS" },                                        dateKey: "2026-03-08" },
    { def: { id: "trail-rat",        name: "Trail Rat",          hint: "Complete your first hike",                         monogram: "△",  glyphFamily: "mountain" as const },      dateKey: "2026-04-15" },
    { def: { id: "one-week-strong",  name: "One Week Strong",    hint: "Reach a 7-day streak",                             monogram: "7d", glyphFamily: "flame" as const },         dateKey: "2026-03-14" },
    { def: { id: "self-examined",    name: "Self-Examined",      hint: "Write your first weekly review",                   monogram: "✓" },                                         dateKey: "2026-03-22" },
    { def: { id: "retest-ritualist", name: "Retest Ritualist",   hint: "Complete a full baseline retest checkpoint",       monogram: "RT" },                                        dateKey: null },
    { def: { id: "vert-collector",   name: "Vert Collector",     hint: "Accumulate 10,000 ft elevation across all hikes",  monogram: "10k", glyphFamily: "mountain" as const },     dateKey: null },
    { def: { id: "high-pointer",     name: "High Pointer",       hint: "Complete a single hike with ≥3,000 ft elevation", monogram: "3k",  glyphFamily: "mountain" as const },     dateKey: null },
    { def: { id: "elbert-ready",     name: "Elbert Ready",       hint: "Complete a single hike with ≥4,000 ft elevation", monogram: "El",  glyphFamily: "mountain" as const },     dateKey: null },
    { def: { id: "fortnight-forge",  name: "Fortnight Forge",    hint: "Reach a 14-day streak",                           monogram: "14d", glyphFamily: "flame" as const },        dateKey: null },
    { def: { id: "iron-month",       name: "Iron Month",         hint: "Reach a 30-day streak",                           monogram: "30d", glyphFamily: "flame" as const },        dateKey: null },
    { def: { id: "set-centurion",    name: "Set Centurion",      hint: "Log 500 total sets",                              monogram: "5c" },                                        dateKey: null },
    { def: { id: "hundred-ton",      name: "Hundred-Ton Hauler", hint: "Lift 200,000 lb total volume",                    monogram: "HT" },                                        dateKey: null },
    { def: { id: "clean-week",       name: "Clean Week",         hint: "Log 7 consecutive days of 2+ nutrition entries",  monogram: "7N" },                                        dateKey: null },
  ],
  recentEvents: [
    { dateKey: "2026-06-09", ruleId: "pr.set",            label: "PR · Bench Press",                   xp: 40, attribute: "STR" },
    { dateKey: "2026-06-09", ruleId: "workout.completed",  label: "Upper workout",                      xp: 25, attribute: "STR" },
    { dateKey: "2026-06-09", ruleId: "adherence.day",      label: "Plan adherence",                     xp: 10, attribute: "CON" },
    { dateKey: "2026-06-08", ruleId: "bonus.coach",        label: "Coach: Pushed through on 4h sleep",  xp: 25, attribute: "END" },
    { dateKey: "2026-06-08", ruleId: "workout.completed",  label: "Zone 2 / Mobility",                  xp: 25, attribute: "MOB" },
    { dateKey: "2026-06-07", ruleId: "hike.completed",     label: "Hike completed",                     xp: 60, attribute: "END" },
    { dateKey: "2026-06-06", ruleId: "workout.completed",  label: "Calisthenics",                       xp: 25, attribute: "STR" },
    { dateKey: "2026-06-05", ruleId: "nutrition.day",      label: "Nutrition logged",                   xp:  5, attribute: "CON" },
    { dateKey: "2026-06-04", ruleId: "baseline.logged",    label: "Baseline · Plank",                   xp: 20, attribute: "CON" },
    { dateKey: "2026-06-04", ruleId: "baseline.onTime",    label: "Baseline on time · Plank",           xp: 10, attribute: "CON" },
  ],
  questToday: {
    projectedXp: 70,
    earnedXp: 75,
    earnedEvents: [
      { dateKey: "2026-06-09", ruleId: "workout.completed", label: "Upper workout",    xp: 25, attribute: "STR" },
      { dateKey: "2026-06-09", ruleId: "pr.set",            label: "PR · Bench Press", xp: 40, attribute: "STR" },
      { dateKey: "2026-06-09", ruleId: "adherence.day",     label: "Plan adherence",   xp: 10, attribute: "CON" },
    ],
    complete: true,
    bonusHints: ["PR chance +40 STR"],
  },
};
