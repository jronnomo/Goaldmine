// engine-stub.ts
// Temporary stub for Stream B (MCP tools) while Stream A (engine.ts) is in flight.
// Returns FIXTURE_GAME_STATE so get_game_state and grant_bonus_xp can be smoke-tested
// before the real engine is wired in.
//
// INTEGRATION: swap the import in src/lib/mcp/tools.ts from "@/lib/game/engine-stub"
// to "@/lib/game/engine" once Stream A ships engine.ts.
// Delete this file after integration (REQ-009) is complete.

import type { GameState } from "@/lib/game/types";
import { FIXTURE_GAME_STATE } from "@/lib/game/fixture";

/**
 * Stub implementation of computeGameState().
 * Returns FIXTURE_GAME_STATE — same signature as the real engine.
 * The real engine (engine.ts) will replace this via the INTEGRATION swap above.
 */
export async function computeGameState(): Promise<GameState> {
  return FIXTURE_GAME_STATE;
}
