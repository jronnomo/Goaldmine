// Deterministic parser for Strong-app txt exports.
// Format example: see /examples/sample-completed-workout.txt
//
// Title line:           "Afternoon Workout"
// Datetime line:        "Saturday, May 2, 2026 at 3:59 PM"
// Exercise header:      "Pull Up" or "Shoulder Press (Dumbbell)"
// Set lines:            "Set 1: 11 reps" | "Set 1: 35 lb × 10" | "Set 1: 1:00"
// Optional share URL:   "https://link.strong.app/..."

export type ParsedSet = {
  setIndex: number;
  reps?: number;
  weightLb?: number;
  durationSec?: number;
};

export type ParsedExercise = {
  name: string;
  equipment?: string;
  orderIndex: number;
  sets: ParsedSet[];
};

export type ParsedWorkout = {
  title?: string;
  startedAt: Date;
  source: "strong.app";
  sourceUrl?: string;
  exercises: ParsedExercise[];
};

const URL_RE = /^https?:\/\/\S+$/i;
const SET_RE = /^Set\s+(\d+):\s*(.+)$/i;
const REPS_RE = /^(\d+)\s*reps?$/i;
// Strong uses "×" (U+00D7) but we accept "x" too.
const WEIGHT_X_REPS_RE = /^([\d.]+)\s*lb\s*[×x]\s*(\d+)$/i;
const DURATION_RE = /^(\d+):(\d{2})(?::(\d{2}))?$/;
const EQUIPMENT_RE = /^(.+?)\s*\(([^)]+)\)\s*$/;

export function parseStrongWorkout(input: string): ParsedWorkout {
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim());

  if (lines.length === 0) throw new Error("Empty input.");

  // Find first non-empty line as title, second as datetime.
  let cursor = 0;
  while (cursor < lines.length && lines[cursor] === "") cursor++;
  const titleLine = lines[cursor++];
  while (cursor < lines.length && lines[cursor] === "") cursor++;
  const datetimeLine = lines[cursor++];

  if (!titleLine) throw new Error("Missing title line.");
  if (!datetimeLine) throw new Error("Missing datetime line.");

  const startedAt = parseStrongDatetime(datetimeLine);

  const exercises: ParsedExercise[] = [];
  let current: ParsedExercise | null = null;
  let sourceUrl: string | undefined;

  for (; cursor < lines.length; cursor++) {
    const line = lines[cursor];
    if (line === "") continue;

    if (URL_RE.test(line)) {
      sourceUrl = line;
      continue;
    }

    const setMatch = line.match(SET_RE);
    if (setMatch) {
      if (!current) {
        throw new Error(`Found set line before any exercise header: "${line}"`);
      }
      const setIndex = Number.parseInt(setMatch[1]!, 10);
      const value = setMatch[2]!.trim();
      current.sets.push({ setIndex, ...parseSetValue(value) });
      continue;
    }

    // Otherwise treat as exercise header.
    const eqMatch = line.match(EQUIPMENT_RE);
    const name = eqMatch ? eqMatch[1]!.trim() : line;
    const equipment = eqMatch ? eqMatch[2]!.trim() : undefined;
    current = {
      name,
      equipment,
      orderIndex: exercises.length,
      sets: [],
    };
    exercises.push(current);
  }

  return {
    title: titleLine,
    startedAt,
    source: "strong.app",
    sourceUrl,
    exercises,
  };
}

function parseSetValue(value: string): { reps?: number; weightLb?: number; durationSec?: number } {
  const repsMatch = value.match(REPS_RE);
  if (repsMatch) return { reps: Number.parseInt(repsMatch[1]!, 10) };

  const wxr = value.match(WEIGHT_X_REPS_RE);
  if (wxr) {
    return {
      weightLb: Number.parseFloat(wxr[1]!),
      reps: Number.parseInt(wxr[2]!, 10),
    };
  }

  const dur = value.match(DURATION_RE);
  if (dur) {
    const a = Number.parseInt(dur[1]!, 10);
    const b = Number.parseInt(dur[2]!, 10);
    const c = dur[3] ? Number.parseInt(dur[3], 10) : undefined;
    // "1:00" → 1 min 0 sec. "1:23:45" → 1h 23m 45s.
    const durationSec = c !== undefined ? a * 3600 + b * 60 + c : a * 60 + b;
    return { durationSec };
  }

  throw new Error(`Unrecognized set value: "${value}"`);
}

// Parses lines like "Saturday, May 2, 2026 at 3:59 PM"
function parseStrongDatetime(line: string): Date {
  // Drop weekday prefix if present.
  const stripped = line.replace(/^[A-Za-z]+,\s*/, "");
  // Replace " at " with " " so Date can parse.
  const normalized = stripped.replace(/\s+at\s+/i, " ");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Could not parse datetime: "${line}"`);
  }
  return d;
}
