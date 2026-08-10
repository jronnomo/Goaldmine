// src/lib/mcp/idempotency.ts
//
// #274 — WriteReceipt idempotency layer (tool half; the model shipped in the
// M2 additive-schema commit).
//
// WHY: the MCP transport is stateless streamable HTTP. When a write tool's
// RESPONSE is lost on the wire (network hiccup between Vercel and claude.ai),
// the coach retries the call — and without a dedupe key the retry lands a
// second row (duplicate workout, duplicate note, double PlanRevision…).
// `withWriteReceipt` gives every opted-in write tool replay semantics: the
// coach mints ONE requestId per logical write, reuses it on retry, and the
// retry gets the original stored result back verbatim instead of re-running
// the mutation.
//
// Callers that don't pass a requestId get today's non-idempotent behavior
// byte-for-byte (the wrapper is a pure pass-through).
//
// ATOMICITY MODEL — two storage paths:
//
// 1. Post-run store (default). The receipt is written immediately AFTER the
//    mutation succeeds. There is a small non-atomic window here: a crash
//    between the mutation committing and the receipt insert means the next
//    retry finds no receipt and legitimately re-runs the write — one
//    duplicate, exactly what happens on EVERY retry today, so strictly
//    better. Concurrent same-key racers are deduped at the response level by
//    the @@unique([userId, requestId]) constraint: the loser's receipt
//    insert throws P2002, and the wrapper reads the winner's receipt and
//    returns it (both callers see one canonical result; the loser's
//    already-committed mutation is NOT rolled back on this path — that
//    requires path 2).
//
// 2. In-transaction store (opt-in per handler). Handlers whose body already
//    runs inside db.$transaction call `storeReceipt(tx, payload)` as the
//    LAST operation of the transaction. The receipt then commits atomically
//    with the mutation — no crash window — and a concurrent same-key racer's
//    P2002 aborts the loser's ENTIRE transaction (mutation rolled back),
//    giving true exactly-once even under a concurrent race. The wrapper
//    detects the receipt-conflict abort and replays the winner's stored
//    result to the losing caller.
//
// Receipts are garbage-collected by scripts/gc-write-receipts.ts (manual /
// cron; 30-day cutoff) via the @@index([userId, toolName, createdAt]).

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { ScopedClient } from "@/lib/db";

/**
 * Shared Zod shape for the optional idempotency key. Spread into a write
 * tool's inputSchema as `requestId: RequestIdShape`.
 */
export const RequestIdShape = z
  .string()
  .max(128)
  .optional()
  .describe(
    "Idempotency key: same key ⇒ the original result is replayed, the write runs once. " +
      "Mint one UUID per logical write and REUSE it on retry.",
  );

// The stripped client visible inside a ScopedClient.$transaction callback —
// same derivation as tools.ts's DbClient. storeReceipt takes this so the four
// transaction-shaped handlers can pass their `tx` straight through.
type ScopedTx = Parameters<Parameters<ScopedClient["$transaction"]>[0]>[0];

/**
 * Handed to `run`. Handlers whose body is a db.$transaction call
 * `await storeReceipt(tx, payload)` as the LAST operation inside the
 * transaction to make the receipt commit atomically with the mutation.
 * No-requestId calls make it a no-op, so handlers invoke it unconditionally.
 */
export type StoreReceiptFn = (tx: ScopedTx, result: unknown) => Promise<void>;

/** Structural P2002 check — avoids a runtime import of the generated Prisma
 *  error classes (keeps this module type-only against @/generated + @/lib/db,
 *  so unit tests need no module mocks). */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/**
 * Normalize a tool payload to exactly what the first caller received on the
 * wire: tool results are serialized by jsonResult's JSON.stringify, so a
 * JSON round-trip here (Dates → ISO strings, undefined fields dropped) makes
 * the stored receipt byte-equivalent to the original response.
 * Returns undefined when there is nothing replayable to store.
 */
function toStorableJson(result: unknown): Prisma.InputJsonValue | undefined {
  if (result === undefined || result === null) return undefined;
  try {
    const s = JSON.stringify(result);
    if (s === undefined) return undefined;
    const parsed: unknown = JSON.parse(s);
    if (parsed === null) return undefined;
    return parsed as Prisma.InputJsonValue;
  } catch {
    // Unserializable payloads can't be receipted (they'd also break
    // jsonResult) — degrade to non-idempotent rather than fail the write.
    return undefined;
  }
}

/** Replayed results carry `replayed: true` INSIDE the payload — the only
 *  shape change idempotency is allowed to make. Non-object payloads (none of
 *  the wrapped tools produce one) are returned verbatim, unflagged. */
function markReplayed(stored: unknown): unknown {
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    return { ...(stored as Record<string, unknown>), replayed: true };
  }
  return stored;
}

/**
 * Idempotency wrapper for MCP write-tool handlers.
 *
 * - `requestId` absent → runs the handler untouched (no lookup, no receipt).
 * - `requestId` present, receipt exists for (userId, requestId) → returns the
 *   stored resultJson verbatim (plus `replayed: true`) WITHOUT running.
 * - `requestId` present, no receipt → runs, then stores
 *   {requestId, toolName, resultJson} — in the handler's own transaction when
 *   it called `storeReceipt(tx, …)`, else immediately after the run resolves
 *   (see the atomicity-model note in the file header).
 *
 * `db` must be the tenant-scoped client (`await getDb()`): the scoping
 * extension injects userId into both the lookup and the insert, which is what
 * keys receipts per user under @@unique([userId, requestId]).
 *
 * Errors thrown by `run` are never receipted — a failed write may always be
 * retried for real.
 */
export async function withWriteReceipt<T>(
  toolName: string,
  requestId: string | undefined,
  db: ScopedClient,
  run: (storeReceipt: StoreReceiptFn) => Promise<T>,
): Promise<T | unknown> {
  if (!requestId) {
    // No idempotency key — byte-for-byte today's behavior. The no-op keeps
    // transaction-shaped handlers free to call storeReceipt unconditionally.
    return run(async () => {});
  }

  // Replay check — the scoped client narrows this to (userId, requestId),
  // which @@unique([userId, requestId]) makes at-most-one row.
  const existing = await db.writeReceipt.findFirst({ where: { requestId } });
  if (existing) return markReplayed(existing.resultJson);

  let storedInTx = false;
  let receiptConflictInTx = false;

  const storeReceipt: StoreReceiptFn = async (tx, result) => {
    const resultJson = toStorableJson(result);
    if (resultJson === undefined) return; // nothing replayable — skip the receipt
    try {
      await tx.writeReceipt.create({ data: { requestId, toolName, resultJson } });
      storedInTx = true;
    } catch (e) {
      // A concurrent same-key racer already committed its receipt. Rethrow to
      // abort THIS transaction — the racer's mutation stands, ours rolls back
      // (true exactly-once for transaction-shaped handlers). The outer catch
      // below turns the abort into a replay of the winner's result.
      if (isUniqueViolation(e)) receiptConflictInTx = true;
      throw e;
    }
  };

  let result: T;
  try {
    result = await run(storeReceipt);
  } catch (e) {
    if (receiptConflictInTx) {
      const winner = await db.writeReceipt.findFirst({ where: { requestId } });
      if (winner) return markReplayed(winner.resultJson);
    }
    throw e; // failed writes are never receipted — retryable for real
  }

  if (!storedInTx) {
    // Post-run store. NON-ATOMIC WINDOW (documented in the file header): a
    // crash between the mutation committing inside run() and this insert
    // means the receipt is lost and ONE retry legitimately duplicates the
    // write — the same outcome every retry produces today, so strictly
    // better. Concurrent same-key racers land here too: the loser's insert
    // hits the unique constraint and we return the winner's stored result.
    const resultJson = toStorableJson(result);
    if (resultJson !== undefined) {
      try {
        await db.writeReceipt.create({ data: { requestId, toolName, resultJson } });
      } catch (e) {
        if (isUniqueViolation(e)) {
          const winner = await db.writeReceipt.findFirst({ where: { requestId } });
          if (winner) return markReplayed(winner.resultJson);
          // Winner row vanished between conflict and read (GC race) — fall
          // through and return our own result.
        } else {
          // The mutation already succeeded; a receipt bookkeeping failure
          // must never fail the tool call (failing would trigger the exact
          // duplicate-producing retry this layer exists to prevent).
          console.error(
            `[idempotency] receipt write failed for ${toolName} (requestId=${requestId}):`,
            e,
          );
        }
      }
    }
  }

  return result;
}
