import { handlers } from "@/lib/auth/auth"

export const { GET, POST } = handlers

// PrismaClient uses Node.js APIs (pg driver, async_hooks) — edge runtime is incompatible.
export const runtime = "nodejs"

// Prevent static caching of the auth route so session reads are always fresh.
export const dynamic = "force-dynamic"
