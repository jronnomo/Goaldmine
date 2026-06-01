# Roadmap Plan Template (goaldmine)

Reference for `/roadmap`. The orchestrator uses this in Phase 2 to write the concrete architecture plan at `docs/roadmap/<slug>-plan.md`, and the story shape in Phase 3 for `docs/roadmap/<slug>-backlog.md` + `backlog.json`. The plan is the source of truth for the design; the backlog is the source of truth for the stories that land on board #8.

---

## Part A — Architecture Plan (`docs/roadmap/<slug>-plan.md`)

```markdown
# Roadmap: {{Initiative}}

**Author**: Claude (Planning Lead) + Gabe
**Date**: {{YYYY-MM-DD}}
**Status**: Draft | Approved
**Board**: Goaldmine Roadmap (#8)

## 1. Problem & End-State
- What's limiting today (cite real files/models), the target end-state, and why now.

## 2. Driving Vertical(s)
- The concrete use-case(s) the design must satisfy — e.g. fitness (Mt. Elbert) AND the chewgether "$1k/mo" launch. Every generic decision is validated against BOTH.

## 3. Non-Goals
- Explicit out-of-scope (prevents the backlog ballooning into two projects).

## 4. Target Architecture
### 4.1 Data model (Prisma)
- New/changed models, fields, indexes, JSON shapes. Migration plan (additive, Neon-safe). Coexist-vs-migrate posture for the existing fitness tables.
### 4.2 MCP tool surface
- New/changed tools. Per-domain typed packs vs generic. Discoverability (keyword-rich descriptions). Connector-reload implications.
### 4.3 Readiness / metrics
- How metrics generalize (e.g. metric value = latest LogEntry) so any numeric goal scores.
### 4.4 UI seams
- Goal-type-aware surfaces (Today/calendar/plan). Server-components-by-default; USER_TZ via `@/lib/calendar`.
### 4.5 Coaching / prompt
- How Claude knows the goal type and which tool pack to use.

## 5. Phasing
- Ordered slices (→ epics → sprints). What each unlocks. What leaves `main` deployable.

## 6. Risks & Open Questions
- Migration safety, abstraction-from-one-example, scope creep, USER_TZ, two-system coexistence cost.
```

---

## Part B — Story shape (`backlog.json` entries)

Each story is **one `/feature-dev` run**. JSON fields:

```json
{
  "epic": "Generic data spine",
  "title": "Add ScheduledItem + LogEntry Prisma models",
  "value": "so any goal can schedule actions and record observations without per-domain tables",
  "acceptanceCriteria": [
    "Migration is additive (nullable/new tables only); npx prisma migrate diff shows no destructive ops",
    "npx tsc --noEmit + npm run build green",
    "Models carry goalId FK + indexes on (goalId, date)"
  ],
  "touches": ["prisma/schema.prisma", "src/generated/prisma (regen)"],
  "effort": "Small | Medium | Large",
  "priority": "P0 - Critical | P1 - High | P2 - Medium | P3 - Low",
  "dependsOn": ["<other story title>"],
  "sprint": "Sprint 1 - Generic data spine"
}
```

**Story quality bar:**
- Independently buildable & verifiable (testable acceptance criteria — typecheck/build, MCP curl shape, page renders at 390px, migration additive).
- Effort=Large with >~5 acceptance criteria ⇒ it's an epic; split it.
- Dependencies reference other story titles (no cycles).
- Every story belongs to exactly one epic and one sprint (or Backlog).

---

## Part C — Epic → Sprint mapping
- One epic ≈ one sprint (a shippable slice). Rename board #8's Sprint options to the epic names in Phase 4.
- Order sprints so each leaves `main` deployable and front-loads P0s / unblockers.
