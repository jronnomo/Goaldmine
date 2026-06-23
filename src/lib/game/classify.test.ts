import { describe, it, expect } from "vitest";
import {
  classifyExercise,
  classifyWorkoutContent,
  contentClassToAttribute,
} from "@/lib/game/classify";

const ex = (name: string, sets: Array<Record<string, number | null>> = [{}]) => ({
  name,
  sets: sets as never,
});

describe("classifyExercise", () => {
  it("flags stretches and signature mobility moves as mobility", () => {
    expect(classifyExercise(ex("Hamstring Stretch"))).toBe("mobility");
    expect(classifyExercise(ex("Deep Squat Hold"))).toBe("mobility");
    expect(classifyExercise(ex("Thoracic Rotation"))).toBe("mobility");
    expect(classifyExercise(ex("Shoulder Dislocates"))).toBe("mobility");
  });

  it("flags cardio modalities as endurance", () => {
    expect(classifyExercise(ex("Easy Run or Bike"))).toBe("endurance");
    expect(classifyExercise(ex("StairMaster"))).toBe("endurance");
    expect(classifyExercise(ex("Long Run or Hike"))).toBe("endurance");
  });

  it("treats loaded/rep work — and ambiguous 'row' moves — as strength", () => {
    expect(classifyExercise(ex("Goblet Squat"))).toBe("strength");
    expect(classifyExercise(ex("Bent Over One Arm Row"))).toBe("strength");
    expect(classifyExercise(ex("Plank"))).toBe("strength"); // a timed hold, not mobility
  });

  it("uses distance with no load as an endurance signal", () => {
    expect(classifyExercise(ex("Loop", [{ distanceMi: 3, weightLb: null }]))).toBe("endurance");
  });
});

describe("classifyWorkoutContent", () => {
  it("returns null for an empty workout", () => {
    expect(classifyWorkoutContent([])).toBeNull();
  });

  it("a pure mobility session classifies as mobility (the reported case)", () => {
    const session = classifyWorkoutContent([
      ex("Deep Squat Hold"),
      ex("Hip Flexor Stretch"),
      ex("Hamstring Stretch"),
      ex("Thoracic Rotation"),
    ]);
    expect(session).toBe("mobility");
    expect(contentClassToAttribute(session!)).toBe("MOB");
  });

  // On-plan agreement: content class must match the template category's trait so
  // the content-first attribution is a no-op on scheduled days.
  it("on-plan upper day → strength", () => {
    expect(
      classifyWorkoutContent([ex("Pull-Up"), ex("Push-Up"), ex("Shoulder Press"), ex("Plank")]),
    ).toBe("strength");
  });

  it("on-plan zone2-mobility day → mobility (cardio + 4 stretches)", () => {
    expect(
      classifyWorkoutContent([
        ex("Easy Run or Bike"),
        ex("Deep Squat Hold"),
        ex("Hip Flexor Stretch"),
        ex("Hamstring Stretch"),
        ex("Thoracic Rotation"),
      ]),
    ).toBe("mobility");
  });

  it("on-plan long-endurance day → endurance", () => {
    expect(classifyWorkoutContent([ex("Long Run or Hike")])).toBe("endurance");
  });

  it("mixed mobility+strength leans mobility (under-credited modality wins ties)", () => {
    expect(classifyWorkoutContent([ex("Goblet Squat"), ex("Hamstring Stretch")])).toBe("mobility");
  });
});
