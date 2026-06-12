# Sign-offs (#65) — orchestrator 2026-06-12
UXR-65-29 APPROVED-AMENDED: use EXISTING calendar.ts export userTzWallClockToUTC for dateKey+HH:MM composition (also satisfies DA M3 DST fix); add thin wrappers only if call-site ergonomics demand.
UXR-65-11 DROPPED: "Did it as prescribed" batch-resolve invents values for fuzzy prescriptions ("8-12"/"max") — conflicts with placeholders-never-persist; concrete prescriptions already hit ≤4 taps.
UXR-65-30 APPROVED: logger inline, no BottomSheet.
DA fixes routing: H1 shipped in REQ-65-4 (9d57d16). H4 satisfied by REQ-65-1 byte-diff evidence (35d42c3). → Wave 2: H2 skip title "Skipped — {template}"; H3 rest-day + out-of-plan guards (UI hide + action throw); M1/M2 logHikeForDay revalidates +/history +/character; M3 userTzWallClockToUTC; M4 unskipDay deleteMany backstop (no migration); M5 setIndex assigned 1..N in server action; M6 non-atomicity comment in workout-edit-actions.ts.
