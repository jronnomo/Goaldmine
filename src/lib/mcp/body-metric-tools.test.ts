// src/lib/mcp/body-metric-tools.test.ts
//
// BodyMetric rows were append-only by accident: log_body_metric created them
// and nothing in the app — no tool, no dashboard control — could remove or
// correct one. The coach hit the wall for real (2026-08-26): four wrong RHR
// readings, and the only available move was to stack another reading on top.
//
// These tests pin the two tools that close the gap, using the FakeMcpServer
// harness from leaky-reads.test.ts / delete-tools-routing.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockDeleteBodyMetricsCore,
  mockFindBodyMetricsOnDay,
  mockUpdateBodyMetricCore,
} = vi.hoisted(() => ({
  mockDeleteBodyMetricsCore: vi.fn(),
  mockFindBodyMetricsOnDay: vi.fn(),
  mockUpdateBodyMetricCore: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockResolvedValue({}),
  prisma: {},
  injectUserId: (_m: string, _o: string, args: unknown) => args,
  forUser: vi.fn(),
}));

vi.mock("@/lib/body-metric-core", () => ({
  deleteBodyMetricsCore: mockDeleteBodyMetricsCore,
  findBodyMetricsOnDay: mockFindBodyMetricsOnDay,
  updateBodyMetricCore: mockUpdateBodyMetricCore,
}));

// Heavy/native leaves not exercised here (same set the sibling suites cut).
vi.mock("@/lib/mcp/tools/github-tools", () => ({ registerGitHubTools: vi.fn() }));
vi.mock("@/lib/mcp/tools/render-tools", () => ({ registerRenderTools: vi.fn() }));
vi.mock("@/lib/recap-render", () => ({
  renderRecapCard: vi.fn(),
  renderCompletionCard: vi.fn(),
}));

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAll } from "@/lib/mcp/tools";

type ToolCallback = (args: Record<string, unknown>) => Promise<unknown>;

class FakeMcpServer {
  private _handlers: Record<string, ToolCallback> = {};
  registerTool(name: string, _config: unknown, callback: ToolCallback) {
    this._handlers[name] = callback;
    return this;
  }
  getHandler(name: string): ToolCallback {
    const h = this._handlers[name];
    if (!h) throw new Error(`Tool "${name}" not registered`);
    return h;
  }
}

const fakeServer = new FakeMcpServer();
registerAll(fakeServer as unknown as McpServer);

function payload(result: unknown): Record<string, unknown> {
  const r = result as { content: [{ text: string }]; isError?: boolean };
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}

function errorText(result: unknown): string {
  const r = result as { content: [{ text: string }]; isError?: boolean };
  expect(r.isError).toBe(true);
  return r.content[0].text;
}

const READING = {
  id: "bm-1",
  key: "rhr",
  value: 68,
  unit: "bpm",
  date: "2026-08-24",
  notes: null,
  source: "claude",
  createdAt: "2026-08-24T13:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("delete_body_metric — by id", () => {
  it("deletes a single reading and reports what went", async () => {
    mockDeleteBodyMetricsCore.mockResolvedValue({ deleted: [READING], missing: [] });

    const res = await fakeServer.getHandler("delete_body_metric")({ id: "bm-1" });

    expect(mockDeleteBodyMetricsCore).toHaveBeenCalledExactlyOnceWith(["bm-1"]);
    expect(payload(res)).toEqual({
      deleted: [READING],
      missing: [],
      message: "Deleted 1 reading",
    });
  });

  it("clears a batch in one call — the whole point for a run of bad readings", async () => {
    mockDeleteBodyMetricsCore.mockResolvedValue({
      deleted: [READING, { ...READING, id: "bm-2", value: 46 }],
      missing: [],
    });

    const res = await fakeServer.getHandler("delete_body_metric")({
      ids: ["bm-1", "bm-2"],
    });

    expect(mockDeleteBodyMetricsCore).toHaveBeenCalledExactlyOnceWith(["bm-1", "bm-2"]);
    expect(payload(res).message).toBe("Deleted 2 readings");
  });

  it("a stale id does not derail the batch — it comes back in `missing`", async () => {
    mockDeleteBodyMetricsCore.mockResolvedValue({ deleted: [READING], missing: ["gone"] });

    const res = await fakeServer.getHandler("delete_body_metric")({
      ids: ["bm-1", "gone"],
    });

    expect(payload(res).missing).toEqual(["gone"]);
    expect(payload(res).message).toBe("Deleted 1 reading — 1 id(s) not found");
  });
});

describe("delete_body_metric — by key + date", () => {
  it("deletes when the day holds exactly one matching reading", async () => {
    mockFindBodyMetricsOnDay.mockResolvedValue([READING]);
    mockDeleteBodyMetricsCore.mockResolvedValue({ deleted: [READING], missing: [] });

    const res = await fakeServer.getHandler("delete_body_metric")({
      key: "RHR", // normalized on the way in
      date: "2026-08-24",
    });

    expect(mockFindBodyMetricsOnDay).toHaveBeenCalledWith("rhr", expect.any(Date), undefined);
    expect(mockDeleteBodyMetricsCore).toHaveBeenCalledExactlyOnceWith(["bm-1"]);
    expect(payload(res).message).toBe("Body metric reading deleted");
  });

  it("several matches → returns candidates with ids and deletes NOTHING", async () => {
    // Multiple readings a day are legitimate (Watch SpO₂ spot-checks), so
    // guessing would destroy real data.
    const dupes = [READING, { ...READING, id: "bm-2", value: 50 }];
    mockFindBodyMetricsOnDay.mockResolvedValue(dupes);

    const res = await fakeServer.getHandler("delete_body_metric")({
      key: "rhr",
      date: "2026-08-24",
    });

    const out = payload(res);
    expect(out.ambiguous).toBe(true);
    expect(out.candidates).toEqual(dupes);
    expect(String(out.message)).toContain("call again with id");
    expect(mockDeleteBodyMetricsCore).not.toHaveBeenCalled();
  });

  it("narrows by value when given one", async () => {
    mockFindBodyMetricsOnDay.mockResolvedValue([READING]);
    mockDeleteBodyMetricsCore.mockResolvedValue({ deleted: [READING], missing: [] });

    await fakeServer.getHandler("delete_body_metric")({
      key: "rhr",
      date: "2026-08-24",
      value: 68,
    });

    expect(mockFindBodyMetricsOnDay).toHaveBeenCalledWith("rhr", expect.any(Date), 68);
  });

  it("no match → a named error, not a silent no-op", async () => {
    mockFindBodyMetricsOnDay.mockResolvedValue([]);

    const res = await fakeServer.getHandler("delete_body_metric")({
      key: "rhr",
      date: "2026-08-24",
      value: 99,
    });

    expect(errorText(res)).toContain("No rhr reading found on 2026-08-24 with value 99");
    expect(mockDeleteBodyMetricsCore).not.toHaveBeenCalled();
  });

  it("neither id nor key+date → says where the ids come from", async () => {
    const res = await fakeServer.getHandler("delete_body_metric")({});
    expect(errorText(res)).toContain("get_metric_history");
  });
});

describe("update_body_metric", () => {
  it("corrects a value in place instead of stacking a second reading", async () => {
    mockUpdateBodyMetricCore.mockResolvedValue({ ...READING, value: 50 });

    const res = await fakeServer.getHandler("update_body_metric")({
      id: "bm-1",
      value: 50,
    });

    expect(mockUpdateBodyMetricCore).toHaveBeenCalledExactlyOnceWith("bm-1", {
      value: 50,
      unit: undefined,
      notes: undefined,
      date: undefined,
      key: undefined,
    });
    expect(payload(res)).toEqual({ ...READING, value: 50, message: "Body metric reading updated" });
  });

  it("normalizes a re-filed key and parses the date as USER_TZ", async () => {
    mockUpdateBodyMetricCore.mockResolvedValue(READING);

    await fakeServer.getHandler("update_body_metric")({
      id: "bm-1",
      key: "HRV",
      date: "2026-08-23",
    });

    const [, patch] = mockUpdateBodyMetricCore.mock.calls[0];
    expect(patch.key).toBe("hrv");
    expect(patch.date).toBeInstanceOf(Date);
  });

  it('empty notes clears the field (null), rather than writing ""', async () => {
    mockUpdateBodyMetricCore.mockResolvedValue(READING);

    await fakeServer.getHandler("update_body_metric")({ id: "bm-1", notes: "" });

    expect(mockUpdateBodyMetricCore.mock.calls[0][1].notes).toBeNull();
  });

  it("rejects a non-finite value before it reaches the core", async () => {
    const res = await fakeServer.getHandler("update_body_metric")({
      id: "bm-1",
      value: Number.NaN,
    });

    expect(errorText(res)).toContain("finite number");
    expect(mockUpdateBodyMetricCore).not.toHaveBeenCalled();
  });
});
