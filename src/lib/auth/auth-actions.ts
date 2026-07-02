"use server";

import { signIn, signOut } from "@/lib/auth/auth";
import { cookies } from "next/headers";
import { safeNext } from "@/lib/auth/safe-next";

/**
 * Initiate Google OAuth sign-in.
 * @param next - A safe relative path to redirect to after sign-in.
 * @param inviteCode - Optional invite code from ?invite= URL param. If
 *   it looks valid (URL-safe chars, ≤64 chars), it is stored in an httpOnly
 *   cookie before the OAuth redirect so the signIn callback can read it after
 *   the Google roundtrip.
 */
export async function signInWithGoogle(next?: string, inviteCode?: string) {
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
 * Sign out the current user and redirect to /signin.
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}
