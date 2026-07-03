# Backlog Critic — App Store Publishing (agent output summary, 2026-07-03)

**5 findings requiring backlog changes (all applied):**

1. **GAP — Terms of Service missing.** #188's own AC reads "privacy/ToS live"; AS-A2 only built /privacy. → Added **AS-A6** (/terms, S/P0, track1).
2. **FIX — AS-A1 misclassified track2/AS-B Shell** while Track 1's P0 chain (AS-A4 → AS-A5) depends on it; a literal gate reading would stall all Apple-sign-in work behind AS-0 + #187/#188. → Reclassified track1/AS-A Compliance with an explicit gate-exemption AC. (Highest-risk finding.)
3. **FIX — AS-D4 missing dependency on AS-B2b** — the reviewer walkthrough ("install → sign in → log") can't be verified before the native auth escape exists. → Edge added; no cycle.
4. **SPLIT — AS-C1a (Large, 6 ACs)** bundled DB/tenant-scoping risk with APNs wire-protocol risk. → Split into **AS-C1a-1** (PushToken model + registration, M) and **AS-C1a-2** (APNs client + send-on-write, M); AS-C1b and AS-E1 deps repointed.
5. **FIX — no story kept CLAUDE.md current** for the new infra (Capacitor, sw.js, APNs, cron). → Doc ACs folded into AS-B1, AS-B3, AS-C1a-2, AS-C1b.

**Verified OK-AS-IS:** prisma-generate/additive-SQL conventions inherited repo-wide; tenant verifiers covered in AS-C1a-1; no new MCP read tools → no leaky-reads work; note-write hook doesn't change the tool list → no connector reconnect needed; QA embedded per-story + E1/D4 checkpoints; no dependency cycles; sprint slices each leave main deployable. 18/23 P0s noted as intentional (both tracks' completion requirements), not inflation.

Final backlog: **25 stories** (was 23).
