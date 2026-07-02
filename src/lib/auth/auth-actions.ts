"use server";

import { signIn, signOut } from "@/lib/auth/auth";
import { safeNext } from "@/lib/auth/safe-next";

/**
 * Initiate Google OAuth sign-in.
 * @param next - A safe relative path to redirect to after sign-in.
 */
export async function signInWithGoogle(next?: string) {
  await signIn("google", { redirectTo: safeNext(next) });
}

/**
 * Sign out the current user and redirect to /signin.
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}
