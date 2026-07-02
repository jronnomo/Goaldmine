import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/db" // raw singleton — NOT getDb(); adapter runs outside ALS context

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  session: { strategy: "database" },
  callbacks: {
    session({ session, user }) {
      // `user` is AdapterUser (populated by database strategy) — has .id from the User row.
      // The default session callback omits id; add it explicitly so A-2's
      // getCurrentUserId can read session.user.id typed.
      session.user.id = user.id
      return session
    },
  },
})
