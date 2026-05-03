# Workout Planner

Personal workout-tracker + coaching app. The user (single user) follows a 90-day Mt. Elbert / shred / longevity program. They chat with Claude in **claude.ai** for coaching; this app exposes an **MCP server** with read/write tools (no LLM calls inside the app). Cost is $0 beyond the user's existing Claude Code Max subscription.

See: `/Users/ggronnii/.claude/plans/research-and-vet-out-cached-sloth.md` for the full plan.
See: `/Users/ggronnii/.claude/projects/-Users-ggronnii-Development/memory/fitness-profile.md` for the user's fitness context.

## Architecture

```
claude.ai (web + mobile)  ──MCP/HTTP──>  Next.js /api/mcp  ──>  Postgres (Neon)
                                          │
                                          └──>  Dashboard pages (logger, history, charts)
```

- **No LLM calls live in this app.** Claude reasons in claude.ai. The MCP tools are pure read/write.
- **Auth:** single bearer token (env `MCP_AUTH_TOKEN`), gates `/api/mcp` and (eventually) the dashboard.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4 + Turbopack
- Prisma 7 (modern style: datasource URL via `prisma.config.ts`, generated client at `src/generated/prisma`)
- `@modelcontextprotocol/sdk` for the MCP server
- Recharts for progress visualizations
- `zod` for tool input validation
- `tsx` + `dotenv` for the seed script

## Important: Next.js 16 + Prisma 7 are recent

`AGENTS.md` warns that Next 16 has breaking changes vs older Next docs in training data. The Prisma generator is `prisma-client` (not `prisma-client-js`) and the datasource URL lives in `prisma.config.ts`, not the schema's datasource block. Follow the docs in `node_modules/next/dist/docs/` and `node_modules/prisma/dist/` if anything looks off.

## Key directories

- `prisma/schema.prisma` — DB schema. Run `npx prisma generate` after edits. Run `npx prisma migrate dev` to apply.
- `prisma/seed.ts` — seeds the active 90-day Program. Idempotent.
- `src/lib/program-template.ts` — source of truth for the 12-week program (phases, weekly split, baseline week, hiking superset).
- `src/lib/parsers/strong.ts` — deterministic parser for Strong-app txt exports. Regression-tested against `examples/sample-completed-workout.txt`.
- `src/lib/formatters/{strong,markdown,plain,json,index}.ts` — export formatters. `strong` round-trips the input format.
- `src/lib/db.ts` — Prisma client singleton.
- `src/app/api/mcp/route.ts` — MCP HTTP endpoint (Phase 3, not yet built).
- `src/lib/mcp/tools/*.ts` — one file per MCP tool (Phase 3).

## MCP server (Phase 3, shipped)

Endpoint: `POST /api/mcp` (also GET, DELETE for the streamable HTTP protocol). Stateless transport (`enableJsonResponse: true`, no session id). Bearer-token auth — `Authorization: Bearer $MCP_AUTH_TOKEN`.

All tools are registered in `src/lib/mcp/tools.ts` via `McpServer.registerTool()`. The route handler in `src/app/api/mcp/route.ts` creates a fresh server per request, registers tools, and pipes the request through `WebStandardStreamableHTTPServerTransport.handleRequest`.

### Read tools
`get_today_plan`, `get_day`, `recent_history`, `list_goals`, `get_goal`, `weekly_summary_data`, `get_baseline_schedule`, `get_baseline_history`, `get_records_summary`, `get_exercise_history`, `export_workout`.

### Write tools
`log_workout`, `log_measurement`, `log_baseline`, `log_hike`, `log_note`, `apply_plan_revision`, `apply_day_override`, `clear_day_override`, `update_goal_targets`, `add_goal_reference`.

`log_workout` accepts the structured shape produced by `parseStrongWorkout()` — paste a Strong-app txt in claude.ai, Claude parses, then calls this tool.

### Connecting from claude.ai

After deploying (Phase 4), the user adds a custom MCP connector in claude.ai's settings:
- URL: `https://<vercel-deployment>/api/mcp`
- Auth: Bearer token (paste `MCP_AUTH_TOKEN`)
- Transport: Streamable HTTP

Locally testable with curl — see `scripts/test-mcp.sh` (if present) or:
```
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Scripts

- `npm run dev` — Next.js dev server
- `npx prisma generate` — regenerate client after schema edits
- `npx prisma migrate dev --name <name>` — create + apply migration locally
- `npx prisma db seed` — run `prisma/seed.ts`

## Conventions

- Mobile-first responsive — this is a phone-first app
- Server components by default, `"use client"` only where needed
- All DB access via the `prisma` singleton from `src/lib/db.ts`
- Tool schemas validated with `zod` (Phase 3)
- Workouts compared via `startedAt` (DateTime), not date-only — Strong-app exports include time-of-day
