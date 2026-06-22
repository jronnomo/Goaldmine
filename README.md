# Goaldmine

**An honest, AI-coached, multi-domain goal engine.** Started as a personal Mt. Elbert
training planner; it's now a generic platform for pursuing *any* measurable goal —
fitness, a software launch, a creative project — with a coach that tells you the truth
about where you actually stand.

The twist: **the app holds zero LLM calls.** Claude reasons in **claude.ai**, reading and
writing through an **MCP server** the app exposes. You get a frontier-model coach with no
API keys and no per-token cost — it runs against an existing Claude subscription. The app
itself is a deterministic logger + dashboard + honesty engine.

> Repo/package legacy name: `workout-planner`. Product name: **Goaldmine**.

---

## Why it's different — three moats

1. **Intellectual honesty ("no sugar-coating").** Most trackers flatter you. Goaldmine
   refuses: an untested target counts as **0** (never a false 100%), a hard **gate** caps
   the headline score at 80 until it clears, coverage (`{tested, total}`) is always shown,
   and a **feasibility** read tells you when your target date is a fantasy ("at your
   logging pace you reach ~62% by Sep 30 — this is a stretch"). The math that tells you
   the truth is unit-tested.
2. **The AI-coach loop.** `claude.ai ⇄ /api/mcp` is something no tracker has — the coach
   reasons over your real data and writes back (logs, plan revisions, gates, reviews,
   nudges). All reasoning lives in the conversation; the app stays LLM-free.
3. **Goal-genericity.** One schema (`GoalTarget`: metric / target / weight / direction /
   gating) + one `computeReadiness` + one generic `log:` metric path serve every domain.
   Open a fitness goal and the recap reads `WORKOUTS / VOLUME / PRs`; open a project goal
   and the *same* engine reads `MRR / MILESTONES`. Kind-aware surfaces, one engine.

---

## Architecture

```
claude.ai (web + mobile)  ──MCP / HTTP──▶  Next.js  /api/mcp  ──▶  Postgres (Neon)
   (the coach: reasons,                       │  (deterministic
    writes back via tools)                    │   read/write tools,
                                              │   no LLM calls)
                                              └──▶  Dashboard (Today, Calendar,
                                                     Records, Goals, Recap, Coach…)
```

- **No LLM in the app.** Claude reasons in claude.ai; the MCP tools are pure read/write.
- **Auth:** a single bearer token (`MCP_AUTH_TOKEN`) gates `/api/mcp`.
- **USER_TZ-correct:** every date helper goes through `@/lib/calendar` (Vercel runs UTC).

---

## The Forge ecosystem (the content flywheel)

Goaldmine is one of three "Forge" apps that compound:

- **Goaldmine** — records the work and coaches the goal.
- **ClipForge** — an agent-driven video editor (its own MCP server) that turns footage into Reels.
- **chewgether / ChewForge** — a second real vertical (an app-launch goal: App Store + $1k/mo MRR),
  proving the engine is domain-agnostic.

The flywheel: a **proactive-coach Sunday routine** generates a weekly recap card and nudges
you to post it; **footage markers** on a Day page tag which clip is which moment; and a
**Goaldmine → ClipForge bridge** feeds that curation into ClipForge so the tool that
*documents* the work also *tells its story*. See
[`docs/integrations/goaldmine-clipforge-bridge.md`](docs/integrations/goaldmine-clipforge-bridge.md).

---

## Key features

- **Honest readiness + feasibility engine** — `src/lib/readiness.ts`, `src/lib/rarity-core.ts`
  (gating cap, untested=0, coverage, decrease metrics, per-target feasibility tiers). Unit-tested.
- **Weekly Recap Card** — shareable 9:16 image + Stories from logged data, goal-generic stat
  slots, one-tap Web Share, "Posted ✓" post-state (`/recap`, `generate_recap_card`).
- **Proactive coach** — a scheduled claude.ai routine writes a weekly brief + a recap-ready
  nudge; the in-app `/coach` surface displays + dismisses them
  (`docs/coaching/proactive-coach-routine.md`).
- **Footage markers → ClipForge** — tag clips (filename / exercise / hero) to a day; expose
  the structured day + markers via MCP for ClipForge to assemble a Reel.
- **Goal-kind-aware surfaces & feasibility readout** — Today, goal page, and recap adapt to
  `goal.kind`.
- **Game layer** — streaks, XP, badges (`src/lib/game/`).

---

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript (strict) · React 19 · Tailwind v4 ·
Prisma 7 (Postgres / Neon) · `@modelcontextprotocol/sdk` · Zod 4 · Recharts · Vitest.
Generated Prisma client at `src/generated/prisma`. Mobile-first PWA, single user.

> Next 16 + Prisma 7 are recent: the Prisma generator is `prisma-client` (not `-js`) and
> the datasource URL lives in `prisma.config.ts`, not the schema's datasource block.

---

## Getting started

```bash
npm install
cp .env.example .env          # set DATABASE_URL (Neon or local Postgres) + MCP_AUTH_TOKEN

npx prisma generate           # regenerate the client after any schema edit
npx prisma migrate dev        # apply migrations  (⚠ Neon is shared with prod — treat as semi-prod)
npx prisma db seed            # seed the active program (idempotent)

npm run dev                   # http://localhost:3000
```

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Typecheck | `npx tsc --noEmit` |
| Lint | `npm run lint` |
| Build | `npm run build` |
| Unit tests | `npm run test` (Vitest) |
| Prisma client | `npx prisma generate` |
| Migration | `npx prisma migrate dev --name <slug>` |
| Seed | `npx prisma db seed` |

### Environment

| Variable | Required for | Notes |
|----------|--------------|-------|
| `DATABASE_URL` | all DB access | Neon Postgres connection string |
| `MCP_AUTH_TOKEN` | `/api/mcp` auth | 32-byte hex (`openssl rand -hex 32`); never echo it |
| `GITHUB_TOKEN` | the GitHub tool pack (project goals) | PAT: `repo` + `read:project` |

---

## MCP server

`POST /api/mcp` (also GET/DELETE for the streamable-HTTP protocol). Stateless transport,
bearer-token auth. Tools registered in `src/lib/mcp/tools.ts`. ~90 read/write tools — e.g.
`get_today_plan`, `recent_history`, `get_goal`, `weekly_summary_data`, `compute_readiness`,
`generate_recap_card`, `get_day_footage`; `log_workout`, `log_measurement`, `create_goal`,
`apply_day_override`, `log_footage`, `log_open_item`.

Connect from claude.ai → custom connector → URL `https://<deployment>/api/mcp`, Bearer
`MCP_AUTH_TOKEN`, Streamable HTTP. (Reconnect after deploys that change the tool set.)

Smoke test locally:

```bash
TOKEN="$(grep MCP_AUTH_TOKEN .env | cut -d'"' -f2)"
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python3 -m json.tool | head -40
```

---

## Project structure

```
src/app/                 App Router pages (Today /, Calendar, Records, Goals, Recap, Coach…)
  api/mcp/               the MCP HTTP endpoint
src/lib/                 calendar · db · readiness · rarity-core · recap · records · game
  mcp/tools.ts           every MCP tool registration
src/components/          mobile-first UI (Card, BottomNav, day forms, RecapClient…)
prisma/                  schema.prisma · migrations · seed.ts
docs/                    PRDs, roadmap, coaching, qa, ux-research, integrations
CLAUDE.md                architecture + conventions (read before contributing)
```

---

## Docs

- [`CLAUDE.md`](CLAUDE.md) — architecture & conventions (start here)
- [`docs/project-gotchas.md`](docs/project-gotchas.md) — the non-obvious traps
- [`docs/roadmap/multi-domain-transformation-brief.md`](docs/roadmap/multi-domain-transformation-brief.md) — the strategic direction
- [`docs/coaching/proactive-coach-routine.md`](docs/coaching/proactive-coach-routine.md) — the Sunday routine
- [`docs/coaching/coach-operating-manual.default.md`](docs/coaching/coach-operating-manual.default.md) — default reasoning-discipline instructions (generic core + flavor slots)
- [`docs/roadmap/onboarding-coach-operating-manual.md`](docs/roadmap/onboarding-coach-operating-manual.md) — parked: generate a personalized coach manual from the goal interview
- [`docs/integrations/goaldmine-clipforge-bridge.md`](docs/integrations/goaldmine-clipforge-bridge.md) — the ClipForge bridge
- `docs/prds/` — per-feature PRDs · `docs/qa/` — QA gates

---

## Status

The multi-domain engine is substantially built: the honesty math (readiness + feasibility)
is unit-tested; the content flywheel (recap card → proactive nudge → Web Share post-state)
is live; goal-kind-aware surfaces and feasibility readouts ship; the footage-marker →
ClipForge bridge is specced and both ends are built. Next up: the goal-interview onboarding
(usable by not-just-the-author) and deepening the ClipForge integration.

---

## Notes

Single-user, mobile-first, **$0 beyond an existing Claude subscription**. Neon is shared
with prod — every `prisma migrate dev` is semi-prod; validate the SQL diff first.
