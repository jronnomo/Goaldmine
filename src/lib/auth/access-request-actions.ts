"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

const EMAIL_MAX_LENGTH = 254;
const NOTE_MAX_LENGTH = 1000;
// Simple shape check — not RFC 5322 exhaustive, just enough to reject garbage.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SubmitAccessRequestResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Submit a pre-invite "request access" form.
 *
 * Writes via the raw `prisma` singleton (auth-infra, like Invite) — the
 * requester has no User row yet, so this must never go through getDb().
 *
 * Contract (load-bearing for callers): this function resolves — it NEVER
 * throws — with `{ ok: false, error }` on expected failures (bad input,
 * honeypot trip, rate limit). Do NOT wire this through useFormFeedback
 * verbatim (src/lib/use-form-feedback.ts) — that hook treats ANY resolution
 * (including `{ ok: false }`) as success and shows the "Saved" state. The
 * calling form must inspect `result.ok` itself and render `result.error`
 * on failure.
 */
export async function submitAccessRequest(
  formData: FormData,
): Promise<SubmitAccessRequestResult> {
  // Honeypot: real users never fill this hidden field. If it's non-empty,
  // silently pretend success without writing anything — don't tip off bots.
  const honeypot = String(formData.get("company") ?? "").trim();
  if (honeypot.length > 0) {
    return { ok: true };
  }

  const rawEmail = String(formData.get("email") ?? "").trim();
  if (!rawEmail) {
    return { ok: false, error: "Email is required." };
  }
  if (rawEmail.length > EMAIL_MAX_LENGTH) {
    return { ok: false, error: "That email address is too long." };
  }
  const email = rawEmail.toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const rawNote = formData.get("note");
  const note = rawNote == null ? null : String(rawNote).trim();
  if (note && note.length > NOTE_MAX_LENGTH) {
    return { ok: false, error: "That note is too long (max 1000 characters)." };
  }

  const ip = getClientIp(await headers());
  const rateLimit = await checkRateLimit("access-request-hour", ip);
  if (!rateLimit.ok) {
    return { ok: false, error: "Too many requests — try again in an hour." };
  }

  await prisma.accessRequest.create({
    data: {
      email,
      note: note || null,
    },
  });

  return { ok: true };
}
