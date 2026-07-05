import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { cookies } from "next/headers"
import { prisma } from "@/lib/db" // raw singleton — NOT getDb(); adapter runs outside ALS context
import { checkInviteGate } from "@/lib/auth/invite-gate"

// ---------------------------------------------------------------------------
// VERIFIED: callback/invite ordering (checked against installed @auth/core source)
//
// source: node_modules/@auth/core/lib/actions/callback/index.js lines 63–70
//   63: const redirect = await handleAuthorized(...)  ← signIn callback fires here
//   70: const { user, session, isNewUser } = await handleLoginOrRegister(...)
//       → createUser() and then events.createUser() fire inside handleLoginOrRegister
//
// CONCLUSION: signIn callback fires BEFORE createUser. The callback may only
// VALIDATE (user row may not exist yet for a new user); the REDEMPTION
// (useCount++, redeemedAt, redeemedByUserId) happens in events.createUser.
//
// ---------------------------------------------------------------------------
// VERIFIED: cookies() from next/headers in signIn callback
//
// The signIn callback is invoked from within the Next.js App Router route
// handler (GET /api/auth/callback/google). Next.js sets up its
// requestAsyncStorage before entering the route handler, and that storage
// context propagates through all awaited calls on the same stack — including
// into @auth/core's Auth() call and the user-provided signIn callback.
// next-auth itself imports `headers` from "next/headers" in lib/index.js
// (line 2), confirming the runtime context is compatible.
//
// cookies() IS USED directly in the signIn callback below. If it ever throws
// in a future version, fall back to reading request.cookies (pass the
// WebRequest into the callback via a module-level ref — document and report).
// ---------------------------------------------------------------------------

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  session: { strategy: "database" },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    session({ session, user }) {
      // `user` is AdapterUser (populated by database strategy) — has .id from the User row.
      // The default session callback omits id; add it explicitly so A-2's
      // getCurrentUserId can read session.user.id typed.
      session.user.id = user.id
      return session
    },

    async signIn({ user, profile }) {
      // Resolve email from user or profile (Google puts it on both).
      const email = user.email ?? (profile?.email as string | undefined)
      if (!email) {
        // No email → cannot gate. Reject to be safe.
        return "/request-access"
      }

      // Read the invite_code cookie set by signInWithGoogle before the OAuth redirect.
      // cookies() works here because the signIn callback is called synchronously within
      // the Next.js App Router route handler's async call stack (see verification note above).
      let inviteCode: string | undefined
      try {
        const cookieStore = await cookies()
        inviteCode = cookieStore.get("invite_code")?.value
      } catch {
        // cookies() unavailable (e.g., middleware context) — proceed without cookie.
        inviteCode = undefined
      }

      const result = await checkInviteGate(email, inviteCode)

      if (result.allowed) {
        return true
      }
      // Auth.js v5: returning a string path redirects there.
      return result.redirect ?? "/request-access"
    },
  },

  events: {
    async createUser({ user }) {
      // Redemption: called after a new User row is created. Re-run the gate to find
      // which invite (if any) should be redeemed, then apply useCount++, redeemedAt,
      // redeemedByUserId.
      //
      // IMPORTANT: the invite code cookie may still be present at this point (maxAge 600s),
      // but cookie DELETION in an event handler is unreliable because Auth.js events don't
      // have access to the response object to set Set-Cookie headers. We rely on the
      // cookie's maxAge≈600s natural expiry instead.
      if (!user.email || !user.id) return

      let inviteCode: string | undefined
      try {
        const cookieStore = await cookies()
        inviteCode = cookieStore.get("invite_code")?.value
      } catch {
        inviteCode = undefined
      }

      const result = await checkInviteGate(user.email, inviteCode)

      if (!result.allowed || !result.redeemInviteId) return

      // Fetch the current invite to decide whether to stamp redeemedAt
      const invite = await prisma.invite.findUnique({
        where: { id: result.redeemInviteId },
        select: { redeemedAt: true },
      })
      if (!invite) return

      const now = new Date()
      await prisma.invite.update({
        where: { id: result.redeemInviteId },
        data: {
          useCount: { increment: 1 },
          // Only stamp redeemedAt on the first redemption (null → set it)
          ...(invite.redeemedAt === null ? { redeemedAt: now } : {}),
          redeemedByUserId: user.id,
        },
      })
    },
  },
})
