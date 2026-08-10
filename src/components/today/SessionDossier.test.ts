// SessionDossier — render proofs (today-page-ia §2.4 / UXR-TIA-17/18/19).
// The binding claim: every <details> ships a LITERAL open constant, so a
// same-page revalidate (the Log sheet's meal submit) can never slam a section
// shut under the reading finger.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionDossier } from "@/components/today/SessionDossier";
import type { Block } from "@/lib/program-template";
import type { CompletedWorkoutDetail } from "@/components/days/CompletedWorkoutCard";

const blocks: Block[] = [
  {
    type: "straight",
    label: "Lower Strength",
    rounds: undefined,
    restSec: 120,
    exercises: [
      { name: "Back Squat", sets: 4, reps: 5, weightHint: "185 lb" },
      { name: "Romanian Deadlift", sets: 3, reps: 8 },
    ],
  },
  {
    type: "finisher",
    exercises: [{ name: "Farmer Carry", sets: 3, durationSec: 45 }],
  },
] as Block[];

const completed: CompletedWorkoutDetail[] = [
  {
    id: "w1",
    title: "Upper Power",
    startedAt: new Date("2026-08-10T20:12:00.000Z"),
    source: "strong-import",
    notes: "felt strong",
    exercises: [
      {
        id: "e1",
        name: "Bench Press",
        equipment: "barbell",
        notes: null,
        sets: [
          { id: "s1", setIndex: 1, reps: 5, weightLb: 155, durationSec: null, distanceMi: null, rpe: 8 },
          { id: "s2", setIndex: 2, reps: 5, weightLb: 155, durationSec: null, distanceMi: null, rpe: 8.5 },
        ],
      },
      {
        id: "e2",
        name: "Wall Handstand Hold",
        equipment: null,
        notes: null,
        sets: [{ id: "s3", setIndex: 1, reps: null, weightLb: null, durationSec: 25, distanceMi: null, rpe: null }],
      },
    ],
  },
];

describe("SessionDossier — prescription mode", () => {
  const html = renderToStaticMarkup(
    createElement(SessionDossier, { workoutName: "Lower Power", blocks }),
  );

  it("one Tier-1 Card ('Session') with the workout name as the muted action — exactly ONE h2", () => {
    expect(html).toContain('data-testid="today-session-dossier"');
    expect(html).toContain("Session");
    expect(html).toContain("Lower Power");
    expect(html.match(/<h2/g)?.length).toBe(1); // the Card header; rows are text-sm spans
  });

  it("each block is a native <details> row with a LITERAL open attribute", () => {
    expect(html).toContain('data-testid="today-session-block-0"');
    expect(html).toContain('data-testid="today-session-block-1"');
    // renderToStaticMarkup serializes the literal boolean as a bare attribute.
    expect(html.match(/<details open/g)?.length).toBe(2);
  });

  it("summary carries label + exercise-count digest; body keeps the existing ExerciseRow grammar", () => {
    expect(html).toContain("Lower Strength");
    expect(html).toContain("2 exercises");
    expect(html).toContain("1 exercise"); // finisher digest, singular
    expect(html).toContain("Back Squat");
    expect(html).toContain("4 sets");
    expect(html).toContain("120s rest");
  });
});

describe("SessionDossier — completed mode (peak-end: receipt in the summary)", () => {
  const html = renderToStaticMarkup(
    createElement(SessionDossier, {
      workoutName: "Upper Power",
      completed,
      plannedVsLogged: "Planned: Lower Power → logged: Upper Power",
    }),
  );

  it("keeps the receipt — 'N exercises · M sets' — in the always-visible summary", () => {
    expect(html).toContain("2 exercises · 3 sets");
    expect(html).toContain("✓");
    expect(html).toContain("Upper Power");
  });

  it("set list, notes and the Edit link live in the body (a link inside <summary> would toggle it)", () => {
    expect(html).toContain("155 lb × 5");
    expect(html).toContain("RPE 8");
    expect(html).toContain("felt strong");
    expect(html).toContain('href="/workouts/w1"');
    // No <a inside the <summary> element.
    const summaryChunk = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(summaryChunk).not.toContain("<a ");
  });

  it("shows the planned→logged note when titles differ", () => {
    expect(html).toContain("Planned: Lower Power → logged: Upper Power");
  });

  it("completed rows ship the same LITERAL open", () => {
    expect(html.match(/<details open/g)?.length).toBe(1);
  });
});

describe("SessionDossier — empty + null modes (UXR-TIA-27)", () => {
  it("zero-Program empty day: the named state inside the Session card", () => {
    const html = renderToStaticMarkup(
      createElement(SessionDossier, { emptyCopy: "No session scheduled today." }),
    );
    expect(html).toContain("No session scheduled today.");
    expect(html).not.toContain("Nothing scheduled today."); // the old lie's copy is dead here
  });

  it("nothing to show → renders null (Program tenants: the timeline owns the empty state)", () => {
    const html = renderToStaticMarkup(createElement(SessionDossier, {}));
    expect(html).toBe("");
  });
});
