import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { cookies } from "next/headers"
import { prisma } from "@/lib/db" // raw singleton — NOT getDb(); adapter runs outside ALS context
import { checkInviteGate, claimInvite } from "@/lib/auth/invite-gate"

// ---------------------------------------------------------------------------
// #247 — invite_claim_id cookie name. Set ONLY on the branch that just
// successfully called claimInvite (below); never on OPEN_SIGNUP, founder,
// returning-user, or reject paths. events.createUser trusts its mere
// presence as the ONLY signal to backfill redeemedByUserId — no re-lookup,
// no re-gating (see events.createUser for why re-deriving would corrupt
// the audit trail or fail the winner's own backfill).
// ---------------------------------------------------------------------------
const INVITE_CLAIM_COOKIE = "invite_claim_id"

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

      if (!result.allowed) {
        // checkInviteGate's reject path always returns redirect:"/request-access"
        // today (result.redirect is never anything else) — build the templated
        // string directly so the request-access page can prefill the email,
        // rather than relying on the (currently dead) `result.redirect` fallback.
        return `/request-access?email=${encodeURIComponent(email)}`
      }

      // #247 — allowed WITH a redeemInviteId (Check 4/5) means the gate found
      // an invite slot; claim it atomically HERE, at the gate, before any User
      // row exists. This is the fix for the concurrent-redemption race: two
      // simultaneous signups against the same maxUses:1 code both used to pass
      // this point (the JS useCount check above only *read*), then both raced
      // an unguarded increment in events.createUser. Now the guard-and-write
      // happen in one conditional UPDATE (claimInvite) — only one caller can
      // win the row.
      if (result.redeemInviteId) {
        const claimed = await claimInvite(result.redeemInviteId)
        if (!claimed) {
          // Lost the race (or the invite expired in the gap since the gate's
          // read) — same clean loser path as an outright reject. No User row
          // has been created yet, so there's nothing to unwind.
          return `/request-access?email=${encodeURIComponent(email)}`
        }

        // Claim succeeded. Hand the claimed invite id forward to
        // events.createUser via a short-lived httpOnly cookie — the ONLY
        // signal that handler trusts to backfill redeemedByUserId. Verified
        // viable: this callback runs inside the same Next.js Route Handler
        // invocation (app-route/module.js merges cookies().set() mutations
        // made anywhere in the call tree into the final response), same
        // guarantee auth-actions.ts's invite_code cookie already relies on.
        const cookieStore = await cookies()
        cookieStore.set(INVITE_CLAIM_COOKIE, result.redeemInviteId, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 600, // 10 minutes — same shape as the invite_code cookie (auth-actions.ts:39-45)
          path: "/",
        })
      }
      // Allowed with NO redeemInviteId (OPEN_SIGNUP / founder / returning
      // user) — no claim, no cookie. events.createUser correctly no-ops for
      // these paths because the cookie is simply never set.

      return true
    },
  },

  // #247 — burned-slot risk (accepted, documented, no mitigation attempted):
  // claimInvite (in the signIn callback above) and the Prisma adapter's
  // createUser call are two separate statements in the same Auth()
  // invocation, not one transaction — the adapter's DB calls are internal to
  // @auth/prisma-adapter, out of app control. If adapter.createUser (or
  // anything else in handleLoginOrRegister) throws AFTER a successful claim,
  // the invite slot is consumed (useCount incremented) with no User row
  // created. There is no clean mitigation: wrapping the claim + the
  // adapter's user-creation lifecycle in one long-lived transaction would
  // hold a pooled connection for the duration of an OAuth-adjacent HTTP
  // request, which is worse. Accepted as a founder-scale risk — re-mint the
  // invite if this happens. Diagnostic signature for a burned slot:
  // useCount > 0 AND redeemedByUserId IS NULL on the Invite row.
  events: {
    async createUser({ user }) {
      // #247 — backfill-only. No re-check, no re-increment, no re-derivation
      // of which invite this is (useCount++/redeemedAt are already handled
      // atomically inside claimInvite, at the gate). The ONLY signal trusted
      // here is the invite_claim_id cookie, set exclusively on the signIn
      // branch that just successfully claimed a slot.
      //
      // Why not re-run checkInviteGate (the old approach) or any other
      // useCount-gated lookup: the winner's own claim already incremented
      // useCount, so re-gating on useCount < maxUses here would fail to find
      // the very invite this user legitimately claimed. And a lookup that
      // ignores useCount (matching only on code/email) would stamp
      // redeemedByUserId on OPEN_SIGNUP/founder signups that happen to carry
      // a stale invite_code cookie from a prior attempt — corrupting the
      // audit trail with a redemption that never consumed a slot. The cookie
      // sidesteps both failure modes: it's set if and only if THIS signup
      // just won a real claim.
      if (!user.id) return

      const cookieStore = await cookies()
      const claimedInviteId = cookieStore.get(INVITE_CLAIM_COOKIE)?.value
      if (!claimedInviteId) {
        // No claim cookie — OPEN_SIGNUP, founder allowlist, or returning-user
        // path (none of which set it). Nothing to backfill; deliberately no
        // lookup performed (see comment above for why).
        return
      }

      // Set-if-null audit semantics: redeemedByUserId is stamped only if
      // still null, so a defensive re-fire of createUser (shouldn't happen
      // per the adapter) can't clobber an existing backfill.
      await prisma.invite.updateMany({
        where: { id: claimedInviteId, redeemedByUserId: null },
        data: { redeemedByUserId: user.id },
      })

      // Best-effort cleanup — delete both the claim cookie and any leftover
      // invite_code cookie now that redemption is fully resolved. Same
      // caveat as the pre-existing comment this replaces: cookie mutations
      // in an event handler are unreliable (Auth.js events don't carry the
      // response object), so this is defense in depth, not the primary
      // safeguard — both cookies also carry a short maxAge (600s) and expire
      // naturally.
      try {
        cookieStore.delete(INVITE_CLAIM_COOKIE)
        cookieStore.delete("invite_code")
      } catch {
        // Deletion unavailable in this context — rely on natural expiry.
      }
    },
  },
})
