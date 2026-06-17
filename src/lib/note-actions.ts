"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function resolveNote(id: string, reason?: string) {
  await prisma.note.update({
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
  const note = await prisma.note.findUnique({ where: { id }, select: { type: true } });
  if (!note || note.type !== "open_item") return; // type guard — silent; UI must not crash on mismatch
  await prisma.note.update({
    where: { id },
    data: {
      resolvedAt: new Date(),
      resolvedReason: reason?.trim() || "dismissed from /coach",
    },
  });
  revalidatePath("/coach");
}

export async function resolveAllPendingNotes() {
  const now = new Date();
  await prisma.note.updateMany({
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
