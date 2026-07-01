// src/lib/override-integrity.test.ts
// Guards the OVERRIDE_MIRROR_KINDS registry classifiers — the kind-agnostic seam the three
// orphaned-override consumers (resolver flag, lint rule, delete warning) all read. Pure
// (matches/isMirrorOverride); we mock @/lib/db only because the module imports prisma for
// its async backing helpers.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Dual-export: @/lib/db exports both `prisma` and `getDb`; getDb is used by
// orphanedOverrideWarning/findOrphanedOverrides (not tested here) — wired for completeness.
vi.mock("@/lib/db", () => ({ prisma: {}, getDb: vi.fn() }));

import {
  isMirrorOverride,
  matchingMirrorKind,
  OVERRIDE_MIRROR_KINDS,
} from "@/lib/override-integrity";
import { getDb } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;

describe("override mirror registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue({}); // fake db for any getDb call (orphanedOverrideWarning etc.)
  });

  it("isMirrorOverride: true for a long-endurance (hike-mirror) workoutJson", () => {
    expect(isMirrorOverride({ title: "La Plata — Dress Rehearsal", category: "long-endurance" })).toBe(true);
  });

  it("isMirrorOverride: false for non-mirror categories — incl. the calisthenics skill day that replaced the 7/11 orphan", () => {
    expect(isMirrorOverride({ title: "Skill Day — Handstand + Backflip", category: "calisthenics" })).toBe(false);
    for (const category of ["rest", "lower", "lower-power", "upper", "mobility", "cardio"]) {
      expect(isMirrorOverride({ category })).toBe(false);
    }
  });

  it("isMirrorOverride: false for missing category / null / non-object", () => {
    expect(isMirrorOverride({ title: "Custom day", blocks: [] })).toBe(false);
    expect(isMirrorOverride(null)).toBe(false);
    expect(isMirrorOverride(undefined)).toBe(false);
    expect(isMirrorOverride("long-endurance")).toBe(false);
  });

  it("matchingMirrorKind: resolves the hike kind for a long-endurance override", () => {
    const kind = matchingMirrorKind({ category: "long-endurance" });
    expect(kind?.id).toBe("orphaned-hike-override");
    expect(kind?.label).toBe("hike");
  });

  it("registry: every kind has a unique, suppressible rule id and a message", () => {
    const ids = OVERRIDE_MIRROR_KINDS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of OVERRIDE_MIRROR_KINDS) {
      expect(k.message("2026-07-11")).toContain("2026-07-11");
    }
  });
});
