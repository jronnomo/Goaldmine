"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseDateKey } from "@/lib/calendar";
import { getDb } from "@/lib/db";
import { createGoalCore, ensurePlanForGoalCore, setFocusGoalCore, setGoalTrackedCore, setPlanActiveCore } from "@/lib/goal-core";
import { deleteLogEntryCore } from "@/lib/log-entry-core";
import { completeGoalCore, reopenGoalCore } from "@/lib/goal-completion";
import { isFlavorKey, legendForFlavor } from "@/lib/goal-flavors";
import type { GoalTarget } from "@/lib/goal-targets";
import { computeStackRarity } from "@/lib/rarity";

// R3 (architecture-blueprint-v2.md, binding): updateGoal's `status` field comes
// from raw FormData — a tampered or bugged form submission could otherwise write
// an arbitrary string, or "achieved" (which must only ever be set by
// completeGoalCore, in lockstep with completedAt/completionSnapshot). Reject
// anything outside this closed set.
const EDITABLE_STATUSES = new Set(["active", "abandoned"]);

export type GoalReference = {
  id: string;
  kind: "url" | "doc";
  value: string;
  label?: string;
  addedAt: string;
  claudeSummary?: string;
};

function parseTargetsField(raw: FormDataEntryValue | null): GoalTarget[] | null {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("targets must be an array");
    return parsed as GoalTarget[];
  } catch (e) {
    throw new Error(`Invalid targets JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function createGoal(form: FormData) {
  const objective = String(form.get("objective") ?? "").trim();
  const targetDateStr = String(form.get("targetDate") ?? "").trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const copyFromGoalId = (form.get("copyFromGoalId") as string | null)?.trim() || null;

  // UI-friendly guards (kept). Core re-checks defensively.
  if (!objective) throw new Error("Objective is required");
  // targetDate is now optional — omitting it creates a someday goal.

  // v2 — Concern D: align with MCP path; both routes store USER_TZ midnight
  // via the calendar helper instead of `new Date(yyyy-mm-dd)` (which yields
  // UTC midnight, rendering one calendar cell early in MT). HTML
  // <input type="date"> returns yyyy-mm-dd; parseDateKey accepts that.
  // parseDateKey itself does NOT validate the format (it Number-coerces the
  // split parts), so the NaN guard below is retained to catch malformed input.
  const targetDate = targetDateStr ? parseDateKey(targetDateStr) : null;
  if (targetDate !== null && Number.isNaN(targetDate.getTime())) throw new Error("Invalid target date");

  const targets = parseTargetsField(form.get("targets"));

  // Flavor picker → preset legend lookup. "custom" + unknown values pass null
  // (goal saves with legend: null; Claude proposes one in claude.ai per
  // server-instructions rule 11).
  const flavorRaw = (form.get("flavor") as string | null)?.trim() ?? "";
  const legend = isFlavorKey(flavorRaw) ? legendForFlavor(flavorRaw) : null;

  // D-1: honor the domain-neutral kind choice from OnboardingGoalForm.
  // Absent or unrecognized → "fitness" (preserves existing /goals form behavior).
  const kind = (form.get("kind") as string | null) === "project" ? "project" : "fitness";

  // D-1: optional redirect override. Whitelist-validated — only exact in-app paths
  // accepted to prevent open-redirect attacks (browser normalizes \→/ so startsWith
  // checks are bypassable via "/\evil.com" or "/%2F" encoded paths).
  const redirectToRaw = form.get("redirectTo");
  const SAFE_REDIRECTS = new Set(["/", "/goals", "/onboarding/connect"]);
  const redirectTo =
    typeof redirectToRaw === "string" && SAFE_REDIRECTS.has(redirectToRaw)
      ? redirectToRaw
      : null;

  const { goal } = await createGoalCore({
    objective,
    targetDate,
    notes,
    copyFromGoalId,
    targets,
    kind,
    legend: legend ?? undefined,
  });

  // UXR-63-16/PRD §3.1.7: compute stack post-creation and redirect with ?stackWarning
  // when the new stack tier is epic or legendary. Non-blocking — creation already succeeded.
  // L10 whitelist: only "epic" | "legendary" trigger the redirect variant.
  const stack = await computeStackRarity();

  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath("/calendar");
  revalidatePath("/progress");
  if (stack.tier === "epic" || stack.tier === "legendary") {
    const stackDest = redirectTo ?? `/goals/${goal.id}`;
    redirect(`${stackDest}${stackDest.includes("?") ? "&" : "?"}stackWarning=${stack.tier}`);
  }
  redirect(redirectTo ?? `/goals/${goal.id}`);
}

export async function copyTargetsFromGoal(toId: string, fromId: string) {
  if (toId === fromId) throw new Error("Cannot copy a goal's targets onto itself");
  const db = await getDb();
  const source = await db.goal.findUniqueOrThrow({ where: { id: fromId } });
  await db.goal.update({
    where: { id: toId },
    data: { targets: source.targets ?? undefined },
  });
  revalidatePath(`/goals/${toId}`);
  revalidatePath("/progress");
}

export async function updateGoal(id: string, form: FormData) {
  const objective = String(form.get("objective") ?? "").trim();
  const targetDateStr = String(form.get("targetDate") ?? "").trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const rawStatus = String(form.get("status") ?? "active").trim();
  const targets = parseTargetsField(form.get("targets"));

  if (!objective) throw new Error("Objective is required");
  // targetDate is now optional — blank clears it (makes goal a someday goal).

  // v2 — Mirror createGoal: parseDateKey yields USER_TZ midnight, whereas
  // `new Date(yyyy-mm-dd)` yields UTC midnight which shifts one calendar cell
  // early in MT. parseDateKey doesn't validate format, so the NaN guard below
  // catches malformed input from a bugged or tampered form submission.
  const targetDate = targetDateStr ? parseDateKey(targetDateStr) : null;
  if (targetDate !== null && Number.isNaN(targetDate.getTime())) throw new Error("Invalid target date");

  // R3 (binding): status is lifecycle metadata but this form path must NOT be
  // able to write "achieved" (or anything else) — only complete_goal/
  // completeGoalCore may set that, in lockstep with completedAt/
  // completionSnapshot. Goal.active is the tracking flag; Goal.isFocus is
  // which goal drives Today/Calendar — both independent of this field.
  if (!EDITABLE_STATUSES.has(rawStatus)) {
    throw new Error(
      rawStatus === "achieved"
        ? "Use the Complete form to mark a goal achieved — it captures the completion snapshot and awards XP."
        : `Invalid status: ${rawStatus}`,
    );
  }
  const status = rawStatus;

  const db = await getDb();
  await db.goal.update({
    where: { id },
    data: {
      objective,
      targetDate,
      notes,
      status,
      targets: targets ?? undefined,
    },
  });

  // D2 dated-upgrade: if a date was set, ensure the goal has a plan.
  // No-op when a plan already exists (idempotent).
  if (targetDate !== null) {
    await ensurePlanForGoalCore(id, targetDate);
  }

  revalidatePath("/goals");
  revalidatePath(`/goals/${id}`);
  revalidatePath("/calendar");
  revalidatePath("/progress");
}

export async function setFocusGoal(id: string) {
  // Transaction lives in setFocusGoalCore (shared with the MCP set_active_goal
  // tool). Focus ⇒ active-plan invariant: the target goal is set active=true
  // and its most-recent plan is re-activated — focusing a goal ALSO resumes
  // its paused plan; a paused plan is silenced solely because it is not the
  // focus. The old focus id is returned so we can revalidate its detail page.
  const { previousFocusGoalId: oldFocusId } = await setFocusGoalCore(id);

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/goals");
  revalidatePath(`/goals/${id}`);
  if (oldFocusId && oldFocusId !== id) revalidatePath(`/goals/${oldFocusId}`);
  revalidatePath("/progress");

  // Land the user on the calendar so the focus switch is visible immediately
  // (this matches the workflow of "select a goal, see its calendar").
  redirect("/calendar");
}

/** @deprecated Use setFocusGoal instead */
export const setActiveGoal = setFocusGoal;

export async function setGoalTracked(id: string, tracked: boolean) {
  await setGoalTrackedCore(id, tracked);
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/goals");
  revalidatePath("/progress");
  // No redirect — stays on /goals (pill action)
}

export async function deleteGoal(id: string) {
  const db = await getDb();
  await db.goal.delete({ where: { id } });
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/goals");
  revalidatePath("/progress");
  redirect("/goals");
}


export async function addGoalReference(id: string, form: FormData) {
  const kind = (form.get("kind") as string | null) === "doc" ? "doc" : "url";
  const value = String(form.get("value") ?? "").trim();
  const label = (form.get("label") as string | null)?.trim() || undefined;

  if (!value) throw new Error("Reference value is required");
  if (kind === "url" && !/^https?:\/\//i.test(value)) {
    throw new Error("URLs must start with http:// or https://");
  }

  const db = await getDb();
  const goal = await db.goal.findUniqueOrThrow({ where: { id } });
  const refs = (goal.references as unknown as GoalReference[] | null) ?? [];
  const next: GoalReference[] = [
    ...refs,
    {
      id: randomUUID(),
      kind,
      value,
      label,
      addedAt: new Date().toISOString(),
    },
  ];

  await db.goal.update({ where: { id }, data: { references: next } });
  revalidatePath(`/goals/${id}`);
}

export async function removeGoalReference(id: string, refId: string) {
  const db = await getDb();
  const goal = await db.goal.findUniqueOrThrow({ where: { id } });
  const refs = (goal.references as unknown as GoalReference[] | null) ?? [];
  const next = refs.filter((r) => r.id !== refId);
  await db.goal.update({ where: { id }, data: { references: next } });
  revalidatePath(`/goals/${id}`);
}

/**
 * C2 (#150) — hard-delete a single LogEntry metric reading.
 * Ownership guard: refuse if the entry does not exist, belongs to a different goal,
 * or has a different metric key — prevents cross-goal/metric deletes via crafted ids.
 * Revalidates the metric detail page, the trends page, and Today.
 */
export async function deleteMetricReading(goalId: string, metric: string, entryId: string) {
  const db = await getDb();
  const entry = await db.logEntry.findUnique({
    where: { id: entryId },
    select: { goalId: true, metric: true },
  });
  if (!entry || entry.goalId !== goalId || entry.metric !== metric) {
    throw new Error("Reading not found");
  }
  // Core deletes the row + its ActivityGoalLink rows in one transaction (#272).
  // null = row vanished between the guard and the delete — same user-facing
  // "Reading not found" as the guard.
  const deleted = await deleteLogEntryCore(entryId);
  if (!deleted) throw new Error("Reading not found");
  revalidatePath(`/goals/${goalId}/metric/${metric}`);
  revalidatePath(`/goals/${goalId}/trends`);
  revalidatePath("/");
}

/**
 * Pause (active=false) or Resume (active=true) the goal's plan.
 * Pause = set the goal's active plan to active=false (silences retest-marker generation).
 * Resume = re-activate the most-recent plan (mirror setFocusGoal's latest-plan idiom).
 * Guard: the focus goal's plan cannot be paused — UXR-62B-03.
 * No new schema column: active=false IS the paused state; existing active:true filters
 * in getActiveGoalsWithPlans + goal-events already silence a paused plan for free.
 */
export async function setPlanActive(goalId: string, active: boolean) {
  await setPlanActiveCore(goalId, active);
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/goals");
  revalidatePath(`/goals/${goalId}`);
  // No redirect — stays on current page
}

/**
 * Mark a goal achieved — the completion ceremony (REQ-011 / PRD §4.3).
 * `date` is optional (yyyy-mm-dd, USER_TZ) for backdating the true finish
 * date; blank/absent defaults to today inside completeGoalCore. Revalidates
 * every surface that reads goal status/XP/badges so the page re-renders into
 * the achieved state on return (no redirect — the one-shot celebration fires
 * on the SAME detail page once it re-renders as achieved).
 */
export async function completeGoal(id: string, form: FormData) {
  const dateStr = String(form.get("date") ?? "").trim();
  const date = dateStr ? parseDateKey(dateStr) : undefined;
  if (date !== undefined && Number.isNaN(date.getTime())) throw new Error("Invalid completion date");

  await completeGoalCore(id, date);

  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath(`/goals/${id}`);
  revalidatePath("/calendar");
  revalidatePath("/progress");
  revalidatePath("/character");
  revalidatePath("/recap");
}

/**
 * Reverse a completion (REQ-011). Does not restore focus or reactivate the
 * plan — those are separate, explicit decisions (setFocusGoal / setPlanActive)
 * left to the user, mirroring reopenGoalCore's hints-only contract.
 */
export async function reopenGoal(id: string) {
  await reopenGoalCore(id);

  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath(`/goals/${id}`);
  revalidatePath("/calendar");
  revalidatePath("/progress");
  revalidatePath("/character");
  revalidatePath("/recap");
}
