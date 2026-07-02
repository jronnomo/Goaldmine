// Module augmentation for Auth.js v5 (next-auth) — A-1.
// Adds `id: string` to Session["user"] so A-2's getCurrentUserId
// can read session.user.id typed, without unsafe casting.
//
// Must augment "next-auth" (not "@auth/core/types") because that is the module
// consumers import from (import { auth } from "@/lib/auth/auth").

import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
    } & DefaultSession["user"]
  }
}
