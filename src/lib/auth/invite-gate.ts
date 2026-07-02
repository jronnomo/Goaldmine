// src/lib/auth/invite-gate.ts
//
// A-3: 6-check invite gate for Auth.js signIn callback.
// Extracted here so it's unit-testable without a real DB.
//
// Uses raw `prisma` singleton — this runs in a pre-auth context (no ALS/getDb),
// same rationale as the Prisma adapter. Invite is NOT in SCOPED_MODELS (admin data).

import { prisma } from "@/lib/db";

export interface InviteGateResult {
  allowed: boolean;
  /** Path to redirect to when not allowed (e.g. "/request-access"). */
  redirect?: string;
  /** ID of the Invite row that should be redeemed in events.createUser (if any). */
  redeemInviteId?: string;
}

/**
 * Runs the 6-check gate in PRD order (first match wins):
 *
 * 1. OPEN_SIGNUP=true → allow everyone.
 * 2. email matches FOUNDER_GOOGLE_EMAIL (case-insensitive) → allow founder.
 * 3. Existing user with ≥1 Account → allow returning users (no re-gate).
 * 4. Email-bound invite: active, unexpired, useCount < maxUses → allow + mark for redemption.
 * 5. Code invite (from cookie): active, unexpired, useCount < maxUses, email matches or unbound → allow + mark for redemption.
 * 6. Else → reject to /request-access.
 *
 * @param email - The signing-in user's email address.
 * @param inviteCode - Optional code from the invite_code cookie.
 */
export async function checkInviteGate(
  email: string,
  inviteCode?: string | null,
): Promise<InviteGateResult> {
  const now = new Date();

  // ── Check 1: OPEN_SIGNUP env flag ─────────────────────────────────────────
  if (process.env.OPEN_SIGNUP === "true") {
    return { allowed: true };
  }

  // ── Check 2: Founder email (case-insensitive) ──────────────────────────────
  const founderEmail = process.env.FOUNDER_GOOGLE_EMAIL;
  if (founderEmail && email.toLowerCase() === founderEmail.toLowerCase()) {
    return { allowed: true };
  }

  // ── Check 3: Existing user with ≥1 linked Account (returning user) ─────────
  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      accounts: { select: { id: true }, take: 1 },
    },
  });
  if (existingUser && existingUser.accounts.length > 0) {
    return { allowed: true };
  }

  // ── Check 4: Email-bound invite ────────────────────────────────────────────
  // Prisma can't compare two columns in a WHERE clause, so we fetch the candidate
  // and check useCount < maxUses in JS.
  const emailBoundInvite = await prisma.invite.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  if (emailBoundInvite && emailBoundInvite.useCount < emailBoundInvite.maxUses) {
    return { allowed: true, redeemInviteId: emailBoundInvite.id };
  }

  // ── Check 5: Code invite (from cookie) ────────────────────────────────────
  if (inviteCode) {
    const codeInvite = await prisma.invite.findFirst({
      where: {
        code: inviteCode,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    if (
      codeInvite &&
      codeInvite.useCount < codeInvite.maxUses &&
      (codeInvite.email === null ||
        codeInvite.email.toLowerCase() === email.toLowerCase())
    ) {
      return { allowed: true, redeemInviteId: codeInvite.id };
    }
  }

  // ── Check 6: Reject ────────────────────────────────────────────────────────
  return { allowed: false, redirect: "/request-access" };
}
