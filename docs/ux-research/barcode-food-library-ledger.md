# Recommendation Ledger — `barcode-food-library`

Source: [`barcode-food-library.md`](./barcode-food-library.md) · PRD: `docs/prds/PRD-barcode-food-library.md` · Issue [#66](https://github.com/jronnomo/goaldmine/issues/66)

IDs are stable and never renumbered. `Status` starts `proposed`. **The implementing PR ticks each row to `shipped` / `reworked` / `dropped`** and fills `Evidence` with a SHA / `file:line` / one-line reason. Every `tuning⚠` / `decoration⚠` / `a11y` row is a thing to confirm on a real 390px screen in both themes before it ships.

Implementing commits: `db541e3` (form/chips), `4ba104b` (scanner/sheet), `4bf3a86` (server), `100387f` (integration), `9fbbbf4` (QA fixes).

| ID | Recommendation | Type | Status | Evidence |
|----|----------------|------|--------|----------|
| UXR-barcode-food-library-01 | Chips/Scan row between mealType and items; horizontal scroll strip | layout | shipped | LogNutritionForm.tsx (db541e3) |
| UXR-barcode-food-library-02 | **Pinned leading Scan affordance**; quiet chips scroll after | component | shipped | LogNutritionForm.tsx chips row; `scan-affordance` testid |
| UXR-barcode-food-library-03 | Chip = name + small brand, two lines, **NO emoji** | copy | shipped | Tech-Lead signed off (PRD §9.1); no emoji in chips |
| UXR-barcode-food-library-04 | Right-edge fade mask overflow affordance | decoration⚠ | shipped | chips row fade (db541e3) — 390px visual pass pending (user) |
| UXR-barcode-food-library-05 | Chip truncation budget (~12–16ch / ~10–14ch) | tuning⚠ | shipped | truncate classes at start values — visual pass pending (user) |
| UXR-barcode-food-library-06 | Empty library → single "Scan a barcode" button | component | shipped | verified live: /nutrition empty state renders scan-affordance only |
| UXR-barcode-food-library-07 | Framed viewfinder card + co-equal manual strip below | layout | shipped | ScanFoodSheet.tsx (4ba104b) |
| UXR-barcode-food-library-08 | Corner-bracket reticle, accent 2px, **no laser line** | decoration⚠ | shipped | brackets only; laser not built (default OFF) — visual pass pending |
| UXR-barcode-food-library-09 | Optional dark-chrome video frame — default OFF | decoration⚠ | dropped | not built per default-OFF restraint; frame themes normally |
| UXR-barcode-food-library-10 | Viewfinder ~4:3, brackets 16–28px | tuning⚠ | shipped | start values — verify decode + strip visibility on device (user) |
| UXR-barcode-food-library-11 | Torch top-right in frame, 36px, capability-gated | component | shipped | BarcodeScanner.tsx torch toggle (Android-only in practice) |
| UXR-barcode-food-library-12 | aria-live status text below frame; never blocks manual strip | a11y | shipped | ScanFoodSheet status region |
| UXR-barcode-food-library-13 | Neutral-coach microcopy for states | copy | shipped | per report wording |
| UXR-barcode-food-library-14 | Confirm layout: card → stepper → preview → Add | layout | shipped | ScanFoodSheet confirm phase |
| UXR-barcode-food-library-15 | Food card reuses Card; sans semibold name; nulls "—" | component | shipped | ScanFoodSheet confirm card |
| UXR-barcode-food-library-16 | Stepper ≥44px, 0.5 steps, min 0.5 (max 20 added by critique S-2) | component | shipped | ScanFoodSheet.tsx:37 MAX_SERVINGS=20 |
| UXR-barcode-food-library-17 | Preview mirrors MacroInputs 3-col grid, live recompute | layout | shipped | scaledMacros grid |
| UXR-barcode-food-library-18 | Calorie quiet-hero emphasis (text-lg semibold) | tuning⚠ | shipped | start value — visual pass pending (user) |
| UXR-barcode-food-library-19 | Stepper value-cell accent-soft tint | tuning⚠ | shipped | start value — visual pass pending (user) |
| UXR-barcode-food-library-20 | No new animation; instant phase swap (optional 120ms fade) | animation⚠ | shipped | instant swap; optional fade not built |
| UXR-barcode-food-library-21 | Only flourish = vibrate(50); no success animation | animation | shipped | BarcodeScanner on confirmed read |
| UXR-barcode-food-library-22 | Contrast verify both themes (gold-on-soft, 11px muted, reticle) | a11y⚠ | shipped | tokens-only verified; human AA pass at 390px both themes PENDING (user) |
| UXR-barcode-food-library-23 | Full testid set | component | shipped | scan-affordance/quickpick-* verified live; remainder in components |

**Summary:** 22 shipped · 0 reworked · 1 dropped (09 — default-OFF decoration not built). ⚠ rows shipped at report start values; user's device pass at 390px both themes covers: fade mask, truncation, reticle/aspect, calorie weight, value tint, contrast triple — plus the camera items (scan a real product, green-light clearance on dismiss, stacked-sheet Esc/backdrop).
