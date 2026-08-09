// GET /recap/completion?goalId=&template=&format=
// Returns a PNG of the "Goal Completed" shareable card (REQ-008).
// format: "story" 1080×1920 · "post" 1080×1350 (default, 4:5 feed) · "square" 1080×1080.
// 404s when the goal is missing, not achieved, or its completionSnapshot is
// unparseable — cloned from /recap/card/route.tsx's structure; auth-protected
// by the default middleware (same as every /recap/* route).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { RECAP_CARD_FORMATS } from "@/lib/recap";
import { getDb } from "@/lib/db";
import { parseCompletionSnapshot } from "@/lib/goal-completion-core";
import { renderCompletionCard } from "@/lib/recap-render";

const CompletionParamsSchema = z.object({
  goalId: z.string(),
  template: z.enum(["coal", "parchment"]).default("coal"),
  format: z.enum(RECAP_CARD_FORMATS).default("post"),
});

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = CompletionParamsSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return new Response("Invalid parameters", { status: 400 });
  }
  const { goalId, template, format } = parsed.data;

  const db = await getDb();
  const goal = await db.goal.findUnique({ where: { id: goalId } });
  if (!goal || goal.status !== "achieved") {
    return new Response("Not found", { status: 404 });
  }

  const snapshot = parseCompletionSnapshot(goal.completionSnapshot);
  if (!snapshot) {
    return new Response("Not found", { status: 404 });
  }

  // renderCompletionCard returns an ImageResponse — return it directly.
  return renderCompletionCard(snapshot, { objective: goal.objective, kind: goal.kind }, template, format);
}
