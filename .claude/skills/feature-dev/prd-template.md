# PRD Template (goaldmine)

Reference document for `/feature-dev`. The orchestrator uses this template when creating the Product Requirements Document in Phase 2.

---

## Template

The PRD must follow this exact structure. Every section is mandatory — use "N/A" if a section genuinely doesn't apply (but think hard before marking N/A).

```markdown
# PRD: {{Feature Name}}

**Author**: Claude (Tech Lead) + Gabe
**Date**: {{YYYY-MM-DD}}
**Status**: Draft | Approved | In Development | Complete
**GitHub Issue**: {{link or "N/A — direct-to-main"}}
**Branch**: {{branch or "main"}}

---

## 1. Overview

### 1.1 Problem Statement
What problem does this feature solve? Why does it matter to the user?

### 1.2 Proposed Solution
High-level description of what we're building. 2–3 paragraphs max.

### 1.3 Success Criteria
How do we know this feature is successful? Measurable outcomes (e.g., "Today renders the override workout when one exists; baselines log inline with checkmark feedback").

---

## 2. User Stories

This is a multi-user, multi-tenant app (founder + invite-gated users). Frame stories per actor: a user acting through the PWA, the coach (Claude in claude.ai) acting via MCP, or a brand-new user onboarding with zero rows. Call out if a story is founder-only.

| ID     | As a... | I want to... | So that... | Priority |
|--------|---------|--------------|------------|----------|
| US-001 |         |              |            | Must Have |
| US-002 |         |              |            | Should Have |
| US-003 |         |              |            | Nice to Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements
Numbered list of must-have functionality.

### 3.2 Secondary Requirements
Numbered list of should-have functionality.

### 3.3 Out of Scope
Explicitly list what this feature does NOT include (prevents scope creep).

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
Schema additions and modifications. Use code blocks for clarity:

```prisma
// New / modified models, with fields, types, nullability, defaults, indexes
// Owned models MUST carry userId (+ index) and be accessed via getDb()
```

Migration plan:
- Migration name: `<slug>`
- Commands: `npm run db:migrate -- --name <slug>` (guarded; `npm run db:which` first) then `npx prisma generate`
- ⚠ Migrations reach prod at deploy: confirm additive / reversible / safe for existing rows; validate the SQL diff
- If an owned model is added/changed: run `npm run db:verify-owned` + `npm run db:verify-isolation`
- Backfill plan if any rows need updating

### 4.2 MCP Tool Surface
For each new / modified tool:

| Tool name | Purpose | Read/Write | Notes |
|-----------|---------|------------|-------|

For each entry, document:
- **Title**, **description** (what claude.ai sees)
- Full **Zod inputSchema** (with `.describe()` annotations)
- **Return shape** (named arrays / `{ id, message }`-style)
- **Read tools**: the leaky-reads test case being added (`src/lib/mcp/leaky-reads.test.ts`) — no private note types, no cross-tenant rows
- Sample `tools/call` curl invocation:
  ```sh
  curl -s -X POST http://localhost:3000/api/mcp \
    -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}'
  ```

### 4.3 Server Actions
List every new / modified server action in `src/lib/workout-actions.ts` (or new actions file):

| Action | FormData fields | Mutation | revalidatePath calls | Redirect? |
|--------|------------------|----------|----------------------|-----------|

### 4.4 Pages / Components
- **New routes**: paths under `src/app/`, server-vs-client classification
- **New components**: paths under `src/components/`, server-vs-client, prop shapes
- **Modified pages/components**: what changes, why
- **Navigation**: any `BottomNav` updates? Deep-link entry points?

### 4.5 Date / Time Semantics
- All Date math through `@/lib/calendar`
- Any new MCP tool with a `date: string` input must use `parseDateInput`
- DST behavior verified — week math uses `startOfWeekMonday` / `endOfWeekSunday` / `addDays` (USER_TZ-aware)

### 4.6 Deferral / Override Awareness
- Does any new view depend on per-day plan state? If so, document that it reads via `resolveDay(now)` — switching on `todayTask` and rendering `activeWorkout`/`deferredWorkout` — not `getTodayContext()` (rotation-only). The old `resolveDay(...).workoutTemplate` field no longer exists.
- Does this feature add a new `PlanDayOverride` field or change semantics? Document migration of existing override rows

### 4.7 Tenant Scoping & Auth
- Which owned models are read/written? Confirm all access is via `getDb()` (never the raw `prisma` singleton)
- New routes: protected by default via `src/middleware.ts` / `route-access.ts`? Any intentionally public route justified?
- Does the feature touch session, invite gate, or OAuth flows? (If so: run the auth/OAuth test suites; don't modify token/grant logic lightly)

### 4.8 Third-Party Dependencies
Any new packages or external APIs. Justify each. (Never an LLM API — reasoning stays in claude.ai.)

---

## 5. UI/UX Specifications

### 5.1 Screen Descriptions
For each new/modified screen: layout description, key interactions, states (loading, empty, error, populated). Use ASCII / text mockups at 390 px width.

### 5.2 Navigation Flow
How the user gets to/from this feature. Entry points, exit points, back behavior. Note any `BottomNav` slot affected.

### 5.3 Responsive + Mobile-First Spec
- Primary width: 390 px (phone PWA)
- Tap targets ≥ 44 px
- Forms thumb-reachable
- Card-based layout (`<Card>`) by default
- Tailwind tokens: `var(--accent)`, `var(--accent-fg)`, `var(--border)`, `var(--card)`, `var(--muted)` — no hardcoded colors

### 5.4 Accessibility
- Form labels associated with inputs
- Visible focus rings on interactive elements
- Color-contrast adequate (especially for `var(--muted)` text)
- Charts (Recharts) have accessible axis labels

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| No active program | |
| Brand-new user (zero rows, mid-onboarding) | |
| Empty data (no rows yet) | |
| Invalid input | |
| Concurrent log + view (stale revalidation) | |
| DST transition spans the visible week | |
| Override exists but workoutJson is null | |
| Long text / overflow on phone width | |

---

## 7. Security Considerations

- Tenant isolation: every owned-model query via `getDb()`; no cross-tenant leakage possible; MCP read tools covered by leaky-reads tests
- Route protection: new routes covered by `src/middleware.ts` / `route-access.ts` unless intentionally public (justify)
- MCP auth coverage: OAuth 2.1 (primary) + legacy bearer — any new endpoint bypassing both?
- Rate limiting: does the new surface need it (Upstash, fails open)?
- Input validation: Zod for MCP tools; FormData parsing in server actions; Prisma type safety on the way out
- No `dangerouslySetInnerHTML` on user-provided strings
- No raw SQL (Prisma only) unless explicitly justified

---

## 8. Acceptance Criteria

Numbered checklist. Each item must be independently testable via typecheck / lint / build / MCP curl / browser walkthrough — agents can't visually test, so phrase criteria as code-level checks where possible.

1. [ ] `npx tsc --noEmit` passes with 0 errors
2. [ ] `npm run lint` introduces no new errors
3. [ ] `npm run build` succeeds
4. [ ] MCP `tools/list` returns the new tool with correct title + description
5. [ ] MCP `tools/call` returns expected shape for tool X with input Y
6. [ ] Page `/<route>` renders ... at 390 px width
7. [ ] Mutation Z calls `revalidatePath` for routes [...]
8. [ ] All Date math goes through `@/lib/calendar`
9. [ ] (any feature-specific criteria)

---

## 9. Open Questions

Any unresolved decisions or questions. **Should be empty before development starts** — UX research and follow-up Qs in Phase 1 should resolve these.

---

## 10. Test Plan

How will we verify this works end-to-end?

### 10.1 Typecheck / Lint / Tests / Build
- `npx tsc --noEmit` — must be clean
- `npm run lint` — no new errors
- `npm run test` — Vitest, no new failures; list the suites this feature adds/updates
- `npm run build` — Turbopack build succeeds

### 10.2 MCP curl smoke
For each new/modified tool, paste the curl invocation and the expected response shape. New read tools: confirm the leaky-reads case passes.

### 10.3 Browser smoke
1. `npm run dev`
2. Open http://localhost:3000 at 390 px width (sign in — routes are auth-protected)
3. Walk: <list of flows>
4. Cross-check each flow against `get_today_plan` / `get_session_brief` curl output

### 10.4 Migration verification (if applicable)
- Confirm `npm run db:which` shows the dev branch, then `npm run db:migrate` succeeds
- Confirm `src/generated/prisma` regenerates
- If an owned model was added/changed: `npm run db:verify-owned` + `npm run db:verify-isolation` pass
- Confirm existing rows still render correctly

---

## 11. Appendix

### 11.1 Discovery Notes
Summary of the discovery conversation with the user.

### 11.2 References
Links to related issues, PRDs, prior commits (`git log --oneline -10` extracts), or designs.
```

---

## Guidelines for the Orchestrator

When filling out the template:

1. **Be specific.** "The button submits the form" is bad. "Tapping the 'Log' button calls `logBaselineInline(formData)` which writes a `Baseline` row at `parseDateKey(today)` UTC offset, calls `appendBaselineToDayWorkout`, and `revalidatePath('/')` — the BaselineBlockCard row re-renders with a green ✓" is good.

2. **Include constraints from `CLAUDE.md` and `.claude/quality-tools.md`** — USER_TZ, override-aware reads, Prisma 7 split-config, MCP `safe()` wrapper, etc. should be reflected in the technical design and acceptance criteria.

3. **Err on the side of over-specifying.** Developer Agents work best with unambiguous instructions. If something could be interpreted two ways, pick one and document it.

4. **Acceptance criteria must be checkable without running the app.** Focus on code-level checks (file exists, function handles case X, type includes field Y, MCP curl returns shape Z) since agents can't visually test.

5. **Keep the PRD under 500 lines.** If it's longer, the feature should be split.

6. **No reference example yet.** As features ship through this skill, link the gold-standard PRDs here for future agents to model after.
