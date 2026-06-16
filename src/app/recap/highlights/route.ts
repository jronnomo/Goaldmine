// GET /recap/highlights?weekOffset=&goalId=
// Returns the detected RecapHighlight candidates for the requested week as JSON.
// Consumed by RecapClient to populate the highlight picker without crossing the
// server/client boundary with a full WeeklyRecap (which carries Date objects).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { computeWeeklyRecap } from "@/lib/recap";

const HighlightsParamsSchema = z.object({
  weekOffset: z.coerce.number().int().min(-26).max(0).default(0),
  goalId: z.string().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = HighlightsParamsSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return new Response("Invalid parameters", { status: 400 });
  }
  const { weekOffset, goalId } = parsed.data;

  const recap = await computeWeeklyRecap(new Date(), { weekOffset, goalId });
  return Response.json({ highlights: recap.highlights });
}
