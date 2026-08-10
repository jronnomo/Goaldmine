// src/lib/mcp/idempotency.test.ts
//
// #274 — unit tests for withWriteReceipt, the WriteReceipt idempotency
// wrapper. Pure: the scoped client is a hand-rolled mock passed as a
// parameter (no module mocks, no DB). The contract under test:
//
//   - absent requestId  → pass-through: run() executes, NO receipt reads/writes
//   - miss              → run() executes, receipt stored {requestId, toolName, resultJson}
//   - hit               → stored resultJson replayed verbatim (+ replayed:true), run() NOT called
//   - post-store P2002  → concurrent racer won; winner's receipt is read and replayed
//   - in-tx store       → storeReceipt(tx, …) writes via the tx; wrapper skips its own store
//   - in-tx P2002       → losing transaction aborts; wrapper replays the winner's receipt
//   - run() throws      → error propagates, nothing is receipted (real retries stay possible)

import { describe, it, expect, vi, afterEach } from "vitest";
import { withWriteReceipt, type StoreReceiptFn } from "@/lib/mcp/idempotency";
import type { ScopedClient } from "@/lib/db";

type ScopedTx = Parameters<StoreReceiptFn>[0];

function makeDb() {
  const findFirst = vi.fn().mockResolvedValue(null);
  const create = vi.fn().mockResolvedValue({});
  const db = { writeReceipt: { findFirst, create } } as unknown as ScopedClient;
  return { db, findFirst, create };
}

function makeTx() {
  const create = vi.fn().mockResolvedValue({});
  const tx = { writeReceipt: { create } } as unknown as ScopedTx;
  return { tx, create };
}

const PAYLOAD = { id: "row-1", message: "Logged" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withWriteReceipt — no requestId (pass-through)", () => {
  it("runs the handler and never touches the receipt table", async () => {
    const { db, findFirst, create } = makeDb();
    const run = vi.fn(async () => PAYLOAD);

    const result = await withWriteReceipt("log_note", undefined, db, run);

    expect(result).toEqual(PAYLOAD);
    expect(run).toHaveBeenCalledTimes(1);
    expect(findFirst).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("hands run() a no-op storeReceipt so tx handlers can call it unconditionally", async () => {
    const { db, create } = makeDb();
    const { tx, create: txCreate } = makeTx();

    const result = await withWriteReceipt("batch_log_note", undefined, db, async (storeReceipt) => {
      await storeReceipt(tx, PAYLOAD); // must be a harmless no-op
      return PAYLOAD;
    });

    expect(result).toEqual(PAYLOAD);
    expect(txCreate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("withWriteReceipt — miss", () => {
  it("runs the handler, stores the receipt, and returns the un-flagged result", async () => {
    const { db, findFirst, create } = makeDb();
    const run = vi.fn(async () => PAYLOAD);

    const result = await withWriteReceipt("log_note", "req-1", db, run);

    expect(result).toEqual(PAYLOAD);
    expect((result as Record<string, unknown>).replayed).toBeUndefined(); // first run is never flagged
    expect(run).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({ where: { requestId: "req-1" } });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: { requestId: "req-1", toolName: "log_note", resultJson: PAYLOAD },
    });
  });

  it("stores the wire form of the payload: Dates → ISO strings, undefined fields dropped", async () => {
    const { db, create } = makeDb();
    const run = async () => ({
      id: "row-1",
      at: new Date("2026-08-09T12:00:00.000Z"),
      skipped: undefined,
    });

    await withWriteReceipt("log_workout", "req-dates", db, run);

    expect(create).toHaveBeenCalledWith({
      data: {
        requestId: "req-dates",
        toolName: "log_workout",
        resultJson: { id: "row-1", at: "2026-08-09T12:00:00.000Z" },
      },
    });
  });

  it("writes the receipt AFTER the run resolves (mutation-first ordering)", async () => {
    const { db, create } = makeDb();
    const order: string[] = [];
    create.mockImplementation(async () => {
      order.push("receipt");
      return {};
    });

    await withWriteReceipt("log_note", "req-order", db, async () => {
      order.push("mutation");
      return PAYLOAD;
    });

    expect(order).toEqual(["mutation", "receipt"]);
  });
});

describe("withWriteReceipt — hit (replay)", () => {
  it("returns the stored resultJson verbatim plus replayed:true WITHOUT running", async () => {
    const { db, findFirst, create } = makeDb();
    findFirst.mockResolvedValue({ toolName: "log_note", resultJson: PAYLOAD });
    const run = vi.fn(async () => ({ id: "row-2", message: "would be a duplicate" }));

    const result = await withWriteReceipt("log_note", "req-1", db, run);

    expect(run).not.toHaveBeenCalled(); // the write does NOT re-execute
    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ ...PAYLOAD, replayed: true });
  });

  it("returns a non-object stored payload verbatim (no flag it could carry)", async () => {
    const { db, findFirst } = makeDb();
    findFirst.mockResolvedValue({ toolName: "log_note", resultJson: [1, 2, 3] });

    const result = await withWriteReceipt("log_note", "req-arr", db, vi.fn());

    expect(result).toEqual([1, 2, 3]);
  });
});

describe("withWriteReceipt — concurrent same-key race (post-store path)", () => {
  it("on P2002 reads the winner's receipt and replays it", async () => {
    const { db, findFirst, create } = makeDb();
    const winnerPayload = { id: "winner-row", message: "Logged" };
    // Replay check misses (both racers passed it), then our receipt insert
    // loses the unique-constraint race, then the winner's row is read back.
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ toolName: "log_note", resultJson: winnerPayload });
    create.mockRejectedValue({ code: "P2002" });

    const result = await withWriteReceipt("log_note", "req-race", db, async () => PAYLOAD);

    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ...winnerPayload, replayed: true });
  });

  it("falls back to its own result if the winner's row vanished (GC race)", async () => {
    const { db, findFirst, create } = makeDb();
    findFirst.mockResolvedValue(null); // miss on replay check AND on post-conflict read
    create.mockRejectedValue({ code: "P2002" });

    const result = await withWriteReceipt("log_note", "req-gone", db, async () => PAYLOAD);

    expect(result).toEqual(PAYLOAD);
  });

  it("swallows non-P2002 receipt-write failures — the successful mutation result still returns", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, create } = makeDb();
    create.mockRejectedValue(new Error("connection reset"));

    const result = await withWriteReceipt("log_note", "req-flaky", db, async () => PAYLOAD);

    expect(result).toEqual(PAYLOAD);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});

describe("withWriteReceipt — in-transaction store", () => {
  it("storeReceipt(tx, …) writes via the tx and the wrapper skips its own post-store", async () => {
    const { db, create } = makeDb();
    const { tx, create: txCreate } = makeTx();
    const payload = { applied: 2, message: "Batch logged 2 notes atomically." };

    const result = await withWriteReceipt("batch_log_note", "req-tx", db, async (storeReceipt) => {
      await storeReceipt(tx, payload);
      return payload;
    });

    expect(result).toEqual(payload);
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(txCreate).toHaveBeenCalledWith({
      data: { requestId: "req-tx", toolName: "batch_log_note", resultJson: payload },
    });
    expect(create).not.toHaveBeenCalled(); // no double-store
  });

  it("in-tx P2002 aborts the losing transaction and replays the winner's receipt", async () => {
    const { db, findFirst, create } = makeDb();
    const { tx, create: txCreate } = makeTx();
    const winnerPayload = { applied: 2, message: "Batch logged 2 notes atomically." };
    findFirst
      .mockResolvedValueOnce(null) // replay check: miss
      .mockResolvedValueOnce({ toolName: "batch_log_note", resultJson: winnerPayload });
    txCreate.mockRejectedValue({ code: "P2002" });

    let txAborted = false;
    const result = await withWriteReceipt("batch_log_note", "req-tx-race", db, async (storeReceipt) => {
      // Simulates db.$transaction: storeReceipt's throw propagates and rolls
      // the whole transaction back — the loser's mutation never commits.
      try {
        await storeReceipt(tx, { applied: 2, message: "loser's would-be result" });
      } catch (e) {
        txAborted = true;
        throw e;
      }
      return { applied: 2, message: "unreachable" };
    });

    expect(txAborted).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ ...winnerPayload, replayed: true });
  });
});

describe("withWriteReceipt — failed writes are never receipted", () => {
  it("propagates run() errors and writes no receipt", async () => {
    const { db, create } = makeDb();
    const boom = new Error("lint refused the snapshot");

    await expect(
      withWriteReceipt("apply_plan_revision", "req-fail", db, async () => {
        throw boom;
      }),
    ).rejects.toThrow("lint refused the snapshot");

    expect(create).not.toHaveBeenCalled();
  });
});
