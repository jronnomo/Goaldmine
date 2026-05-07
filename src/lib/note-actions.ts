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
