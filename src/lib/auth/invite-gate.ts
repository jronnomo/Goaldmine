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

// ---------------------------------------------------------------------------
// claimInvite — #247: atomic conditional claim, closing the concurrent-
// redemption race between checkInviteGate's JS useCount check (above) and
// the (now-removed) unguarded increment that used to live in
// events.createUser. Two simultaneous signups against the same maxUses:1
// invite could both observe useCount < maxUses in JS before either write
// landed; the increment must happen in the SAME statement that re-checks
// the guard, on the database.
//
// Why raw SQL: same reason the JS useCount < maxUses check exists above
// (Check 4/5's comment) — Prisma's query builder cannot compare two columns
// of the same row in a WHERE clause, so `useCount < maxUses` can't be
// expressed as a `updateMany({ where: ... } )` guard. A parameterized
// (injection-safe, tagged-template) `$executeRaw` conditional UPDATE is the
// only way to make the guard-and-increment atomic.
//
// Why the expiry re-guard: `expiresAt` can lapse between the gate's read
// (checkInviteGate, app-server clock) and this claim (Postgres NOW(),
// DB-server clock) — re-checking it here closes that window too, not just
// the useCount race. affected rows === 0 covers both "already claimed by
// the other concurrent request" and "expired since the gate read it";
// callers don't need to distinguish the two, both resolve to the same
// /request-access loser path.
export async function claimInvite(inviteId: string): Promise<boolean> {
  const affected = await prisma.$executeRaw`
    UPDATE "Invite"
    SET "useCount" = "useCount" + 1,
        "redeemedAt" = COALESCE("redeemedAt", NOW())
    WHERE "id" = ${inviteId}
      AND "useCount" < "maxUses"
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
  `;
  return affected === 1;
}

// ---------------------------------------------------------------------------
// Advisory preview (NOT enforcement)
//
// previewInviteCodeQuery is a PURE helper — deliberately NOT marked
// "use server". This file must never gain a "use server" directive: doing so
// would turn checkInviteGate (which decides real access) into a callable
// public server action. The "use server" action wrapper lives in
// src/lib/auth/auth-actions.ts (previewInviteCode), which imports this
// helper and applies rate limiting before calling it.
//
// checkInviteGate remains the ONLY enforcement path (re-run at signIn time
// and again in events.createUser). This helper only powers a soft, advisory
// UI hint on /signin — it must never leak *why* a code is invalid, only
// whether it currently looks valid.
// ---------------------------------------------------------------------------

// Same shape used when persisting the invite_code cookie (signInWithGoogle).
const INVITE_CODE_SHAPE_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Advisory-only check of whether an invite code currently looks valid
 * (exists, not exhausted, not expired). Returns a boolean ONLY — never a
 * reason — so the UI can never be used to enumerate *why* a code fails
 * (unknown vs exhausted vs expired all look identical from the outside).
 *
 * Query shape is fixed: exactly one `prisma.invite.findFirst({ where: { code } })`
 * call for every syntactically well-shaped code, regardless of whether that
 * code turns out to be valid, exhausted, expired, or unknown. This keeps the
 * DB-round-trip timing identical across those four outcomes.
 *
 * The one exception is the shape regex above, which early-returns `false`
 * without touching the DB for garbage input (e.g. absurdly long strings or
 * disallowed characters). This creates a residual timing difference between
 * "malformed shape" and "well-shaped but otherwise invalid" — accepted here
 * because (a) this endpoint is advisory-only (checkInviteGate is the real
 * gate) and (b) it's rate-limited to 20/hour/IP, making any timing side
 * channel impractical to exploit.
 */
export async function previewInviteCodeQuery(code: string): Promise<boolean> {
  if (!INVITE_CODE_SHAPE_RE.test(code)) {
    return false;
  }

  const now = new Date();
  const invite = await prisma.invite.findFirst({ where: { code } });

  return !!(
    invite &&
    invite.useCount < invite.maxUses &&
    (invite.expiresAt === null || invite.expiresAt > now)
  );
}
