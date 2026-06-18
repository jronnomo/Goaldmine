"use server";

import { revalidatePath } from "next/cache";
import { parseDateKey } from "@/lib/calendar";
import { canonicalExerciseName } from "@/lib/records";
import { prisma } from "@/lib/db";
import { resolveWorkoutIdForDay } from "@/lib/footage-core";

// --------------------------------------------------------------------------
// logFootageMarker
// --------------------------------------------------------------------------
// FormData fields:
//   date        string  yyyy-mm-dd            REQUIRED
//   label       string  human caption         REQUIRED (non-empty)
//   kind        string  "video" | "photo"     REQUIRED (default "video" if missing)
//   exerciseName string canonicalized name, or "" for whole-day
//   filename    string  original filename, or ""
//   highlight   string  "true" | "false"
//   capturedAt  string  ISO datetime string, or ""  (optional; not surfaced in v1 Day-page form)

export async function logFootageMarker(formData: FormData): Promise<void> {
  const dateKey       = String(formData.get("date"));          // yyyy-mm-dd
  const label         = String(formData.get("label")).trim();
  const kind          = String(formData.get("kind") || "video");
  const exerciseRaw   = String(formData.get("exerciseName") || "").trim();
  const filename      = String(formData.get("filename") || "").trim() || null;
  const highlight     = formData.get("highlight") === "true";
  const capturedAtRaw = String(formData.get("capturedAt") || "").trim();

  if (!label) throw new Error("label is required");

  const dayStart    = parseDateKey(dateKey);                   // USER_TZ midnight
  const workoutId   = await resolveWorkoutIdForDay(dayStart);  // shared helper
  const exerciseName = exerciseRaw ? canonicalExerciseName(exerciseRaw) : null;

  // CRIT-1: guard against Invalid Date (e.g. malformed input string)
  let capturedAt: Date | null = null;
  if (capturedAtRaw) {
    const d = new Date(capturedAtRaw);
    capturedAt = isNaN(d.getTime()) ? null : d;
  }

  await prisma.footageMarker.create({
    data: {
      date: dayStart,
      label,
      kind,
      filename,
      highlight,
      capturedAt,
      exerciseName,
      workoutId,
      // externalRef and taskType are not surfaced in the Day-page form (MCP-only)
    },
  });

  revalidatePath(`/days/${dateKey}`);
  revalidatePath("/");
}

// --------------------------------------------------------------------------
// deleteFootageMarker
// --------------------------------------------------------------------------
// FormData fields:
//   id      string  FootageMarker id   REQUIRED
//   dateKey string  yyyy-mm-dd         REQUIRED (for revalidatePath — avoids extra DB fetch)

export async function deleteFootageMarker(formData: FormData): Promise<void> {
  const id      = String(formData.get("id"));
  const dateKey = String(formData.get("dateKey")); // passed by FootageList as hidden field

  await prisma.footageMarker.delete({ where: { id } });

  revalidatePath(`/days/${dateKey}`);
  revalidatePath("/");
}
