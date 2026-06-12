# Quality Tools — workout-planner

Concrete commands and gotchas for QA / Devil's-Advocate / Developer agents working in this repo. Slot this into agent prompts whenever you need stack-specific context.

---

## Stack snapshot

Next.js 16.2.4 (App Router, Turbopack) · TypeScript 5 (strict) · React 19.2 · Tailwind v4 · Prisma 7.8.0 (Postgres / Neon) · `@modelcontextprotocol/sdk` ^1.29 · Zod 4.4.2 · Recharts. Generated Prisma client lives at `src/generated/prisma`. Single user, mobile-first PWA. **No tests configured** — manual smoke + typecheck + lint are the gates.

---

## QA gates

| Gate         | Command                                  | Notes |
|--------------|------------------------------------------|-------|
| Typecheck    | `npx tsc --noEmit`                       | Strict mode; cached incrementally |
| Lint         | `npm run lint`                           | ESLint v9 + `next/core-web-vitals` + `next/typescript` |
| Build        | `npm run build`                          | Turbopack production build; verifies SSR + every API route incl. `/api/mcp` |
| Dev server   | `npm run dev`                            | Open http://localhost:3000 — required for browser smoke + MCP curl below |
| Prisma sync  | `npx prisma generate`                    | Run after every `schema.prisma` edit |
| Prisma apply | `npx prisma migrate dev --name <slug>`   | ⚠ Neon-shared with prod — treat as semi-prod |

Tests do **not** exist. If you add Vitest/Playwright later, add a `Test` row above and update the QA-Agent prompt.

---

## MCP curl smoke

The MCP HTTP endpoint is the production surface for claude.ai. After any change to `src/lib/mcp/tools.ts` or anything it imports, smoke it locally with the dev server running:

```sh
TOKEN="$(grep MCP_AUTH_TOKEN .env | cut -d'"' -f2)"
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python3 -m json.tool | head -40
```

Then exercise each new/changed tool with `tools/call`. Read tools (`get_today_plan`, `recent_history`, `weekly_summary_data`) are the cheapest signal that data flows correctly. The deployed endpoint at `https://workout-planner-gold-three.vercel.app/api/mcp` works the same way.

---

## Browser smoke

1. `npm run dev`
2. Open http://localhost:3000 on phone width (DevTools mobile emulation, ≤390 px).
3. Walk every flow the change touches — the bottom-nav tabs (Today, Calendar, Records, Goals, Journal) plus any deep routes (e.g. `/nutrition`, `/days/[dateKey]`).
4. Cross-check against `get_today_plan` output via curl — UI and MCP must agree on `loggedNutrition`, `baselinesDue`, override `workoutTemplate`, etc.

---

## Stack gotchas

1. **Prisma 7 config split.** Datasource URL lives in `prisma.config.ts` (loaded by `prisma generate` / `migrate`), not in `schema.prisma`'s `datasource` block. Generator path is `src/generated/prisma`. Importing `Prisma` types from there: `import { Prisma } from "@/generated/prisma/client"`. Re-run `npx prisma generate` after any schema edit or the `Prisma.*` namespace types fall behind reality.
2. **MCP transport is stateless.** Each request creates a fresh `McpServer`, registers tools, and pipes through `WebStandardStreamableHTTPServerTransport.handleRequest` — see `src/app/api/mcp/route.ts` and `src/app/api/mcp/[token]/route.ts`. Bearer token is the only auth gate. There is no session memory between requests.
3. **Next 16 + Turbopack.** Faster builds, but older docs may reference Webpack-flavored config that doesn't apply. When unsure, consult `node_modules/next/dist/docs/`.
4. **No runtime LLM calls.** This app is a logger + dashboard; all reasoning happens in claude.ai via MCP. Don't add `anthropic` / `openai` imports.
5. **USER_TZ correctness.** `USER_TZ` defaults to `America/Denver`. **Every** date/time helper goes through `@/lib/calendar` (`dateKey`, `parseDateKey`, `startOfDay`, `endOfDay`, `addDays`, `startOfWeekMonday`, `endOfWeekSunday`). Raw `setHours(0,0,0,0)` / `getDate()` against `process.env.TZ=UTC` (which Vercel runs as) silently rolls "today" at the wrong moment. The MCP write tools must use `parseDateInput` from `tools.ts` for any `date: string` input — bare `yyyy-mm-dd` is otherwise parsed as UTC midnight (yesterday in MT).
6. **Strong-app workouts compared by `startedAt` (DateTime), not date-only.** Strong exports include time-of-day; preserve it. The parser is regression-tested against `examples/sample-completed-workout.txt`.
7. **Override-aware reads.** Today's workout = `resolveDay(now).workoutTemplate`, never `getTodayContext().day`. Same for baselines: `resolveDay(now).baselinesDue` honors `PlanDayOverride.baselineTestNames`; the rotation default does not.
8. **`revalidatePath` after every server-action mutation.** `/`, `/history`, plus the route the change is most visible on. Otherwise the server-rendered Today page serves stale state.
9. **Migrations on Neon are shared with prod.** `prisma migrate dev` writes the dev DB, which IS the prod DB for this app. Validate the SQL diff before running. A Vercel redeploy is what makes the new client visible to users.
10. **Single user, no PRs.** This repo pushes directly to `main` with conventional commits (`feat:`, `fix:`, `MCP write tools: …`). No PR workflow exists. If a feature warrants a branch + PR, ask first.

---

## Environment Variables

| Variable | Where set | Required for | Scope / Notes |
|----------|-----------|-------------|---------------|
| `DATABASE_URL` | `.env` / Vercel | All DB access | Neon Postgres connection string |
| `MCP_AUTH_TOKEN` | `.env` / Vercel | MCP endpoint auth (`/api/mcp`) | 32-byte hex; generate with `openssl rand -hex 32`; never echo in scripts |
| `GITHUB_TOKEN` | `.env` / Vercel | GitHub tool pack (Epic C) | PAT scopes: `repo` + `read:project`. Local: `gh auth token`. Vercel: set via dashboard, NOT CLI. `link_github_project` works without it. |

**Never-echo rule**: none of these values may appear in log output, curl commands, tool responses, captured artifacts, or committed files. The GitHub tool pack has a module-private `sanitize()` layer that redacts `GITHUB_TOKEN` from all error messages before surfacing them via MCP. `.env` is gitignored. `.env.example` contains placeholder strings only.

**Vercel note**: after adding `GITHUB_TOKEN` to Vercel environment variables, trigger a redeploy for the new env to be available to the running instance. The MCP connector in claude.ai caches tool lists — if tool count or names change, the connector may need a disconnect/reconnect to pick up the new tools.
