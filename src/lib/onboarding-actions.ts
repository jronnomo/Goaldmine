"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth/current-user";

/**
 * Sets a per-user gm_onboarding_dismissed_<uid> cookie (httpOnly, lax, 30 days)
 * and redirects to Today ("/").
 *
 * The Today gate reads the same named cookie and won't loop the user back to
 * /onboarding for 30 days — or until they create a goal, whichever comes first.
 *
 * Per-user namespacing prevents a shared-device scenario where User B skips,
 * signs out, User C signs in and inherits the dismiss cookie unintentionally.
 *
 * Note: In Next.js 16, cookies() is async — must be awaited.
 * redirect() from a server action throws NEXT_REDIRECT which the framework
 * catches at its boundary (it does NOT need to be re-thrown from server actions).
 */
export async function skipOnboarding() {
  const uid = await getCurrentUserId();
  const cookieName = `gm_onboarding_dismissed_${uid.slice(0, 16)}`;
  (await cookies()).set(cookieName, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    secure: process.env.NODE_ENV === "production",
  });
  redirect("/");
}
