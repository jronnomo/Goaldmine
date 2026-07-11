# Completion report — #250 — 2026-07-11 · De-founder the MCP surface

## Shipped (commit 3d58429, merged on feature/phase1-auth; +137/-34 across 10 files)
1. **instructions.ts**: the founder block (weight/Elbert/Black Cloud/gym/Chewgether) DELETED — the per-user mechanism already existed (get_today_plan/get_session_brief deliver it live; the block was redundancy). Kind-routing genericized; the set_active_goal covenant reworded with force preserved (and its latent one-direction-only warning bug fixed as a byproduct — DA catch); **new rule 15** covers the one genuine orphan the DA found: available-equipment context, which NO tool serves live. Rules 1-14/principles/rhythms byte-untouched.
2. **Badge**: elbert-ready → summit-ready ("Summit Ready"/"SR"). The AC's "id migration" requirement DISSOLVED in premise check — badges are recomputed from Hike rows every render; no id persisted anywhere.
3. **Tool descriptions** (the issue's 3 sites had drifted AND were incomplete — 10 sites fixed): tools.ts ×4 (incl. the founder's exact 155 lb target in the update_goal_targets example → generic 175), github-tools ×5 (jronnomo/Chewgether → acme/roadmap-app), project-tools ×1.
4. **metrics-registry**: MT_ELBERT_DEFAULT_TARGETS → HIKE_DEFAULT_TARGETS, prose genericized (research-grounded rationale kept); imports updated incl. TWO scripts the issue missed (seed-goal, apply-grounded-defaults — DA catch, tsc would have failed).
5. **`no-founder-leak.test.ts`** — the permanent re-leak guard (N6 pattern): fs-reads exactly 7 files (no globbing — a legit jronnomo User-Agent lives in food-actions.ts), comment-stripped, 6 founder tokens, 7 sub-tests.
6. **#254 filed**: the BIGGER leak found in the sweep — program-template.ts scaffolds the founder's literal Elbert program into every new fitness goal via createGoalCore. Product-design work, properly separated.

## Verification
- Gates: tsc 0 · lint 0 errors, no disables · **829/829** (822 + 7) · build OK · mcp suites 54/54.
- **MCP curl before/after** (dev agent, local server, token never echoed): tool count **106 → 106**, exactly the 6 intended tools show description diffs, initialize instructions confirmed founder-token-free with rule 15 present.
- **AC-literal grep honesty**: `grep Elbert src/lib/mcp src/lib/game` returns 3 hits — ALL comments/fixtures (the header changelog describing what was removed, the guard test's own explanatory comment, a pre-existing today-shapers fixture that is sample DATA and explicitly out of scope). ZERO founder tokens in SERVED content — which is what the guard test enforces forever. The amended criterion (served-content zero) is the meaningful one and is met.

## Ship checklist (post-deploy)
- Connector cache: MCP_SERVER_VERSION auto-bumps per deploy → clients refetch instructions + descriptions automatically; manual connector toggle off/on is the fallback (gotchas §C).
- Founder note: your coach's context now arrives ONLY via tools (weight trend, goals, standing rules — all already tool-delivered) + your claude.ai-side memory. Expected: zero behavioral difference; if the coach ever seems to "forget" the gym setup, that's rule 15 working as designed (it will ask).

## Process
Premise check (inventory doubled; badge AC dissolved; program-template found + separated; live-confirmed the leak in this session's own MCP block) → PRD → DA **APPROVE-WITH-CONDITIONS** (equipment orphan → rule 15; covenant rewrite fixing the latent bug; exact guard scoping; the two missed scripts; caught the AC's own grep missing metrics-registry) → dev agent (stale base self-corrected; before/after curl evidence) → gates. Zero iterations.

## Remaining backlog
#252 (nested-dialog bug), #251 (web push), #254 (new — program template). **Undeployed on the branch: hardening set (#245-247) + this. Recommend /launch-gate + deploy.**
