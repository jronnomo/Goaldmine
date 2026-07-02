# Goaldmine (repo legacy name: workout-planner)

AI-coached, multi-domain goal engine. Users log workouts/hikes/nutrition/metrics and pursue measurable goals (fitness or project kind); Claude coaches from **claude.ai**, connected as an OAuth/MCP connector to `/api/mcp`. **This app contains zero LLM calls** — every MCP tool is a deterministic, Zod-validated read or write. Cost is $0 beyond the user's Claude subscription.

See: `README.md` for the product-level overview and architecture diagrams.
See: `/Users/ggronnii/.claude/projects/-Users-ggronnii-Development/memory/fitness-profile.md` for the founder-user's fitness context.
See: `docs/project-gotchas.md` for the non-obvious scenarios that have bitten us (planJson vs override-aware reads, baseline_ops vs full-snapshot rewrite, records/PR canonicalization, deploy/connector cache). **Read it before touching plan writes, records, or the MCP tool surface.**

## Architecture

```
claude.ai (web + mobile)  ──MCP / streamable HTTP──▶  Next.js /api/mcp  ──▶  Postgres (Neon)
   (the coach: reasons,          (OAuth 2.1 or           │  106 deterministic tools
    writes back via tools)        legacy bearer)         └──▶  Dashboard PWA (Today, Calendar,
                                                               Goals, Records, Recap, Character…)
```

- **No LLM calls live in this app.** Claude reasons in claude.ai; the MCP tools are pure read/write.
- **Multi-user + multi-tenant.** Auth.js (v5) with Google sign-in, invite-gated signup (`Invite`, `OPEN_SIGNUP`). All owned-model DB access goes through the **tenant-scoped Prisma client** (`getDb()` in `src/lib/db.ts`), which enforces `userId` filtering — never query owned models with a raw client. Isolation is tested (`db.scoped.test.ts`) and auditable (`npm run db:verify-isolation`).
- **Auth for `/api/mcp`:** primary path is the hand-built **OAuth 2.1 server** (`src/lib/oauth/`, routes under `src/app/oauth/` + `.well-known` discovery): PKCE S256, dynamic client registration with redirect-host allowlist, hashed single-use auth codes, refresh rotation with family reuse-detection, RFC 8707 audience binding. Legacy single bearer token (`MCP_AUTH_TOKEN`, also via `/api/mcp/[token]`) still works.
- **Timezone:** Vercel runs UTC; the user does not. Every date helper goes through `src/lib/calendar.ts` / `calendar-core.ts`. Never do raw `new Date()` day math.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript (strict) + Tailwind v4
- Prisma 7, Postgres on Neon — generator is `prisma-client` (NOT `prisma-client-js`), output `src/generated/prisma`, datasource URL in `prisma.config.ts` (not the schema)
- `@modelcontextprotocol/sdk` (stateless streamable HTTP), Zod 4, Recharts 3, Vitest 3
- next-auth v5 beta, Upstash rate limiting (fails open), zxing-wasm (barcode scan), resvg (server-rendered recap card)

`AGENTS.md` warns: Next 16 + Prisma 7 postdate most training data — trust `node_modules/next/dist/docs/` and the local Prisma dist docs over memory.

## Key directories

- `prisma/schema.prisma` — 30 models. `npx prisma generate` after edits; migrations via the **guarded** `npm run db:migrate` (see Database safety).
- `src/app/` — dashboard pages (Today `/`, calendar, days/[dateKey], goals + plan/revisions/trends, baselines, workouts, import, nutrition, character, recap, coach, onboarding, settings) · `api/mcp/` · `oauth/*` + `api/auth/[...nextauth]`.
- `src/lib/mcp/tools.ts` — the main tool registrations (large file); packs in `src/lib/mcp/tools/{github,project,render}-tools.ts`; server instructions in `mcp/instructions.ts`; `today-shapers.ts` shapes `get_today_plan` by goal kind.
- `src/lib/readiness.ts`, `rarity-core.ts` — the honesty math (untested=0, gate caps at 80, coverage, feasibility tiers). Pure + unit-tested; keep it that way.
- `src/lib/plan.ts`, `plan-lint.ts`, `snapshot-diff.ts`, `override-integrity.ts` — plan revisions (full snapshot + reasoning), day overrides, and the linter (`lintTemplate()` pure pre-write check; `lintActivePlan()` backs the `lint_plan` tool).
- `src/lib/records.ts` — baseline scheduling + PR detection (canonical exercise names — see gotchas).
- `src/lib/game/` — XP curves, day-ledger engine, badges, attributes.
- `src/lib/parsers/strong.ts` + `formatters/` — Strong-app txt parser (regression-tested against `examples/`) and round-trip export formatters.
- `src/lib/oauth/`, `src/lib/auth/` — OAuth 2.1 server + Auth.js glue. Fully unit-tested; don't modify token/grant logic without running the suite.
- `scripts/` — ~30 tsx utilities: `db-guard.ts`, tenant-isolation verifiers, `mint-invite.ts`, plan inspectors/backfills.

## MCP server

`POST /api/mcp` (GET/DELETE for the streamable-HTTP protocol). Fresh server per request; ~106 tools. Session entrypoint for the coach is `get_today_plan` → kind-routes: fitness payload (workout/baselines/nutrition) vs project payload (scheduled items, feasibility, GitHub). Batched mutation tools (`baseline_ops`, `workout_ops`, `nutrition_log_ops`) exist specifically to avoid full-snapshot rewrites — prefer them.

Read tools must not leak private note types (standing_rule/review/open_item) — `mcp/leaky-reads.test.ts` enforces this; new read tools need coverage there.

After a deploy that changes the tool set, the claude.ai connector caches the old list — reconnect it.

Smoke test: see README "MCP server" section for the curl.

## Database safety (Neon is shared with prod)

- `npm run db:which` prints the target host. `db:migrate` / `db:seed` / `db:push` are all gated by `scripts/db-guard.ts --assert`, which refuses non-`development` `DB_ENV`.
- Treat every migration as semi-prod: validate the SQL diff before applying.
- `npm run db:verify-owned` / `db:verify-isolation` audit tenant scoping after schema changes that add owned models.

## Scripts

- `npm run dev` · `npm run build` · `npm run lint` · `npm run test` (Vitest, ~540 tests) · `npx tsc --noEmit`
- `npx prisma generate` — after any schema edit (postinstall also runs it + copies zxing wasm)
- `npm run db:migrate` / `db:seed` / `db:push` — guarded (see above)
- `npx tsx scripts/mint-invite.ts` — invite-gated signup tokens

## Conventions

- Mobile-first responsive — this is a phone-first PWA. Server components by default, `"use client"` only where needed.
- Owned-model DB access via `getDb()` (scoped); the raw singleton is for auth/OAuth infra only.
- All tool inputs validated with Zod; tools return structured content, no prose.
- All date math through `src/lib/calendar.ts` (USER_TZ vs Vercel-UTC).
- Workouts compared via `startedAt` (DateTime), not date-only — Strong exports include time-of-day.
- Keep `readiness.ts` / `rarity-core.ts` pure and client-safe (no Prisma imports).
- New MCP read tools: add leaky-reads coverage. New owned models: run the isolation verifiers.
- Tests sit next to source (`*.test.ts`); run `npm run test` before committing engine/OAuth/plan changes.
