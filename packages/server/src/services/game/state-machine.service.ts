// ──────────────────────────────────────────────
// Game: State Machine Service
// ──────────────────────────────────────────────

import type { GameActiveState } from "@marinara-engine/shared";

/** Valid state transitions. */
const TRANSITIONS: Record<GameActiveState, GameActiveState[]> = {
  exploration: ["dialogue", "combat", "travel_rest"],
  dialogue: ["exploration", "combat", "travel_rest"],
  combat: ["exploration", "travel_rest"],
  travel_rest: ["exploration", "dialogue", "combat"],
};

/** Returns true if transitioning from `from` to `to` is allowed. Self-transitions are always valid (no-op). */
export function isValidTransition(from: GameActiveState, to: GameActiveState): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Validate and return the next state, or throw. Self-transitions are treated as no-ops. */
export function validateTransition(from: GameActiveState, to: GameActiveState): GameActiveState {
  if (from === to) return from;
  if (!isValidTransition(from, to)) {
    throw new Error(`Invalid game state transition: ${from} → ${to}`);
  }
  return to;
}
