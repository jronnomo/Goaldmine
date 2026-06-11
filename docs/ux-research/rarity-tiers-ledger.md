# Recommendation Ledger — Rarity / Feasibility Tiers ("Reach")

**Feature:** Multi-goal Phase 2 — Rarity/feasibility tiers + coach calibration
**Issue:** jronnomo/workout-planner #63 (Epic #61) · **Report:** [`rarity-tiers.md`](./rarity-tiers.md) · **Mockup:** [`rarity-tiers.html`](./rarity-tiers.html)

Stable IDs `UXR-63-NN` — assigned once, never renumbered. Status starts `proposed`. The **implementing PR ticks each row** to `shipped` / `reworked` / `dropped` with a SHA, `file:line`, or a one-line reason in Evidence. Rows tagged `tuning⚠` / `decoration⚠` / `a11y` are the ones a future audit cares about most — confirm them on a real 390px device in both themes.

> Ticked 2026-06-11 by the implementing run. `shipped*` = code-reviewed + smoke-verified; device visual check owed.

| ID | Recommendation | Type | Status | Evidence |
|----|----------------|------|--------|----------|
| UXR-63-01 | On-screen axis noun = **"Reach"** (engine/MCP keep "rarity") | copy | shipped | 5f43f1c (UI) / 6990733 (MCP) / ecea6d7 (engine fix) |
| UXR-63-02 | Keep tier words Common/Uncommon/Rare/Epic/Legendary; redefine loaded words inline wherever loud | copy | shipped | 5f43f1c (UI) / 6990733 (MCP) / ecea6d7 (engine fix) |
| UXR-63-03 | `RarityChip` glyph = discrete 5-segment Reach meter, fill count = ordinal; empty = `--border` | component | shipped | 5f43f1c (UI) / 6990733 (MCP) / ecea6d7 (engine fix) |
| UXR-63-04 | 3-hue ramp (Common/Uncommon `--muted`, Rare `--accent`, Epic/Legendary `--warning`) + Legendary word bold | tuning⚠ | shipped* | 5f43f1c / 6990733 — device check at 390px both themes still owed |
| UXR-63-05 | Segment geometry ~3px×9px, gap ~1.5px, radius 1px (range 2.5–3.5 × 8–10) | tuning⚠ | shipped* | 5f43f1c / 6990733 — device check at 390px both themes still owed |
| UXR-63-06 | Do NOT overload Bullseye for tiers (reserved-for-focus + 4-ring ceiling); meter is a separate glyph | component | shipped | 5f43f1c (UI) / 6990733 (MCP) / ecea6d7 (engine fix) |
| UXR-63-07 | Per-goal marker = bare meter at START of the left-rail subline; right rail untouched | layout | shipped* | 5f43f1c / 6990733 — device check at 390px both themes still owed |
| UXR-63-08 | `StackRarityCard` above the list; quiet for Common–Rare, escalates to warning-banner for Epic/Legendary + plain reason line | component | shipped | 5f43f1c (UI) / 6990733 (MCP) / ecea6d7 (engine fix) |
| UXR-63-09 | /character third line `Reach: {stackTier} [meter]` under XP bar, subordinate to "Lv N Adventurer", word always present | layout | shipped* | 5f43f1c / 6990733 — device check at 390px both themes still owed |
| UXR-63-10 | /goals/[id] Reach card between Readiness & Plan; Computed+Coach side-by-side + rationale + assessedAt + per-target table | component | shipped | 5f43f1c (UI) / 6990733 (MCP) / ecea6d7 (engine fix) |
| UXR-63-11 | Coach-override compact: effective tier + gold `--accent` coach dot/tag; computed via `title=`; full side-by-side on detail | component | shipped | 5f43f1c (UI) / 6990733 (MCP) / ecea6d7 (engine fix) |
| UXR-63-12 | "Why this tier" rate-gap data story on /goals/[id] (required vs plausible weekly rate; "2.1× your pace · leaves no slack"), behind `<details>` | copy | shipped | 5f43f1c (UI) / 6990733 (MCP) / ecea6d7 (engine fix) |
| UXR-63-13 | Banners cap at `--warning`, NEVER `--danger` (== `--target`, reserved focus red); recipe = border + `border-l-[3px]` + `--foreground` body + `◣` | decoration⚠ | shipped* | 5f43f1c / 6990733 — device check at 390px both themes still owed |
| UXR-63-14 | Warning wash `color-mix(in srgb, var(--warning) 8–9%, var(--card))`; optional `--warning-soft` token fast-follow | tuning⚠ | shipped* | 5f43f1c / 6990733 — device check at 390px both themes still owed |
| UXR-63-15 | Epic + Legendary banner copy strings (exact, report §0); Legendary carries "near-impossible in the time set" | copy | shipped | 5f43f1c (UI) / 6990733 (MCP) / ecea6d7 (engine fix) |
| UXR-63-16 | Banner economy: one-time post-creation interrupt; ambient StackRarityCard collapses N flagged goals to ONE line, never re-fires | layout | shipped | 5f43f1c (UI) / 6990733 (MCP) / ecea6d7 (engine fix) |
| UXR-63-17 | CHALLENGE — suppress Epic post-creation *interrupt* (Epic passive); **needs sign-off** | layout | reworked | PRD baseline shipped per uxr-signoffs.md — Epic+Legendary both banner; ambient-collapse refinement → Phase-3 backlog |
| UXR-63-18 | CHALLENGE — overrule blueprint placeholder color map (uncommon=`--success`, epic=`--target`, legendary=`--danger`) with the 3-hue ramp; **needs sign-off** | component | shipped | 3-hue ramp adopted, blueprint placeholder map discarded (5f43f1c ReachMeter.tsx) |
| UXR-63-19 | Someday/unrated = neutral `—` chip (`--border`/`--muted`), `aria-label="Feasibility not yet rated"` | component | shipped | 5f43f1c (UI) / 6990733 (MCP) / ecea6d7 (engine fix) |
| UXR-63-20 | Glossary one-row addition (≤90c): "Reach — How big an ask a goal is by its date. Higher tiers are harder to hit in time." + real Rare chip sample | copy | shipped | 5f43f1c (UI) / 6990733 (MCP) / ecea6d7 (engine fix) |
| UXR-63-21 | No animation anywhere; `bullseye-pop`/`level-up-burst` stay celebration-only | animation | shipped | 5f43f1c (UI) / 6990733 (MCP) / ecea6d7 (engine fix) |
| UXR-63-22 | AA edge — `--warning` text on cream ~4.6:1; keep tier/banner text ≥12px; washes decorative-only (AA carried by text/border tokens) | a11y | shipped* | 5f43f1c / 6990733 — device check at 390px both themes still owed |
| UXR-63-23 | Fallback — word-chip (LEG/EPIC abbrev) only if the meter+word strains a surface; full word preferred | tuning⚠ | shipped* | 5f43f1c / 6990733 — device check at 390px both themes still owed |

## ⚠ Provisional / Verify-Visually subset (the rows to playtest)

UXR-63-04 (Epic vs Legendary + Common vs Uncommon fill), UXR-63-05 (segment geometry), UXR-63-07 (bare meter at subline scale), UXR-63-09 (XP-bar squeeze), UXR-63-13 (warning-banner recipe, no red fill), UXR-63-14 (wash %), UXR-63-22 (`--warning`-on-cream AA edge), UXR-63-23 (abbrev fallback). Judge them against [`rarity-tiers.html`](./rarity-tiers.html) on a real device, both themes.

## Sign-off required before building (challenge-with-evidence)

- **UXR-63-17** — Epic-passive (no interrupt) vs PRD's fixed Epic+Legendary creation banner.
- **UXR-63-18** — 3-hue ramp overruling the architecture-blueprint placeholder tier-color map.
