// GET /recap/caption?weekOffset=&goalId=&highlight=
// Returns { caption: string } for the weekly recap share flow.
// Mirrors /recap/highlights/route.ts pattern exactly.
// composeCaption is server-only (computeWeeklyRecap uses Prisma + Date objects).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { computeWeeklyRecap, resolveHighlight } from "@/lib/recap";
import { composeCaption } from "@/lib/recap-caption";

const CaptionParamsSchema = z.object({
  weekOffset: z.coerce.number().int().min(-26).max(0).default(0),
  goalId: z.string().optional(),
  highlight: z.string().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = CaptionParamsSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return new Response("Invalid parameters", { status: 400 });
  }
  const { weekOffset, goalId, highlight } = parsed.data;

  const recap = await computeWeeklyRecap(new Date(), { weekOffset, goalId });
  const fh = resolveHighlight(recap, highlight);
  return Response.json({ caption: composeCaption(recap, fh) });
}
