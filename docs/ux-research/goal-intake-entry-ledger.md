# Recommendation Ledger — Goal-intake Interview Entry Points

**Feature:** Multi-goal Phase 3 — entry-point visual treatment (interview banner · 3-action note row · last-trained indicator · interview prompt card)
**Issue:** jronnomo/workout-planner #64 (Epic #61) · **Report:** [`goal-intake-entry.md`](./goal-intake-entry.md) · **Mockup:** [`goal-intake-entry.html`](./goal-intake-entry.html)

Stable IDs `UXR-64-NN` — assigned once, never renumbered. Status starts `proposed`. The **implementing PR ticks each row** to `shipped` / `reworked` / `dropped` with a SHA, `file:line`, or a one-line reason in Evidence. Rows tagged `tuning⚠` / `decoration⚠` / `a11y` are the ones a future audit cares about most — confirm them on a real 390px device in both themes.

> Ticked 2026-06-11 by the REQ-64-4 implementing run (SHA `3d4261a`, "feat(coach): REQ-64-4 — interview card + journal promote affordance"). `shipped*` = code-landed + tsc/lint clean; device visual check at 390px still owed. **REQ-64-3 rows (S1 banner, S3 last-trained subline, `relativeDayLabel`) are NOT in this SHA and remain `proposed`** — they land with the /goals UI change.

| ID | Recommendation | Type | Status | Evidence |
|----|----------------|------|--------|----------|
| UXR-64-01 | S1 interview banner = **dashed-border box** (whisper rung, reuses import-path grammar); NOT accent-soft, NOT one-liner; server-rendered, non-dismissible | layout | shipped* | 1d5b546 goals-page UI — device check owed |
| UXR-64-02 | S1 banner copy: heading "Interview your coach first (recommended)" · sub "A 7-step chat shapes your targets and a plan before you commit the goal." · link "Interview your coach →" | copy | shipped | 1d5b546 goals-page UI |
| UXR-64-03 | stackWarning banner gains the interview nudge sentence: "Interview your coach to re-scope this goal's targets before the stack piles up." | copy | shipped | 1d5b546 goals-page UI |
| UXR-64-04 | S2 PendingNotes = **2-row action split** (constructive accents row / terminal muted row); priority Apply → Promote → Resolve | layout | shipped | `3d4261a` · `src/components/PendingNotes.tsx:62-85` |
| UXR-64-05 | S2 all three actions become `inline-flex items-center min-h-[44px]` (were bare inline text) | a11y | shipped | `3d4261a` · `PendingNotes.tsx:66,72,82` |
| UXR-64-06 | CHALLENGE — shorten shipped copy "Apply revision from this note →" → "Apply revision →" so two links share a 335px row; fallback = vertical stack | copy | shipped | **APPROVED** · `3d4261a` · `PendingNotes.tsx:68` ("Apply revision →") |
| UXR-64-07 | S3 last-trained joins the **existing muted subline** (quiet-subline grammar), not a new line/chip | layout | shipped | 1d5b546 goals-page UI |
| UXR-64-08 | S3 relative-date format "trained today" / "trained {N}d ago"; add TZ-aware `relativeDayLabel` to `@/lib/calendar` (bucket on `startOfDay` USER_TZ) | copy | shipped | 1d5b546 goals-page UI |
| UXR-64-09 | S3 untrained copy = "no training logged" (factual log-state, non-guilt; no "never"/"yet") | copy | shipped* | 1d5b546 goals-page UI — device check owed |
| UXR-64-10 | S3 weeks threshold for relative date (e.g. `≥14d → "{N}w ago"`) and `1d ago` vs "yesterday" | tuning⚠ | shipped* | 1d5b546 goals-page UI — device check owed |
| UXR-64-11 | S4 interview prompt card slotted at **position #1** (above "Daily check-in") | layout | shipped | `3d4261a` · `src/app/coach/page.tsx:8` (PROMPTS[0]) |
| UXR-64-12 | S4 card title "Interview your coach" + when "Starting a new goal" (established tone) | copy | shipped | `3d4261a` · `coach/page.tsx:9-10` |
| UXR-64-13 | CHALLENGE — deep-link anchor `/coach#interview` + `id="interview"` on the card (refines PRD's fixed `/coach`) | layout | shipped | **APPROVED** · `3d4261a` · `coach/page.tsx:8` (`id:"interview"` on the prompt) |
| UXR-64-14 | No animation anywhere; `bullseye-pop` stays completion-only | animation | shipped | `3d4261a` — no motion added in REQ-64-4; verify again with REQ-64-3 |
| UXR-64-15 | S1 banner padding `p-3` + `space-y-1`; verify vertical rhythm vs the New-goal Card | tuning⚠ | shipped* | 1d5b546 goals-page UI — device check owed |
| UXR-64-16 | S2 two accent links fit one 335px row without wrap; verify on-device | tuning⚠ | shipped* | `3d4261a` — code landed; **390px device check owed** (else fall back to vertical stack) |
| UXR-64-17 | Do NOT use accent-soft for the S1 banner — `--accent`-on-`--accent-soft` is contrast-tight in light (rejected Option A) | a11y | shipped | 1d5b546 goals-page UI |
| UXR-64-18 | S2 `min-h-[44px]` on inline links must not open visible vertical gaps between action rows | tuning⚠ | shipped* | `3d4261a` — code landed; **390px device check owed** (row-gap eyeball) |

*Specialists: UI Design & Brand · Behavioral · Pixel/Diagram. Extends the shipped UXR-62 / UXR-62B / UXR-63 grammar; does not reopen it.*
