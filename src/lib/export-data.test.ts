// src/lib/export-data.test.ts
// Unit tests for buildExportPayload() (#246). Uses a Proxy-based mock db
// (not a plain object mock) specifically so that accessing any model NOT in
// the 17 scoped models throws loudly instead of silently returning
// `undefined` — a plain object mock would let an accidental `db.account`
// access pass the test suite unnoticed. See
// .feature-dev/2026-07-11-246-data-export/agents/architecture-critique.md
// Attack 6 for the skeleton this is built from.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildExportPayload } from "@/lib/export-data";

const EXPECTED_MODELS = [
  "workout",
  "measurement",
  "footageMarker",
  "baseline",
  "note",
  "hike",
  "nutritionLog",
  "mobilityCheckin",
  "goal",
  "program",
  "gameBonusXp",
  "bodyMetric",
  "scheduledItem",
  "logEntry",
  "plan",
  "dayRenderJob",
  "foodUsage",
] as const;

const { mockFindManyByModel, accessedModels } = vi.hoisted(() => {
  const mockFindManyByModel = new Map<string, ReturnType<typeof vi.fn>>();
  const accessedModels = new Set<string>();
  return { mockFindManyByModel, accessedModels };
});

function buildMockDb() {
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        accessedModels.add(prop);
        if (!(EXPECTED_MODELS as readonly string[]).includes(prop)) {
          throw new Error(
            `export-data touched unexpected model "${prop}" — not in the 17 scoped models`,
          );
        }
        if (!mockFindManyByModel.has(prop)) {
          mockFindManyByModel.set(prop, vi.fn().mockResolvedValue([]));
        }
        return { findMany: mockFindManyByModel.get(prop) };
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;
}

describe("buildExportPayload", () => {
  beforeEach(() => {
    mockFindManyByModel.clear();
    accessedModels.clear();
  });

  it("queries all 17 scoped models and only those", async () => {
    const mockDb = buildMockDb();
    await buildExportPayload(mockDb);
    for (const model of EXPECTED_MODELS) {
      expect(accessedModels.has(model)).toBe(true);
    }
    expect(accessedModels.size).toBe(EXPECTED_MODELS.length);
  });

  it("throws on access to non-scoped/secret models (account, session, oAuthAccessToken)", () => {
    const mockDb = buildMockDb();
    expect(() => mockDb.account).toThrow(/unexpected model "account"/);
    expect(() => mockDb.session).toThrow(/unexpected model "session"/);
    expect(() => mockDb.oAuthAccessToken).toThrow(/unexpected model "oAuthAccessToken"/);
  });

  it("queries workout with nested exercises/sets include, and does NOT nest footageMarkers under it", async () => {
    const mockDb = buildMockDb();
    await buildExportPayload(mockDb);
    expect(mockFindManyByModel.get("workout")).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { exercises: { include: { sets: true } } },
      }),
    );
    const workoutArgs = mockFindManyByModel.get("workout")!.mock.calls[0][0];
    expect(workoutArgs.include).not.toHaveProperty("footageMarkers");
  });

  it("fetches footageMarker as its own top-level model", async () => {
    const mockDb = buildMockDb();
    await buildExportPayload(mockDb);
    expect(mockFindManyByModel.get("footageMarker")).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "asc" } }),
    );
  });

  it("queries plan with revisions/overrides include", async () => {
    const mockDb = buildMockDb();
    await buildExportPayload(mockDb);
    expect(mockFindManyByModel.get("plan")).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { revisions: true, overrides: true },
      }),
    );
  });

  it("queries note with no type filter — all note types unfiltered", async () => {
    const standingRuleNote = { id: "n1", type: "standing_rule", body: "test" };
    mockFindManyByModel.set("note", vi.fn().mockResolvedValue([standingRuleNote]));
    const mockDb = buildMockDb();
    const payload = await buildExportPayload(mockDb);

    const noteArgs = mockFindManyByModel.get("note")!.mock.calls[0][0];
    expect(noteArgs.where).toBeUndefined();
    expect(payload.models.note).toContainEqual(standingRuleNote);
  });

  it("uses a uniform createdAt-asc orderBy on every top-level model", async () => {
    const mockDb = buildMockDb();
    await buildExportPayload(mockDb);
    for (const model of EXPECTED_MODELS) {
      expect(mockFindManyByModel.get(model)).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: "asc" } }),
      );
    }
  });

  it("returns a valid envelope with empty arrays for a brand-new user", async () => {
    const mockDb = buildMockDb();
    const payload = await buildExportPayload(mockDb);

    expect(payload.format).toBe("goaldmine-export-v1");
    expect(typeof payload.exportedAt).toBe("string");
    expect(() => new Date(payload.exportedAt).toISOString()).not.toThrow();
    for (const model of EXPECTED_MODELS) {
      expect(payload.models[model]).toEqual([]);
    }
  });
});
