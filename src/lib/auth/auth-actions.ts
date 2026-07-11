"use server";

import { headers } from "next/headers";
import { signIn, signOut } from "@/lib/auth/auth";
import { cookies } from "next/headers";
import { safeNext } from "@/lib/auth/safe-next";
import { previewInviteCodeQuery } from "@/lib/auth/invite-gate";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

/**
 * Initiate Google OAuth sign-in.
 *
 * Signature is (next?, formData?) — this function has exactly one caller,
 * the form on /signin, bound as `signInWithGoogle.bind(null, redirectTo)`.
 * When the resulting function is used as a <form action={...}>, Next.js
 * calls it with FormData as the next positional argument after the bound
 * ones — so `formData` here is the live submission, and the invite code is
 * read from its "invite" field (NOT from a bound/positional arg), meaning
 * the value the user actually typed always wins over any stale bind.
 *
 * @param next - A safe relative path to redirect to after sign-in.
 * @param formData - The submitted form data. `formData.get("invite")` is
 *   checked against a URL-safe shape (≤64 chars) and, if it matches, stored
 *   in a short-lived httpOnly cookie before the OAuth redirect so the
 *   signIn callback (src/lib/auth/auth.ts) can read it after the Google
 *   roundtrip.
 */
export async function signInWithGoogle(next?: string, formData?: FormData) {
  const rawInviteCode = formData?.get("invite");
  const inviteCode = typeof rawInviteCode === "string" ? rawInviteCode.trim() : undefined;

  // If an invite code is present and looks valid (URL-safe base64url ≤ 64 chars),
  // persist it in a short-lived httpOnly cookie before the Google redirect.
  if (inviteCode && /^[A-Za-z0-9_-]{1,64}$/.test(inviteCode)) {
    const cookieStore = await cookies();
    cookieStore.set("invite_code", inviteCode, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes — enough to survive the OAuth roundtrip
      path: "/",
    });
  }
  await signIn("google", { redirectTo: safeNext(next) });
}

/**
 * Advisory-only preview of whether an invite code currently looks valid.
 * Powers the debounced/on-blur hint on /signin — NEVER enforcement.
 * checkInviteGate (run inside the Auth.js signIn callback) is the only real
 * gate; this action exists purely so the UI can show a soft "looks valid" /
 * "will be checked" line before the user commits to the Google roundtrip.
 *
 * Rate-limited (20/hour/IP, bucket "invite-preview-hour") separately from
 * the real sign-in flow. On rate-limit, fails quiet — returns `false` rather
 * than throwing, since this is advisory-only and a false negative here just
 * means the hint doesn't show; it has no security consequence.
 */
export async function previewInviteCode(code: string): Promise<boolean> {
  const ip = getClientIp(await headers());
  const rateLimit = await checkRateLimit("invite-preview-hour", ip);
  if (!rateLimit.ok) {
    return false;
  }
  return previewInviteCodeQuery(code);
}

/**
 * Sign out the current user.
 *
 * This action is used two ways:
 *   1. Bound: `signOutAction.bind(null, "/oauth/authorize?...")` on a form —
 *      Next prepends the bound string, so `redirectTo` receives it directly.
 *      (Next still passes the live FormData as the next positional arg; this
 *      action never reads it, so it declares no parameter for it — functions
 *      with fewer declared params are assignable.)
 *   2. Bare: `<form action={signOutAction}>` (settings page, SessionMenu) —
 *      Next calls `signOutAction(formData)` with NO bound args, so the
 *      FormData object itself lands in the `redirectTo` slot. The `typeof`
 *      guard below catches this and falls back to "/signin", preserving
 *      the exact behavior those two legacy callers already have — they are
 *      intentionally left untouched.
 *
 * Any string that does land in `redirectTo` is passed through `safeNext`
 * (open-redirect defense in depth) rather than trusted directly. `safeNext`
 * rejects non-relative/protocol-relative input and falls back to "/" — NOT
 * "/signin" — which differs from the FormData-trap fallback above, but is
 * still safe: middleware bounces an unauthenticated request to "/" over to
 * "/signin?next=/", landing the signed-out user on the same page, just one
 * hop later.
 *
 * `redirectTo`'s type is `string | FormData` (not just `string`) so the
 * bare-form call sites above type-check: React's `<form action={fn}>` prop
 * requires `fn` be assignable to `(formData: FormData) => …`, which means
 * the first parameter must accept a FormData argument. The runtime guard
 * below still discriminates on `typeof`, so behavior is unchanged from the
 * `string`-only shape — this is a type-level widening only.
 */
export async function signOutAction(redirectTo?: string | FormData) {
  const target = typeof redirectTo === "string" ? safeNext(redirectTo) : "/signin";
  await signOut({ redirectTo: target });
}

/**
 * #245 — Permanently delete the signed-in user's account and all owned data.
 *
 * `useActionState`-compatible: (prevState, formData) -> next state.
 *
 * Mechanics (see .feature-dev/2026-07-11-245-delete-account/agents/architecture-critique.md,
 * Attacks 1/2/3/4/8 — this function follows that skeleton exactly):
 *  - uid is ALWAYS session-derived via getCurrentUserId() (OWNERSHIP CRITICAL, same house
 *    rule as connection-actions.ts) — NEVER a form-supplied id. getCurrentUserId() itself
 *    redirect()s to /signin (a NEXT_REDIRECT throw) when there's no session; that throw is
 *    intentionally left unwrapped here so it propagates.
 *  - The confirmation phrase is validated server-side (trim, then exact case-sensitive
 *    match) — the client's disabled-until-match button is UX-only defense-in-depth.
 *  - prisma.user.delete() is the raw singleton (house rule: auth-infra ops use the raw
 *    client, not the tenant-scoped getDb()) and is a SINGLE SQL statement — every owned
 *    model + Account/Session + OAuth tokens is `onDelete: Cascade` in the schema, so this
 *    one call is the entire deletion. No $transaction wrapper: a single statement gains
 *    nothing from one, and wrapping signOut() in it would be both semantically wrong (mixing
 *    a DB transaction with a non-DB async call) and would risk swallowing signOut()'s
 *    NEXT_REDIRECT throw (see below).
 *  - ONLY the delete call is try/caught. P2025 ("record to delete does not exist") means a
 *    concurrent double-submit already deleted the row — that's not an error from the user's
 *    perspective (the account they wanted gone is gone), so we fall through to signOut()
 *    instead of surfacing a scary error. Any OTHER error rethrows unhandled.
 *  - signOut() runs OUTSIDE any try/catch. Its redirect to /signin?deleted=1 is a
 *    NEXT_REDIRECT throw used as control flow by the Next.js framework boundary — catching it
 *    here (even in a "just in case" outer try/catch) would swallow the redirect and leave the
 *    user staring at a stale page for an account that no longer exists.
 */
export type DeleteAccountState = { error: string | null };

const DELETE_CONFIRMATION_PHRASE = "delete my account";

export async function deleteAccountAction(
  _prevState: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  // Session-derived uid ONLY — never a form field. Redirects to /signin (NEXT_REDIRECT,
  // left unwrapped) when there's no session.
  const uid = await getCurrentUserId();

  const raw = formData.get("confirmation");
  const phrase = typeof raw === "string" ? raw.trim() : "";
  if (phrase !== DELETE_CONFIRMATION_PHRASE) {
    return { error: "Type the phrase exactly as shown to confirm." };
  }

  // ONLY the delete call is try/caught — never signOut(), never the whole function body.
  try {
    await prisma.user.delete({ where: { id: uid } });
  } catch (err) {
    const isAlreadyDeleted =
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
    if (!isAlreadyDeleted) {
      throw err; // anything other than "already gone" is a real failure — surface it
    }
    // P2025 = row already deleted by a concurrent submit — fall through to signOut anyway.
  }

  // MUST be outside any try/catch. Its NEXT_REDIRECT throw is the intended exit — in
  // practice this call never returns (redirect isn't set to false, so next-auth's signOut
  // always throws). TS's declared-return-type check for this destructured export doesn't
  // narrow to `never` through the local re-export, so the trailing return below is a
  // type-satisfying fallback only — NOT a reachable code path, and NOT inside a catch.
  await signOut({ redirectTo: "/signin?deleted=1" });
  return { error: null };
}
