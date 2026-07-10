// src/lib/day-template-edit.test.ts
//
// Coverage for the structured Day Override editor's pure diff/merge/
// reconciliation layer (#235). Case list mirrors architecture-blueprint-v2.md
// §R9 (16 cases: 1-10 from v1 reworded for isTemplateDirty, 11-16 new for the
// v2 tri-state/reconciliation fixes).

import { describe, it, expect } from "vitest";
import {
  baseToEditorState,
  templateToEditorState,
  mergeTemplateEdits,
  isTemplateDirty,
  computeNumericFieldError,
  type EditorState,
} from "@/lib/day-template-edit";
import type { DayTemplate } from "@/lib/program-template";

function base(): DayTemplate {
  return {
    dayOfWeek: 2,
    title: "Upper Body + Core",
    category: "upper",
    summary: "Pull-focused strength + core finisher.",
    blocks: [
      {
        type: "straight",
        label: "Strict Pulling",
        restSec: 150,
        exercises: [
          { name: "Pull-Up", sets: 4, reps: "max" },
          { name: "Push-Up", sets: 4, reps: "12-20" },
          {
            name: "Bent Over One Arm Row",
            equipment: "Dumbbell",
            sets: 4,
            reps: 10,
            weightHint: "30-50 lb",
          },
        ],
      },
      {
        type: "superset",
        label: "Core",
        rounds: 4,
        restSec: 45,
        exercises: [
          { name: "Hanging Knee Raise", sets: 4, reps: 12 },
          { name: "Plank", sets: 4, durationSec: 60 },
        ],
      },
    ],
  };
}

describe("baseToEditorState", () => {
  it("seeds every field untouched, nothing skipped/foreign", () => {
    const b = base();
    const edits = baseToEditorState(b);
    expect(edits.title).toEqual({ touched: false, value: "" });
    expect(edits.blocks).toHaveLength(2);
    for (const block of edits.blocks) {
      expect(block.foreign).toBe(false);
      for (const ex of block.exercises) {
        expect(ex.skipped).toBe(false);
        expect(ex.foreign).toBe(false);
        expect(ex.sets).toEqual({ touched: false, value: "" });
        expect(ex.reps).toEqual({ touched: false, value: "" });
      }
    }
  });
});

describe("1-2. mergeTemplateEdits — byte preservation on untouched / single-field edit", () => {
  it("untouched exercise is byte-identical to base after merge", () => {
    const b = base();
    const edits = baseToEditorState(b);
    const merged = mergeTemplateEdits(b, edits);
    expect(JSON.stringify(merged.blocks[0]!.exercises[0])).toBe(JSON.stringify(b.blocks[0]!.exercises[0]));
  });

  it("touching weightHint only leaves reps/sets/durationSec/notes on the SAME exercise, and sibling exercises, byte-identical", () => {
    const b = base();
    const edits = baseToEditorState(b);
    edits.blocks[0]!.exercises[2]!.weightHint = { touched: true, value: "35-55 lb" };
    const merged = mergeTemplateEdits(b, edits);
    const mergedEx = merged.blocks[0]!.exercises[2]!;
    expect(mergedEx.weightHint).toBe("35-55 lb");
    expect(mergedEx.sets).toBe(b.blocks[0]!.exercises[2]!.sets);
    expect(mergedEx.reps).toBe(b.blocks[0]!.exercises[2]!.reps);
    // Sibling exercises untouched
    expect(JSON.stringify(merged.blocks[0]!.exercises[0])).toBe(JSON.stringify(b.blocks[0]!.exercises[0]));
    expect(JSON.stringify(merged.blocks[0]!.exercises[1])).toBe(JSON.stringify(b.blocks[0]!.exercises[1]));
    expect(JSON.stringify(merged.blocks[1])).toBe(JSON.stringify(b.blocks[1]));
  });
});

describe("3-5. Skip round-trip", () => {
  it("skipping one exercise in a multi-exercise block removes only that one, order preserved", () => {
    const b = base();
    const edits = baseToEditorState(b);
    edits.blocks[0]!.exercises[1]!.skipped = true; // Push-Up
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.blocks[0]!.exercises.map((e) => e.name)).toEqual(["Pull-Up", "Bent Over One Arm Row"]);
  });

  it("skipping every exercise in a block prunes the block entirely (ops-path parity)", () => {
    const b = base();
    const edits = baseToEditorState(b);
    for (const ex of edits.blocks[1]!.exercises) ex.skipped = true;
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.blocks).toHaveLength(1);
    expect(merged.blocks[0]!.label).toBe("Strict Pulling");
  });

  it("skipping every exercise in every block produces blocks: [] (valid, rest-day shape)", () => {
    const b = base();
    const edits = baseToEditorState(b);
    for (const block of edits.blocks) for (const ex of block.exercises) ex.skipped = true;
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.blocks).toEqual([]);
  });
});

describe("6. reps string|number round-trip matrix", () => {
  it("untouched numeric reps (10) stays a number", () => {
    const b = base();
    const edits = baseToEditorState(b);
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.blocks[0]!.exercises[2]!.reps).toBe(10);
    expect(typeof merged.blocks[0]!.exercises[2]!.reps).toBe("number");
  });

  it("untouched string reps ('8-10'-shaped, e.g. Push-Up's '12-20') stays a string", () => {
    const b = base();
    const edits = baseToEditorState(b);
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.blocks[0]!.exercises[1]!.reps).toBe("12-20");
    expect(typeof merged.blocks[0]!.exercises[1]!.reps).toBe("string");
  });

  it("user types a clean digit string '12' → coerced to number 12", () => {
    const b = base();
    const edits = baseToEditorState(b);
    edits.blocks[0]!.exercises[1]!.reps = { touched: true, value: "12" };
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.blocks[0]!.exercises[1]!.reps).toBe(12);
  });

  it("user types '8-10' → preserved verbatim as a string, no coercion", () => {
    const b = base();
    const edits = baseToEditorState(b);
    edits.blocks[0]!.exercises[0]!.reps = { touched: true, value: "8-10" };
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.blocks[0]!.exercises[0]!.reps).toBe("8-10");
  });

  it("user types ' 12 ' (whitespace) → trimmed then coerced to number 12", () => {
    const b = base();
    const edits = baseToEditorState(b);
    edits.blocks[0]!.exercises[1]!.reps = { touched: true, value: " 12 " };
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.blocks[0]!.exercises[1]!.reps).toBe(12);
  });
});

describe("7. Foreign-exercise passthrough via templateToEditorState", () => {
  it("a parsed template with an extra exercise produces one foreign:true entry; merge emits it unchanged", () => {
    const b = base();
    const parsed: DayTemplate = JSON.parse(JSON.stringify(b));
    parsed.blocks[1]!.exercises.push({ name: "Bird Dog", sets: 3, reps: 10 });
    const edits = templateToEditorState(b, parsed);
    const foreignRow = edits.blocks[1]!.exercises.find((e) => e.name === "Bird Dog");
    expect(foreignRow).toBeDefined();
    expect(foreignRow!.foreign).toBe(true);
    const merged = mergeTemplateEdits(b, edits);
    const mergedEx = merged.blocks[1]!.exercises.find((e) => e.name === "Bird Dog");
    expect(mergedEx).toEqual({ name: "Bird Dog", sets: 3, reps: 10 });
  });
});

describe("8-9. Empty-diff matrix (isTemplateDirty)", () => {
  it("fresh baseToEditorState(base) is not dirty", () => {
    const b = base();
    expect(isTemplateDirty(b, baseToEditorState(b))).toBe(false);
  });

  it("touching one field makes it dirty", () => {
    const b = base();
    const edits = baseToEditorState(b);
    edits.blocks[0]!.exercises[0]!.weightHint = { touched: true, value: "moderate" };
    expect(isTemplateDirty(b, edits)).toBe(true);
  });

  it("toggling skip on then back off (net-zero) is not dirty", () => {
    const b = base();
    const edits = baseToEditorState(b);
    edits.blocks[0]!.exercises[0]!.skipped = true;
    edits.blocks[0]!.exercises[0]!.skipped = false;
    expect(isTemplateDirty(b, edits)).toBe(false);
  });

  it("retyping the base's own title value back is NOT dirty (byte-diff, not touch-tracking)", () => {
    const b = base();
    const edits = baseToEditorState(b);
    edits.title = { touched: true, value: b.title };
    expect(isTemplateDirty(b, edits)).toBe(false);
  });

  it("rotation-base empty-diff case: a fresh editor state derived from any base (rotation or override) reports empty", () => {
    const b = base();
    const rotationDerivedEdits = baseToEditorState(b);
    expect(isTemplateDirty(b, rotationDerivedEdits)).toBe(false);
  });
});

describe("10. Chrome + metadata byte-preservation through an unrelated-field merge", () => {
  it("dayOfWeek/category/summary and block type/label/rounds/restSec survive untouched", () => {
    const b = base();
    const edits = baseToEditorState(b);
    edits.blocks[0]!.exercises[0]!.weightHint = { touched: true, value: "light" };
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.dayOfWeek).toBe(b.dayOfWeek);
    expect(merged.category).toBe(b.category);
    expect(merged.summary).toBe(b.summary);
    expect(merged.blocks[0]!.type).toBe(b.blocks[0]!.type);
    expect(merged.blocks[0]!.label).toBe(b.blocks[0]!.label);
    expect(merged.blocks[0]!.restSec).toBe(b.blocks[0]!.restSec);
    expect(merged.blocks[1]!.rounds).toBe(b.blocks[1]!.rounds);
  });
});

describe("11. Reorder round-trip (the exact C3 repro)", () => {
  it("editing C then inserting X at position 0 in Advanced preserves C's edit by name, marks X foreign, leaves A/B untouched", () => {
    const b = base(); // block0 = [Pull-Up(A), Push-Up(B), Bent Over One Arm Row(C)]
    const edits = baseToEditorState(b);
    edits.blocks[0]!.exercises[2]!.weightHint = { touched: true, value: "40-60 lb" }; // edit C

    // Switch to Advanced: serialize the merged (base+edits) working state.
    const advanced = mergeTemplateEdits(b, edits);
    // Insert X at index 0 of block0 (an Advanced-only structural edit).
    advanced.blocks[0]!.exercises.unshift({ name: "X New Move", sets: 3, reps: 8 });

    // Switch back to Structured: reconcile.
    const reconciled = templateToEditorState(b, advanced);
    const block0 = reconciled.blocks[0]!;
    expect(block0.exercises.map((e) => ({ name: e.name, foreign: e.foreign }))).toEqual([
      { name: "X New Move", foreign: true },
      { name: "Pull-Up", foreign: false },
      { name: "Push-Up", foreign: false },
      { name: "Bent Over One Arm Row", foreign: false },
    ]);
    const A = block0.exercises[1]!;
    const Bx = block0.exercises[2]!;
    const C = block0.exercises[3]!;
    expect(A.sets.touched).toBe(false);
    expect(A.reps.touched).toBe(false);
    expect(Bx.sets.touched).toBe(false);
    expect(Bx.reps.touched).toBe(false);
    expect(C.weightHint).toEqual({ touched: true, value: "40-60 lb" });
    expect(C.sets.touched).toBe(false);
  });
});

describe("12. Rename-without-move (tier-2 positional fallback)", () => {
  it("Advanced renames A→A2 at index 0 with no reorder → reconciled row is aligned (not foreign) showing A's base values", () => {
    const b = base();
    const parsed: DayTemplate = JSON.parse(JSON.stringify(b));
    parsed.blocks[0]!.exercises[0]!.name = "A2 Renamed";
    const edits = templateToEditorState(b, parsed);
    const row = edits.blocks[0]!.exercises[0]!;
    expect(row.foreign).toBe(false);
    expect(row.skipped).toBe(false);
    expect(row.name).toBe("Pull-Up"); // base-verbatim display name (name never independently editable)
    expect(row.sets.touched).toBe(false); // fields unchanged from base → untouched
    expect(row.reps.touched).toBe(false);
  });
});

describe("13. Whole-block insert", () => {
  it("Advanced appends a new block not in base → reconciled as foreign:true, all exercises tier-3", () => {
    const b = base();
    const parsed: DayTemplate = JSON.parse(JSON.stringify(b));
    parsed.blocks.push({
      type: "cardio",
      label: "Finisher",
      exercises: [{ name: "Bike", durationSec: 600 }],
    });
    const edits = templateToEditorState(b, parsed);
    expect(edits.blocks).toHaveLength(3);
    const newBlock = edits.blocks[2]!;
    expect(newBlock.foreign).toBe(true);
    expect(newBlock.exercises).toHaveLength(1);
    expect(newBlock.exercises[0]!.foreign).toBe(true);
    expect(newBlock.exercises[0]!.name).toBe("Bike");
  });
});

describe("14. Whole-block removal", () => {
  it("Advanced deletes the last base block entirely → its exercises reconcile as skipped, grouped, appended after survivors", () => {
    const b = base();
    const parsed: DayTemplate = JSON.parse(JSON.stringify(b));
    parsed.blocks.pop(); // remove the Core block (block index 1) entirely
    const edits = templateToEditorState(b, parsed);
    expect(edits.blocks).toHaveLength(2);
    expect(edits.blocks[0]!.foreign).toBe(false);
    expect(edits.blocks[0]!.exercises.every((e) => !e.skipped)).toBe(true);
    const restoredBlock = edits.blocks[1]!;
    expect(restoredBlock.foreign).toBe(false);
    expect(restoredBlock.exercises).toHaveLength(2);
    expect(restoredBlock.exercises.every((e) => e.skipped)).toBe(true);
    expect(restoredBlock.exercises.map((e) => e.name)).toEqual(["Hanging Knee Raise", "Plank"]);

    // Restorable via un-skip: un-skip one, merge, confirm it comes back with base values.
    restoredBlock.exercises[0]!.skipped = false;
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.blocks).toHaveLength(2);
    expect(merged.blocks[1]!.label).toBe("Core");
    expect(merged.blocks[1]!.exercises).toEqual([{ name: "Hanging Knee Raise", sets: 4, reps: 12 }]);
  });
});

describe("15. Coercion matrix", () => {
  it("sets empty → key removed", () => {
    const b = base();
    const edits = baseToEditorState(b);
    edits.blocks[0]!.exercises[0]!.sets = { touched: true, value: "" };
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.blocks[0]!.exercises[0]!).not.toHaveProperty("sets");
  });

  it("sets '5.5' → fieldError set (UI-layer helper), key omitted from merge output", () => {
    expect(computeNumericFieldError("5.5")).toBeDefined();
    const b = base();
    const edits = baseToEditorState(b);
    edits.blocks[0]!.exercises[0]!.sets = { touched: true, value: "5.5" };
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.blocks[0]!.exercises[0]!).not.toHaveProperty("sets");
  });

  it("durationSec '0' → invalid (not positive), key omitted", () => {
    expect(computeNumericFieldError("0")).toBeDefined();
    const b = base();
    const edits = baseToEditorState(b);
    edits.blocks[1]!.exercises[1]!.durationSec = { touched: true, value: "0" };
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.blocks[1]!.exercises[1]!).not.toHaveProperty("durationSec");
  });

  it("reps '8-10' preserved as string, no error possible for reps", () => {
    const b = base();
    const edits = baseToEditorState(b);
    edits.blocks[0]!.exercises[0]!.reps = { touched: true, value: "8-10" };
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.blocks[0]!.exercises[0]!.reps).toBe("8-10");
  });

  it("weightHint/notes whitespace-only → key removed", () => {
    const b = base();
    const edits = baseToEditorState(b);
    edits.blocks[0]!.exercises[2]!.weightHint = { touched: true, value: "   " };
    edits.blocks[0]!.exercises[2]!.notes = { touched: true, value: "  \t " };
    const merged = mergeTemplateEdits(b, edits);
    expect(merged.blocks[0]!.exercises[2]!).not.toHaveProperty("notes");
    // weightHint had a base value ("30-50 lb") — clearing it removes the key
    // even though base had one; "cleared" always wins over "had a base value".
    expect(merged.blocks[0]!.exercises[2]!).not.toHaveProperty("weightHint");
  });
});

describe("16. isTemplateDirty regression guards (Co3)", () => {
  it("clearing a field back to a value matching base is not dirty", () => {
    const b = base();
    const edits = baseToEditorState(b);
    // Pull-Up has no weightHint in base; typing then clearing nets to untouched-equivalent.
    edits.blocks[0]!.exercises[0]!.weightHint = { touched: true, value: "" };
    expect(isTemplateDirty(b, edits)).toBe(false);
  });

  it("whitespace-only entry into an unset base field is not dirty", () => {
    const b = base();
    const edits = baseToEditorState(b);
    expect(b.blocks[0]!.exercises[0]!.weightHint).toBeUndefined();
    edits.blocks[0]!.exercises[0]!.weightHint = { touched: true, value: "   " };
    expect(isTemplateDirty(b, edits)).toBe(false);
  });
});

// Guard against a merge-time crash on a malformed EditorState — never thrown,
// always a best-effort omission (matches R3's "never crashes" contract).
describe("defensive: merge never throws on an out-of-range base lookup", () => {
  it("an ExerciseEditState pointing past the end of a shrunk base still merges (foreign-style fallback)", () => {
    const b = base();
    const edits: EditorState = baseToEditorState(b);
    // Simulate a stale index (shouldn't happen via the public API, but the
    // merge must not throw even if it did).
    edits.blocks[0]!.exercises[0]!.exIdx = 999;
    expect(() => mergeTemplateEdits(b, edits)).not.toThrow();
  });
});
