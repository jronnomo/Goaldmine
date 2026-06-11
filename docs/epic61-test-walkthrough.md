# Epic #61 — Full Test Walkthrough (Multi-goal Goaldmine)

Manual verification of all three phases (#62 awareness · #63 Reach · #64 intake) plus the review fixes.
**Budget:** ~30–40 min, on the phone. Flip light/dark at every step marked **[themes]** — those double as the owed `shipped*` device checks from the UX ledgers.

> Starting state assumed: Elbert = Focus (dated), Backflip + Handstand = Someday. Stack Reach = Uncommon.
> If anything below doesn't match, note the **step number** — each perceptual call has a designed fallback already named in `docs/ux-research/*-ledger.md`.

## 0 · Setup
- [ ] Vercel deploy is current (latest commit `9894300` or later).
- [ ] claude.ai → Settings → Connectors → **reload the Goaldmine connector**.
- [ ] Ask the coach "list your goaldmine tools" — expect `get_rarity`, `preview_goal_feasibility`, `promote_note_to_goal`, `set_goal_tracked`, `set_plan_active`, `set_goal_feasibility` among them.

## 1 · Goal states & glossary — /goals
- [ ] Three rows: **Elbert** with Focus badge (mini bullseye + word); **Backflip/Handstand** with Someday chip + **Set focus** pill + **Untrack** pill, no countdown.
- [ ] Each row subline has a small **Reach meter**: Elbert 2/5 muted ("Uncommon"); someday rows unrated (empty/—). **[themes]** Can you read 2-of-5 at a glance? *(UXR-63-07; fallback: word-chip)*
- [ ] **Stack Reach card** above the list shows Uncommon quietly — no warning banner.
- [ ] "What do these states mean?" expands to **eight rows** (… Reach, Trained) with real chip samples; copy says **Reach**, never "rarity".
- [ ] Tapping the **Backflip row navigates** to its page (does NOT steal focus).

## 2 · Goal detail & pause
- [ ] Backflip page: Someday chip, unrated Reach card, Plan card with quiet **Pause** pill (next to "Full plan → / Revise") + consequence line beneath.
- [ ] Tap **Pause** → button becomes accent **Resume**, line swaps; /goals row gains "· Plan paused"; Backflip's phantom retest markers vanish from /calendar. Repeat for Handstand.
- [ ] Tap **Set focus** on Backflip (hint says focusing **resumes a paused plan**) → then set focus back to **Elbert** → Today returns exactly as before. *(Proves the original epic bug is dead — nothing deactivated in the shuffle.)*

## 3 · The intake interview (centerpiece)
- [ ] /coach → **first card** = "Interview your coach" → Copy → paste in claude.ai.
- [ ] Coach goes **one stage at a time**: objective → date-or-someday → asks 2–4 benchmarks and **logs each via `log_baseline` live** → constraints (calls `list_goals`, mentions your other goals) → weighted targets → **`preview_goal_feasibility` BEFORE creating**.
- [ ] **Stress test:** goal = "bench press 315 lb by September 1", current best ~135. Step 6 must come back **Legendary — "near-impossible in the time set"** and the coach should negotiate, not just create.
- [ ] Approve creation anyway (cleanup in step 4) → `create_goal` response includes a **stackWarning**.

## 4 · Warnings render (never seen with real data before)
- [ ] /goals: **Stack Reach card escalates** — Legendary bold, 5/5 segments, warning banner "near-impossible in the time set — talk to your coach or adjust timelines". **[themes]** **The big check (EPIC61-R-07): alarm, not trophy?**
- [ ] Create one more absurd goal **directly** via the /goals form (note the dashed **"Interview your coach first (recommended)"** banner at top) → after submit, its page shows the **?stackWarning banner** + "try the coach intake interview" nudge.
- [ ] **Cleanup:** ask the coach to delete both test goals — it must **propose first** and delete only after your explicit yes (`confirm: true` guard). Stack returns to quiet Uncommon.

## 5 · Aspiration capture (the handstand story)
- [ ] /journal → log note: "Audible: someday I want to do a one-arm pushup."
- [ ] Pending-note actions show the new two-row split: **Apply revision → · Promote to goal →** / **Mark resolved**. **[themes]** Two links fit one row without wrapping? *(UXR-64-16; fallback: vertical stack)*
- [ ] Tap **Promote to goal →** → /goals create form **pre-filled** with the note text, scrolled into view. (Don't submit — do it the better way:)
- [ ] In claude.ai: "Check my promotable notes including aspirations and promote the one-arm pushup one." Expect: found via `includeAspirations` → coach proposes objective + **attributionHints** (e.g. "Push-Up") → `promote_note_to_goal` → new **Someday goal** (no plan, no pin); journal note resolved "promoted to goal …".
- [ ] Ask to promote the **same note again** → "already promoted", **no duplicate goal**.

## 6 · Attribution — is my aspiration being trained?
- [ ] New goal's row shows **"· no training logged"** (hints set, no matching workout yet).
- [ ] Log any workout containing the hinted exercise (named exactly as you log it) → /goals row + detail show **"· trained today"**.
- [ ] Optional: have the coach add hints to the real Handstand goal ("count Wall Handstand Push-Up and Handstand Hold as training my Handstand goal").

## 7 · Multi-goal awareness & someday→dated upgrade
- [ ] Coach: "Give the one-arm pushup goal a target date of October 1." Response says **a plan was auto-scaffolded** (~16 weeks).
- [ ] /calendar: its target-date marker appears (claim-ringed — not your focus goal). Tap the day → goal-tagged banner **above** Elbert's prescription on the day page.
- [ ] If the date lands near a long-effort/hike day: warning wedge on the cell + conflict banner with a human sentence + "Ask your coach to sort the week →".
- [ ] Then keep it, clear its date (Edit → **"Clear — make it a someday goal"**), or have the coach delete it.

## 8 · Cold-start sanity
- [ ] Brand-new claude.ai conversation: "Catch up on my training." One `get_session_brief` gives the coach: Elbert focus + days-to-go, someday goals **flagged as someday**, **stack Reach tier inline**, upcoming events/conflicts, truncated latest review. No wrong-goal confusion.

---

**Pass = epic verified end-to-end on real hardware**, and the owed device checks are cleared (meter legibility, Legendary alarm, note-row fit, both themes).
**Fail?** Note the step number + what you saw; fallbacks are pre-designed: tag-dot markers (ring muddies), bolder banner fill (Legendary too quiet), stacked note actions (row wraps).
