// GET /recap/card?weekOffset=&goalId=&template=
// Returns a 1080×1920 PNG of the weekly recap card.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { computeWeeklyRecap, resolveHighlight } from "@/lib/recap";
import { renderRecapCard } from "@/lib/recap-render";

const CardParamsSchema = z.object({
  weekOffset: z.coerce.number().int().min(-26).max(0).default(0),
  goalId: z.string().optional(),
  template: z.enum(["coal", "parchment"]).default("coal"),
  /** Featured highlight: candidate id, "auto", "custom:<text>", or absent for none. */
  highlight: z.string().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = CardParamsSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return new Response("Invalid parameters", { status: 400 });
  }
  const { weekOffset, goalId, template, highlight } = parsed.data;

  const recap = await computeWeeklyRecap(new Date(), { weekOffset, goalId });
  const fh = resolveHighlight(recap, highlight);
  // renderRecapCard returns an ImageResponse — return it directly.
  return renderRecapCard(recap, template, fh);
}
