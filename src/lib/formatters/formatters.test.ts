// src/lib/formatters/formatters.test.ts
//
// B2 (#265): FormattableExercise/FormattableSet gained `id` (+ sets gained
// `rpe`/`notes`, which the export_workout projection previously dropped on
// the floor despite them being real Set columns). Coverage for:
//
//   1. toFormattableWorkout — the pure Prisma-row → formatter-shape mapper
//      pulled out of the export_workout tool handler (src/lib/mcp/tools.ts)
//      specifically so this could be unit-tested without a DB — passes
//      exercise/set ids straight through unchanged from the underlying row.
//      This is the "regression test asserting exported exercise/set IDs
//      match the underlying Workout row's real Prisma IDs" the issue calls
//      for.
//   2. Each ExportFormat surfaces (or deliberately omits) id/rpe/notes:
//      - json: verbatim (it's a plain JSON.stringify of the whole shape).
//      - markdown/plain: an inline "[id: ...]" marker plus RPE/notes text —
//        these fields were previously visible in NO format at all.
//      - strong: NOT AT ALL — this format must stay byte-identical to the
//        real Strong-app txt export so it keeps round-tripping through
//        parseStrongWorkout (see strong.ts's file-header note on why).
//   3. A byte-exact round-trip of examples/sample-completed-workout.txt
//      through parseStrongWorkout → (ids/rpe/notes attached) → formatStrong,
//      proving the new fields cannot leak into the round-trip format even
//      when every set carries an id/rpe/notes.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { formatWorkout } from "./index";
import { toFormattableWorkout, type FormattableWorkout, type WorkoutExportSource } from "./types";
import { parseStrongWorkout } from "../parsers/strong";

const here = path.dirname(fileURLToPath(import.meta.url));

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Mirrors exactly what `db.workout.findUniqueOrThrow` returns for export_workout (tools.ts). */
const SOURCE: WorkoutExportSource = {
  id: "wk_cuid_workout1",
  title: "Afternoon Workout",
  startedAt: new Date("2026-05-02T15:59:00"),
  source: "strong.app",
  sourceUrl: "https://link.strong.app/ikoxgvve",
  notes: "Felt strong today",
  exercises: [
    {
      id: "ex_cuid_pullup",
      name: "Pull Up",
      equipment: null,
      orderIndex: 0,
      notes: "Elbows flared a bit",
      sets: [
        {
          id: "set_cuid_pullup1",
          setIndex: 1,
          reps: 11,
          weightLb: null,
          durationSec: null,
          distanceMi: null,
          rpe: 8,
          notes: "Good form",
        },
        {
          id: "set_cuid_pullup2",
          setIndex: 2,
          reps: 10,
          weightLb: null,
          durationSec: null,
          distanceMi: null,
          rpe: null,
          notes: null,
        },
      ],
    },
  ],
};

// ── toFormattableWorkout ──────────────────────────────────────────────────────

describe("toFormattableWorkout", () => {
  it("passes exercise ids and set ids through unchanged from the underlying Prisma row", () => {
    const result = toFormattableWorkout(SOURCE);
    expect(result.exercises[0].id).toBe("ex_cuid_pullup");
    expect(result.exercises[0].sets[0].id).toBe("set_cuid_pullup1");
    expect(result.exercises[0].sets[1].id).toBe("set_cuid_pullup2");
  });

  it("passes set-level rpe and notes through unchanged (previously dropped by the projection)", () => {
    const result = toFormattableWorkout(SOURCE);
    expect(result.exercises[0].sets[0].rpe).toBe(8);
    expect(result.exercises[0].sets[0].notes).toBe("Good form");
    expect(result.exercises[0].sets[1].rpe).toBeNull();
    expect(result.exercises[0].sets[1].notes).toBeNull();
  });

  it("preserves every pre-existing field (workout/exercise/set level)", () => {
    const result = toFormattableWorkout(SOURCE);
    expect(result.id).toBe("wk_cuid_workout1");
    expect(result.title).toBe("Afternoon Workout");
    expect(result.sourceUrl).toBe("https://link.strong.app/ikoxgvve");
    expect(result.exercises[0].name).toBe("Pull Up");
    expect(result.exercises[0].orderIndex).toBe(0);
    expect(result.exercises[0].notes).toBe("Elbows flared a bit");
    expect(result.exercises[0].sets[0].reps).toBe(11);
  });
});

// ── Per-format id/rpe/notes surfacing ─────────────────────────────────────────

describe("formatWorkout — id/rpe/notes per format", () => {
  const w = toFormattableWorkout(SOURCE);

  it("json: surfaces id, rpe, and notes verbatim for every exercise/set", () => {
    const text = formatWorkout(w, "json");
    const parsed = JSON.parse(text) as FormattableWorkout;
    expect(parsed.exercises[0].id).toBe("ex_cuid_pullup");
    expect(parsed.exercises[0].sets[0].id).toBe("set_cuid_pullup1");
    expect(parsed.exercises[0].sets[0].rpe).toBe(8);
    expect(parsed.exercises[0].sets[0].notes).toBe("Good form");
    expect(parsed.exercises[0].sets[1].id).toBe("set_cuid_pullup2");
    expect(parsed.exercises[0].sets[1].rpe).toBeNull();
  });

  it("markdown: prints an inline [id: ...] marker for the exercise and each set, plus RPE/notes", () => {
    const text = formatWorkout(w, "markdown");
    expect(text).toContain("[id: ex_cuid_pullup]");
    expect(text).toContain("[id: set_cuid_pullup1]");
    expect(text).toContain("[id: set_cuid_pullup2]");
    expect(text).toContain("RPE 8");
    expect(text).toContain("Good form");
  });

  it("plain: prints an inline [id: ...] marker for the exercise and each set, plus RPE/notes", () => {
    const text = formatWorkout(w, "plain");
    expect(text).toContain("[id: ex_cuid_pullup]");
    expect(text).toContain("[id: set_cuid_pullup1]");
    expect(text).toContain("[id: set_cuid_pullup2]");
    expect(text).toContain("RPE 8");
    expect(text).toContain("Good form");
  });

  it("strong: does NOT leak ids, rpe, or set notes (byte-stability contract, see strong.ts header note)", () => {
    const text = formatWorkout(w, "strong");
    expect(text).not.toContain("ex_cuid_pullup");
    expect(text).not.toContain("set_cuid_pullup1");
    expect(text).not.toContain("set_cuid_pullup2");
    expect(text).not.toContain("RPE");
    expect(text).not.toContain("Good form");
    // Exercise-level notes were already omitted from strong before this
    // change too — still true, unaffected by this fix.
    expect(text).not.toContain("Elbows flared");
  });
});

// ── Strong-format round-trip byte-stability (regression) ─────────────────────

describe("strong-format round-trip stays byte-stable with id/rpe/notes present (B2 regression)", () => {
  it("re-exporting the sample fixture (with synthetic ids/rpe/notes attached, as export_workout now does) matches the original file byte-for-byte", () => {
    const raw = readFileSync(
      path.join(here, "..", "..", "..", "examples", "sample-completed-workout.txt"),
      "utf8",
    );
    const parsed = parseStrongWorkout(raw);

    // Simulate export_workout's real pipeline: a parsed/logged workout now
    // has real ids and (possibly) rpe/notes on every set — attach some here
    // to prove they still can't leak into the "strong" output.
    const formattable: FormattableWorkout = {
      id: "wk_1",
      title: parsed.title ?? null,
      startedAt: parsed.startedAt,
      source: parsed.source,
      sourceUrl: parsed.sourceUrl ?? null,
      notes: null,
      exercises: parsed.exercises.map((ex, exIdx) => ({
        id: `ex_${exIdx}`,
        name: ex.name,
        equipment: ex.equipment ?? null,
        orderIndex: ex.orderIndex,
        notes: null,
        sets: ex.sets.map((s, setIdx) => ({
          id: `set_${exIdx}_${setIdx}`,
          setIndex: s.setIndex,
          reps: s.reps ?? null,
          weightLb: s.weightLb ?? null,
          durationSec: s.durationSec ?? null,
          distanceMi: null,
          rpe: 7, // present on every set — must still not appear below
          notes: "should not appear",
        })),
      })),
    };

    const reexported = formatWorkout(formattable, "strong");
    expect(reexported).toBe(raw);
  });
});
