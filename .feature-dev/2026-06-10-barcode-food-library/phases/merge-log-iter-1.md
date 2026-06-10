# Merge Log — Iteration 1 (barcode-food-library)

| Order | Branch | Commit | Content | Notes |
|---|---|---|---|---|
| 1 | agent-a4c5d2e64d32445c9 (Step 0) | e7533bb | food-types.ts contract + FoodLibrary schema/migration (verified additive: 1 CREATE TABLE + 2 indexes) | fast-forward |
| 2 | agent-ab37a079bc0fa67e0 (Stream A) | 4bf3a86 | openfoodfacts.ts normalizer (18/18 fixture assertions), food-actions.ts, MCP frequentFoods, gotchas entry | clean; live lookups verified (Nutella kcal 539, Coke zero-pad canonical, not_found, fromLibrary repeat); test rows cleaned |
| 3 | agent-a980e7baf1fb8f041 (Stream B) | 4ba104b | zxing-wasm@3.1.0 pinned + copy script/postinstall/.gitignore, BarcodeScanner (H-1 generation counter), ScanFoodSheet, stub | tsc failed on main post-merge (zxing not in main node_modules — worktree npm install didn't propagate through symlink); fixed via npm install on main (postinstall copied wasm) |
| 4 | agent-a16696c0023ceea3e (Stream C) | db541e3 | MacroInputs controlled mode, LogNutritionForm chips+merge (useMemo prop-sync deviation, lint-driven), nutrition page prop, stubs | C worktree stale → re-created food-types.ts but BYTE-IDENTICAL → no conflict; round-trip parser + merge math proven |
| 5 | agent-a63ea9ba952be4f3d (Integration) | 100387f | stub swaps (4 imports), stubs deleted, zero drift found | chips appear/disappear with fixture row; frequentFoods live; wasm 200; scanner code in 3 async chunks only |

Main after merges: tsc clean at every gate.
