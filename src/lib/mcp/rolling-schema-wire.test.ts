// src/lib/mcp/rolling-schema-wire.test.ts
//
// Wire-level contract for the rolling:* GoalTargetSchema refinement through
// the REAL MCP SDK (McpServer + InMemoryTransport + Client) — not the fake
// captured-callback server the leaky-reads suite uses. Two things the unit
// tests cannot see break here silently on an SDK/Zod upgrade:
//
//  1. tools/list — the superRefined GoalTargetSchema (cross-field checks are
//     runtime-only) must still convert to JSON Schema with the `rolling`
//     property present, or claude.ai's connector loses the field entirely.
//  2. tools/call — the SDK validates inputs against the live Zod schema, so
//     the refinement must enforce ON THE WIRE in both directions (params
//     required for rolling:*, forbidden elsewhere) and materialize the
//     defaults (hitsPerSession 1, window 6) before the handler runs.
//
// The test registers its own minimal tool carrying the real schema — no
// tools.ts import, no DB, no mocks.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { GoalTargetSchema } from "@/lib/metrics-registry";

let client: Client;
let server: McpServer;
let received: unknown = null;

beforeAll(async () => {
  server = new McpServer({ name: "rolling-wire-smoke", version: "0.0.0" });
  server.registerTool(
    "smoke_targets",
    {
      description: "wire smoke for GoalTargetSchema",
      inputSchema: { goalId: z.string(), targets: z.array(GoalTargetSchema).min(1) },
    },
    async (args) => {
      received = args.targets;
      return { content: [{ type: "text" as const, text: "ok" }] };
    },
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "smoke-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client.close();
  await server.close();
});

const validRollingTarget = {
  metric: "rolling:hs_20s_of6",
  label: "≥20s hold — sessions hit, last 6",
  units: "of 6",
  direction: "increase",
  target: 4,
  weight: 1,
  rolling: { exercise: "Freestanding Handstand Hold", minSeconds: 20 },
};

describe("rolling:* GoalTargetSchema — MCP wire contract", () => {
  it("tools/list: the refined schema serializes with the rolling property intact", async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "smoke_targets")!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schema = tool.inputSchema as any;
    const targetItem = schema.properties.targets.items;
    expect(targetItem.properties.rolling).toBeDefined();
    expect(targetItem.properties.rolling.properties.exercise).toBeDefined();
    expect(targetItem.properties.rolling.properties.minSeconds).toBeDefined();
    expect(targetItem.properties.rolling.properties.attemptCap).toBeDefined();
    // rolling stays optional at the JSON-schema level (the cross-field
    // requirement is runtime-only) — it must NOT be in required.
    expect(targetItem.required ?? []).not.toContain("rolling");
  });

  it("tools/call: valid rolling target passes; defaults materialize before the handler", async () => {
    received = null;
    const result = await client.callTool({
      name: "smoke_targets",
      arguments: { goalId: "g1", targets: [validRollingTarget] },
    });

    expect(result.isError ?? false).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = (received as any)[0].rolling;
    expect(parsed).toEqual({
      exercise: "Freestanding Handstand Hold",
      minSeconds: 20,
      hitsPerSession: 1,
      window: 6,
    });
  });

  it("tools/call: rolling params on a non-rolling metric are rejected on the wire", async () => {
    const result = await client.callTool({
      name: "smoke_targets",
      arguments: {
        goalId: "g1",
        targets: [{ ...validRollingTarget, metric: "log:hs_20s_of6" }],
      },
    });
    expect(result.isError).toBe(true);
  });

  it("tools/call: a rolling:* metric without params is rejected on the wire", async () => {
    const result = await client.callTool({
      name: "smoke_targets",
      arguments: {
        goalId: "g1",
        targets: [{ ...validRollingTarget, rolling: undefined }],
      },
    });
    expect(result.isError).toBe(true);
  });

  it("tools/call: attemptCap < hitsPerSession is rejected on the wire", async () => {
    const result = await client.callTool({
      name: "smoke_targets",
      arguments: {
        goalId: "g1",
        targets: [
          {
            ...validRollingTarget,
            rolling: { exercise: "X", minSeconds: 20, hitsPerSession: 3, attemptCap: 2 },
          },
        ],
      },
    });
    expect(result.isError).toBe(true);
  });

  it("tools/call: every existing family still passes without params (no wire regression)", async () => {
    const result = await client.callTool({
      name: "smoke_targets",
      arguments: {
        goalId: "g1",
        targets: [
          { metric: "weightLb", label: "Body weight", units: "lb", direction: "decrease", target: 155, weight: 0.5 },
          { metric: "log:mrr", label: "MRR", units: "$", direction: "increase", target: 1000, weight: 0.5, cumulative: true },
        ],
      },
    });
    expect(result.isError ?? false).toBe(false);
  });
});
