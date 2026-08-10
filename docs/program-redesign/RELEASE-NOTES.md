# Program Redesign — deployer release notes

Short, append-only checklist lines for whoever deploys a program-redesign
sprint. Full wire-level detail lives in `TOOL-DIFFS.md` (same directory).
Newest at the top.

---

## Sprint 18 — Program-shaped day (#282–#286)

- [ ] **Reconnect the claude.ai MCP connector after this deploy.** Four read
      tools changed descriptions and `get_today_plan` changed output shape
      for Program users; the connector caches the old tool list/schemas until
      reconnected (Settings → Connectors → Goaldmine → reconnect). Per root
      `CLAUDE.md`: "After a deploy that changes the tool set, the claude.ai
      connector caches the old list — reconnect it."
- [ ] **Re-paste the connector Instructions text** from
      `docs/server-instructions/goaldmine-rules.md` — the goal-kind routing
      block changed (merged program-shaped payload replaces the
      project-vs-fitness fork for Program users).
- [ ] Heads-up for in-flight saved prompts: on a project-focus day,
      `isInPlan`/`confidence` no longer reflect an unrelated plan's window,
      and Program users no longer get the nulled project payload (see
      TOOL-DIFFS "behavior change most likely to surprise" call-out).
