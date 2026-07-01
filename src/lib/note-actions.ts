"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";

export async function resolveNote(id: string, reason?: string) {
  const db = await getDb();
  await db.note.update({
    where: { id },
    data: {
      resolvedAt: new Date(),
      resolvedReason: reason?.trim() || "acknowledged: no plan change needed",
    },
  });
  revalidatePath("/");
  revalidatePath("/journal");
  revalidatePath("/goals");
}

export async function resolveOpenItem(id: string, reason?: string) {
  const db = await getDb();
  const note = await db.note.findUnique({ where: { id }, select: { type: true } });
  if (!note || note.type !== "open_item") return; // type guard — silent; UI must not crash on mismatch
  await db.note.update({
    where: { id },
    data: {
      resolvedAt: new Date(),
      resolvedReason: reason?.trim() || "dismissed from /coach",
    },
  });
  revalidatePath("/coach");
}

// note-actions:34 global-write trap: getDb() injects userId into the updateMany where
// → auto-scopes to current user's pending notes only. Correct Phase-1 behavior.
export async function resolveAllPendingNotes() {
  const db = await getDb();
  const now = new Date();
  await db.note.updateMany({
    where: { resolvedAt: null },
    data: {
      resolvedAt: now,
      resolvedReason: "acknowledged: bulk resolve",
    },
  });
  revalidatePath("/");
  revalidatePath("/journal");
  revalidatePath("/goals");
}
