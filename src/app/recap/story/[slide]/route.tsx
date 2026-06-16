// GET /recap/story/[slide]?weekOffset=&goalId=&template=
// Returns a 1080×1920 PNG for Instagram Stories slide 1, 2, or 3.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { computeWeeklyRecap } from "@/lib/recap";
import { renderRecapStorySlide } from "@/lib/recap-render";
import type { RecapSlide } from "@/lib/recap";

const SlideParamsSchema = z.object({
  weekOffset: z.coerce.number().int().min(-26).max(0).default(0),
  goalId: z.string().optional(),
  template: z.enum(["coal", "parchment"]).default("coal"),
});

export async function GET(
  request: Request,
  ctx: { params: Promise<{ slide: string }> },
): Promise<Response> {
  // Next.js 16: params is async — must be awaited before accessing fields.
  const { slide: slideStr } = await ctx.params;
  const slideNum = Number(slideStr);
  if (![1, 2, 3].includes(slideNum)) {
    return new Response("Slide must be 1, 2, or 3", { status: 400 });
  }
  const slide = slideNum as RecapSlide;

  const { searchParams } = new URL(request.url);
  const parsed = SlideParamsSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return new Response("Invalid parameters", { status: 400 });
  }
  const { weekOffset, goalId, template } = parsed.data;

  const recap = await computeWeeklyRecap(new Date(), { weekOffset, goalId });
  // renderRecapStorySlide returns an ImageResponse — return it directly.
  return renderRecapStorySlide(recap, template, slide);
}
