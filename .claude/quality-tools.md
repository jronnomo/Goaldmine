# Quality Tools — Goaldmine (repo: `jronnomo/goaldmine`, legacy name workout-planner)

Concrete commands and gotchas for QA / Devil's-Advocate / Developer agents working in this repo. Slot this into agent prompts whenever you need stack-specific context. For the longer-form war stories (plan cascade, records canonicalization, deferral semantics, connector cache), read `docs/project-gotchas.md` — especially §B before touching plan writes, records, or the MCP tool surface.

---

## Stack snapshot

Next.js 16.2.4 (App Router, Turbopack) · TypeScript 5 (strict) · React 19.2 · Tailwind v4 · Prisma 7.8 (Postgres / Neon, generator `prisma-client`, output `src/generated/prisma`) · `@modelcontextprotocol/sdk` ^1.29 · Zod 4 · Recharts 3 · next-auth v5 beta (Auth.js, Google sign-in, invite-gated signup) · Upstash rate limiting (fails open) · **Vitest 3** (~540 tests in ~34 `*.test.ts` files next to source; no live DB required).

**Multi-user + multi-tenant** mobile-first PWA. Every owned model carries `userId`; all owned-model DB access goes through the **tenant-scoped client** — `const db = await getDb()` from `src/lib/db.ts`. The raw `prisma` singleton is for auth/OAuth infrastructure only.

---

## QA gates

| Gate         | Command                                  | Notes |
|--------------|------------------------------------------|-------|
| Typecheck    | `npx tsc --noEmit`                       | Strict mode; cached incrementally |
| Lint         | `npm run lint`                           | ESLint v9 + `next/core-web-vitals` + `next/typescript` |
| Unit tests   | `npm run test`                           | Vitest, ~540 tests. Run before committing engine/OAuth/plan changes. **Convention:** any suite that `vi.mock("@/lib/db")` must dual-export `prisma` + `getDb` (`getDb` resolves to the fake client). |
| Build        | `npm run build`                          | Turbopack production build; verifies SSR + every API route incl. `/api/mcp` |
| Dev server   | `npm run dev`                            | http://localhost:3000 — required for browser smoke + MCP curl |
| Prisma sync  | `npx prisma generate`                    | Run after every `schema.prisma` edit |
| Prisma apply | `npm run db:migrate -- --name <slug>`    | Guarded — requires `DB_ENV=development` in `.env` |
| Tenant audit | `npm run db:verify-owned` / `npm run db:verify-isolation` | Run after any schema change that adds/changes an owned model |
| Leaky reads  | new/changed MCP **read** tools need coverage in `src/lib/mcp/leaky-reads.test.ts` | Read tools must not leak private note types (`standing_rule`/`review`/`open_item`) |

---

## Dev/prod DB split

Since **E0-1**, local `.env` points at a Neon **dev branch**; prod lives only in Vercel environment variables. `dotenv/config` loads `.env` (not `.env.local`) — `.env` is the canonical local DB config.

| Script | What it does |
|---|---|
| `npm run db:which` | Print `DATABASE_URL` host + `DB_ENV` label. Always run this first to confirm the target. |
| `npm run db:migrate` | Guard (`--assert`) then `prisma migrate dev` |
| `npm run db:seed` | Guard (`--assert`) then `prisma db seed` |
| `npm run db:push` | Guard (`--assert`) then `prisma db push` |

**Fail-closed behavior**: the guard (`scripts/db-guard.ts`) throws unless `DB_ENV=development` in `.env`. An unset or wrong value blocks the destructive command.

**Escape hatch**: `ALLOW_PROD_DB_WRITE=1` bypasses the guard with a loud `stderr` warning. Only for intentional prod schema operations.

**Migrations are still semi-prod**: they get applied to the prod Neon branch at deploy time — keep them additive/reversible and validate the SQL diff before applying.

---

## MCP curl smoke

The MCP HTTP endpoint is the production surface for claude.ai. **Primary auth in prod is the hand-built OAuth 2.1 server** (`src/lib/oauth/`, `/oauth/*` routes, `.well-known` discovery); the **legacy bearer token (`MCP_AUTH_TOKEN`) still works and is the local smoke path.** After any change to `src/lib/mcp/tools.ts`, the tool packs in `src/lib/mcp/tools/`, or anything they import, smoke it locally with the dev server running:

```sh
TOKEN="$(grep MCP_AUTH_TOKEN .env | cut -d'"' -f2)"
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python3 -m json.tool | head -40
```

Then exercise each new/changed tool with `tools/call`. Read tools (`get_today_plan`, `get_session_brief`, `weekly_summary_data`) are the cheapest signal that data flows correctly. ~106 tools total: the main registrations live in `src/lib/mcp/tools.ts`, plus packs in `src/lib/mcp/tools/{github,project,render}-tools.ts`. The deployed endpoint at `https://workout-planner-gold-three.vercel.app/api/mcp` works the same way (Vercel project kept the legacy name).

---

## Browser smoke

1. `npm run dev`
2. Open http://localhost:3000 on phone width (DevTools mobile emulation, ≤390 px). You may need to sign in — routes are protected by `src/middleware.ts` + `src/lib/auth/route-access.ts`.
3. Walk every flow the change touches — the bottom-nav tabs (**Today · Plan · Log(sheet) · Progress · More(sheet)**) plus any deep routes (`/calendar`, `/days/[dateKey]`, `/goals`, `/baselines`, `/nutrition`, `/character`, `/recap`, `/compare`, `/onboarding`, `/settings`).
4. Cross-check against `get_today_plan` output via curl — UI and MCP must agree on `loggedNutrition`, `baselinesDue`, the resolved day task, etc.

---

## Stack gotchas

1. **Prisma 7 config split.** Datasource URL lives in `prisma.config.ts` (loaded by `prisma generate` / `migrate`), not in `schema.prisma`'s `datasource` block. Generator is `prisma-client` (NOT `prisma-client-js`), output `src/generated/prisma`. Importing types: `import { Prisma } from "@/generated/prisma/client"`. Re-run `npx prisma generate` after any schema edit.
2. **Tenant scoping is mandatory.** Owned-model reads/writes go through `const db = await getDb()` (`src/lib/db.ts`) — it enforces the `userId` filter. Never query owned models with the raw `prisma` singleton (that's for auth/OAuth infra only). New owned models: add `userId` + index, then run `npm run db:verify-owned` and `npm run db:verify-isolation`. Isolation is unit-tested in `src/lib/db.scoped.test.ts`.
3. **MCP transport is stateless.** Each request creates a fresh `McpServer`, registers tools, and pipes through the streamable-HTTP transport — see `src/app/api/mcp/route.ts` (OAuth 2.1 or legacy bearer) and `src/app/api/mcp/[token]/route.ts` (legacy token-in-path). No session memory between requests.
4. **Don't touch OAuth/auth token logic casually.** `src/lib/oauth/` (PKCE, DCR, refresh rotation with family reuse-detection, RFC 8707 audience binding) and `src/lib/auth/` are fully unit-tested — run `npm run test` after any change there.
5. **No runtime LLM calls.** All reasoning happens in claude.ai via MCP. Don't add `anthropic` / `openai` imports, and never propose an API key — $0-beyond-subscription is a core product constraint.
6. **USER_TZ correctness.** `USER_TZ` defaults to `America/Denver`; Vercel runs UTC. **Every** date/time helper goes through `@/lib/calendar` / `calendar-core` (`dateKey`, `parseDateKey`, `startOfDay`, `endOfDay`, `addDays`, `startOfWeekMonday`, `endOfWeekSunday`). Raw `setHours(0,0,0,0)` / `getDate()` silently rolls "today" at the wrong moment. MCP write tools must use `parseDateInput` (`src/lib/mcp/tool-helpers.ts`) for any `date: string` input.
7. **Deferral-aware day reads.** `resolveDay(date)` (`src/lib/calendar.ts`) is the single source of truth for what a day IS. Switch on `todayTask` and render `activeWorkout` (the day's task) + `deferredWorkout` (the session that stepped aside). The old `workoutTemplate` field was **removed**, and `workoutDeferredForBaseline`/`workoutDeferredForHike` are deprecated — never re-derive the day's task from those. `getTodayContext()` is rotation-only (no overrides) — never use it for a rendered day.
8. **Strong-app workouts compared by `startedAt` (DateTime), not date-only.** Strong exports include time-of-day; preserve it. Parser regression-tested against `examples/`.
9. **`revalidatePath` after every server-action mutation.** `/` plus every route that displays the mutated data. Otherwise the server-rendered Today page serves stale state.
10. **Leaky reads.** MCP read tools must not leak private note types (`standing_rule`/`review`/`open_item`) or another tenant's rows. New read tools need a case in `src/lib/mcp/leaky-reads.test.ts` — this is enforced, not optional.
11. **Rate limiting fails open.** Upstash-backed (`src/lib/rate-limit.ts`, edge middleware + MCP). Missing env vars = no limiting, not an outage; don't "fix" that fail-open behavior.
12. **Records/PRs canonicalize by hand-curated alias map.** `EXERCISE_ALIAS_GROUPS` in `src/lib/records.ts`. A new baseline test or Strong spelling variant re-fragments PRs until added. Before merging a variant, confirm it's the same metric (see `docs/project-gotchas.md` §B.2).
13. **`planJson` is a snapshot, not the source template.** Live behavior reads `plan.planJson`; editing `src/lib/program-template.ts` alone changes nothing for existing plans. Prefer the batched mutation tools (`baseline_ops`, `workout_ops`, `nutrition_log_ops`) over full-snapshot rewrites.
14. **Solo dev, branch-per-phase.** Work happens on the currently checked-out branch — often a long-lived phase branch (e.g. `feature/phase1-auth`) that accumulates features before merging. **Pushing/merging to `main` = deploying** (Vercel auto-builds `main`). No PR ceremony by default; ask before opening one or before merging to `main`.

---

## Environment Variables

| Variable | Where set | Required for |
|----------|-----------|-------------|
| `DATABASE_URL` | `.env` (dev branch) / Vercel (prod) | All DB access |
| `DB_ENV` | `.env` | `db-guard.ts` — must be `development` locally |
| `MCP_AUTH_TOKEN` | `.env` / Vercel | Legacy bearer auth for `/api/mcp` (OAuth 2.1 is the primary prod path) |
| `AUTH_SECRET` | `.env` / Vercel | Auth.js session signing |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | `.env` / Vercel | Google sign-in |
| `OPEN_SIGNUP` | `.env` / Vercel | Invite-gate bypass toggle (default: gated; mint invites via `npx tsx scripts/mint-invite.ts`) |
| `FOUNDER_USER_ID` / `FOUNDER_GOOGLE_EMAIL` | `.env` / Vercel | Founder-account cutover/identity |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | `.env` / Vercel | Rate limiting (fails open if absent) |
| `GITHUB_TOKEN` | `.env` / Vercel | GitHub tool pack. PAT scopes: `repo` + `read:project`. `link_github_project` works without it. |

**Never-echo rule**: none of these values may appear in log output, curl commands, tool responses, captured artifacts, or committed files. The GitHub tool pack has a module-private `sanitize()` layer redacting `GITHUB_TOKEN` from error messages. `.env` is gitignored; `.env.example` holds placeholders only.

**Vercel note**: after adding an env var in Vercel, trigger a redeploy. The claude.ai MCP connector caches tool lists — if tool count or names change, reconnect the connector.
