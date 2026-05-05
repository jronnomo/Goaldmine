// Goal-flavor presets — used by the GoalCreateForm flavor picker AND
// surfaceable to Claude in claude.ai via update_goal_legend's description
// (which ships its own compressed subset due to char-budget constraints
// in the MCP tool surface).
//
// Each flavor is a curated LegendEntry[] tuned for the activity. The flavor
// only constrains the icons/labels; the closed `kind` enum stays the same
// (trained / hike-completed / hike-planned / override / goal-date).
//
// Adding a new flavor:
//   1. Append a key+entry to FLAVOR_PRESETS below.
//   2. If it belongs in a new conceptual bucket, add a new <optgroup> in
//      GoalCreateForm.tsx and slot the slug there.
//   3. Update the user-facing description in update_goal_legend if budget
//      allows (presets there are intentionally a subset).
//
// "custom" is a sentinel — the form passes no legend, the goal lands with
// legend: null, Claude proposes one in claude.ai per rule 11.

import type { LegendEntry } from "@/lib/legend";

export type GoalFlavorKey =
  | "hike"
  | "strength"
  | "bodybuilding"
  | "running"
  | "trail-running"
  | "cycling"
  | "mtb"
  | "triathlon"
  | "swimming"
  | "rowing"
  | "climbing"
  | "snowboard"
  | "skiing"
  | "surf"
  | "crossfit"
  | "combat"
  | "martial-arts"
  | "volleyball"
  | "basketball"
  | "soccer"
  | "football"
  | "hockey"
  | "racquet"
  | "golf"
  | "yoga"
  | "dance"
  | "equestrian"
  | "paddle"
  | "archery"
  | "general"
  | "custom";

export type GoalFlavorPreset = {
  key: GoalFlavorKey;
  label: string;
  legend: LegendEntry[] | null; // null = no preset; goal saves with legend=null
};

const TRAINED: LegendEntry = { icon: "●", label: "Trained", kind: "trained" };

// All concrete presets. Each flavor includes `trained` plus 1-2 flavor-specific
// entries (override = the special intensity / event-prep day; goal-date = the
// target/race/event icon). Outdoor-leaning flavors also include hike-completed
// + hike-planned tied to the Hike model.
export const FLAVOR_PRESETS: Record<GoalFlavorKey, GoalFlavorPreset> = {
  hike: {
    key: "hike",
    label: "Hike / backpacking / mountaineering",
    legend: [
      TRAINED,
      { icon: "🥾", label: "Outdoor day", kind: "hike-completed" },
      { icon: "🥾", label: "Hike planned", kind: "hike-planned" },
      { icon: "★", label: "Custom day", kind: "override" },
      { icon: "🏔️", label: "Goal date", kind: "goal-date" },
    ],
  },
  strength: {
    key: "strength",
    label: "Strength / powerlifting / Olympic",
    legend: [
      TRAINED,
      { icon: "🏋️", label: "Heavy day", kind: "override" },
      { icon: "🏆", label: "Meet day", kind: "goal-date" },
    ],
  },
  bodybuilding: {
    key: "bodybuilding",
    label: "Bodybuilding / physique / contest prep",
    legend: [
      TRAINED,
      { icon: "💪", label: "Push day", kind: "override" },
      { icon: "📸", label: "Stage day", kind: "goal-date" },
    ],
  },
  running: {
    key: "running",
    label: "Running (road / track)",
    legend: [
      TRAINED,
      { icon: "🏃", label: "Long run", kind: "override" },
      { icon: "🥇", label: "Race day", kind: "goal-date" },
    ],
  },
  "trail-running": {
    key: "trail-running",
    label: "Trail running / ultra",
    legend: [
      TRAINED,
      { icon: "🥾", label: "Trail day", kind: "hike-completed" },
      { icon: "🥾", label: "Trail planned", kind: "hike-planned" },
      { icon: "🏃", label: "Long run", kind: "override" },
      { icon: "🏔️", label: "Race day", kind: "goal-date" },
    ],
  },
  cycling: {
    key: "cycling",
    label: "Cycling (road / gravel)",
    legend: [
      TRAINED,
      { icon: "🚴", label: "Long ride", kind: "override" },
      { icon: "🥇", label: "Event day", kind: "goal-date" },
    ],
  },
  mtb: {
    key: "mtb",
    label: "Mountain biking",
    legend: [
      TRAINED,
      { icon: "🚵", label: "Trail ride", kind: "override" },
      { icon: "🏆", label: "Race day", kind: "goal-date" },
    ],
  },
  triathlon: {
    key: "triathlon",
    label: "Triathlon / multisport",
    legend: [
      TRAINED,
      { icon: "🏊", label: "Brick day", kind: "override" },
      { icon: "🏁", label: "Race day", kind: "goal-date" },
    ],
  },
  swimming: {
    key: "swimming",
    label: "Swimming",
    legend: [
      TRAINED,
      { icon: "🏊", label: "Long swim", kind: "override" },
      { icon: "🏆", label: "Meet day", kind: "goal-date" },
    ],
  },
  rowing: {
    key: "rowing",
    label: "Rowing / erg",
    legend: [
      TRAINED,
      { icon: "🚣", label: "Long row", kind: "override" },
      { icon: "🏆", label: "Regatta", kind: "goal-date" },
    ],
  },
  climbing: {
    key: "climbing",
    label: "Rock climbing / bouldering",
    legend: [
      TRAINED,
      { icon: "🧗", label: "Send day", kind: "override" },
      { icon: "🏔️", label: "Project send", kind: "goal-date" },
    ],
  },
  snowboard: {
    key: "snowboard",
    label: "Snowboard",
    legend: [
      TRAINED,
      { icon: "🏂", label: "Ride day", kind: "override" },
      { icon: "🎿", label: "Season opener", kind: "goal-date" },
    ],
  },
  skiing: {
    key: "skiing",
    label: "Skiing (alpine / nordic)",
    legend: [
      TRAINED,
      { icon: "🎿", label: "Ski day", kind: "override" },
      { icon: "🏔️", label: "Big-mountain day", kind: "goal-date" },
    ],
  },
  surf: {
    key: "surf",
    label: "Surfing",
    legend: [
      TRAINED,
      { icon: "🏄", label: "Surf day", kind: "override" },
      { icon: "🏆", label: "Contest", kind: "goal-date" },
    ],
  },
  crossfit: {
    key: "crossfit",
    label: "CrossFit / functional / Hyrox",
    legend: [
      TRAINED,
      { icon: "🔥", label: "WOD", kind: "override" },
      { icon: "🏆", label: "Comp day", kind: "goal-date" },
    ],
  },
  combat: {
    key: "combat",
    label: "Combat sports (BJJ / MMA / boxing / wrestling)",
    legend: [
      TRAINED,
      { icon: "🥊", label: "Sparring", kind: "override" },
      { icon: "🥇", label: "Tournament", kind: "goal-date" },
    ],
  },
  "martial-arts": {
    key: "martial-arts",
    label: "Traditional martial arts (karate / TKD / kung fu)",
    legend: [
      TRAINED,
      { icon: "🥋", label: "Mat day", kind: "override" },
      { icon: "🏆", label: "Belt test", kind: "goal-date" },
    ],
  },
  volleyball: {
    key: "volleyball",
    label: "Volleyball",
    legend: [
      TRAINED,
      { icon: "🏐", label: "Game day", kind: "override" },
      { icon: "🏆", label: "Tournament", kind: "goal-date" },
    ],
  },
  basketball: {
    key: "basketball",
    label: "Basketball",
    legend: [
      TRAINED,
      { icon: "🏀", label: "Game day", kind: "override" },
      { icon: "🏆", label: "Playoffs", kind: "goal-date" },
    ],
  },
  soccer: {
    key: "soccer",
    label: "Soccer / football (intl)",
    legend: [
      TRAINED,
      { icon: "⚽", label: "Match day", kind: "override" },
      { icon: "🏆", label: "Final", kind: "goal-date" },
    ],
  },
  football: {
    key: "football",
    label: "American football",
    legend: [
      TRAINED,
      { icon: "🏈", label: "Game day", kind: "override" },
      { icon: "🏆", label: "Playoffs", kind: "goal-date" },
    ],
  },
  hockey: {
    key: "hockey",
    label: "Hockey / skating",
    legend: [
      TRAINED,
      { icon: "🏒", label: "Game day", kind: "override" },
      { icon: "🏆", label: "Playoffs", kind: "goal-date" },
    ],
  },
  racquet: {
    key: "racquet",
    label: "Racquet sports (tennis / pickleball / squash)",
    legend: [
      TRAINED,
      { icon: "🎾", label: "Match day", kind: "override" },
      { icon: "🏆", label: "Tournament", kind: "goal-date" },
    ],
  },
  golf: {
    key: "golf",
    label: "Golf",
    legend: [
      TRAINED,
      { icon: "⛳", label: "Round", kind: "override" },
      { icon: "🏆", label: "Tournament", kind: "goal-date" },
    ],
  },
  yoga: {
    key: "yoga",
    label: "Yoga / mobility / pilates",
    legend: [
      TRAINED,
      { icon: "🧘", label: "Long flow", kind: "override" },
      { icon: "🌅", label: "Retreat", kind: "goal-date" },
    ],
  },
  dance: {
    key: "dance",
    label: "Dance / cheer / gymnastics",
    legend: [
      TRAINED,
      { icon: "💃", label: "Rehearsal", kind: "override" },
      { icon: "🎭", label: "Show day", kind: "goal-date" },
    ],
  },
  equestrian: {
    key: "equestrian",
    label: "Equestrian",
    legend: [
      TRAINED,
      { icon: "🐎", label: "Ride day", kind: "override" },
      { icon: "🏆", label: "Show day", kind: "goal-date" },
    ],
  },
  paddle: {
    key: "paddle",
    label: "Paddle (SUP / kayak / canoe)",
    legend: [
      TRAINED,
      { icon: "🛶", label: "Paddle day", kind: "override" },
      { icon: "🏆", label: "Race day", kind: "goal-date" },
    ],
  },
  archery: {
    key: "archery",
    label: "Archery / shooting sports",
    legend: [
      TRAINED,
      { icon: "🏹", label: "Range day", kind: "override" },
      { icon: "🎯", label: "Competition", kind: "goal-date" },
    ],
  },
  general: {
    key: "general",
    label: "General fitness / weight loss / recomp",
    legend: [
      TRAINED,
      { icon: "💪", label: "Push day", kind: "override" },
      { icon: "🎯", label: "Milestone", kind: "goal-date" },
    ],
  },
  custom: {
    key: "custom",
    label: "Custom — let Claude propose later",
    legend: null,
  },
};

// Optgroup buckets for the GoalCreateForm picker. Keep slugs grouped by
// activity character so the dropdown is scannable.
export const FLAVOR_GROUPS: Array<{ heading: string; keys: GoalFlavorKey[] }> = [
  {
    heading: "Outdoor / mountain",
    keys: ["hike", "trail-running", "climbing", "snowboard", "skiing", "surf"],
  },
  {
    heading: "Endurance",
    keys: ["running", "cycling", "mtb", "swimming", "rowing", "triathlon", "paddle"],
  },
  {
    heading: "Strength",
    keys: ["strength", "bodybuilding", "crossfit"],
  },
  {
    heading: "Combat & martial",
    keys: ["combat", "martial-arts"],
  },
  {
    heading: "Team sports",
    keys: ["volleyball", "basketball", "soccer", "football", "hockey"],
  },
  {
    heading: "Racquet & precision",
    keys: ["racquet", "golf", "archery"],
  },
  {
    heading: "Mind-body & artistic",
    keys: ["yoga", "dance", "equestrian"],
  },
  {
    heading: "General",
    keys: ["general", "custom"],
  },
];

export function legendForFlavor(key: GoalFlavorKey): LegendEntry[] | null {
  return FLAVOR_PRESETS[key]?.legend ?? null;
}

export function isFlavorKey(s: string): s is GoalFlavorKey {
  return s in FLAVOR_PRESETS;
}
