// ──────────────────────────────────────────────
// Combat Encounter Types
// ──────────────────────────────────────────────
// Modeled after RPG Companion's encounter system:
// A separate turn-based combat modal that runs
// alongside the main roleplay, producing a summary
// that gets injected back into the chat.
// ──────────────────────────────────────────────

/** Attack definition for party members and enemies. */
export interface CombatAttack {
  name: string;
  type: "single-target" | "AoE" | "both";
}

/** A status effect applied to a combatant. */
export interface CombatStatus {
  name: string;
  emoji: string;
  duration: number;
}

/** A member of the player's party. */
export interface CombatPartyMember {
  name: string;
  hp: number;
  maxHp: number;
  attacks: CombatAttack[];
  items: string[];
  statuses: CombatStatus[];
  isPlayer: boolean;
}

/** An enemy in the encounter. */
export interface CombatEnemy {
  name: string;
  hp: number;
  maxHp: number;
  attacks: CombatAttack[];
  statuses: CombatStatus[];
  description: string;
  sprite: string;
}

/** AI-chosen visual styling hints for the combat environment. */
export interface CombatStyleNotes {
  environmentType: string;
  atmosphere: string;
  timeOfDay: string;
  weather: string;
}

/** Full combat state returned by the init prompt. */
export interface CombatInitState {
  party: CombatPartyMember[];
  enemies: CombatEnemy[];
  environment: string;
  styleNotes: CombatStyleNotes;
}

/** An action taken by an enemy during a turn. */
export interface CombatEnemyAction {
  enemyName: string;
  action: string;
  target: string;
}

/** An action taken by a non-player party member during a turn. */
export interface CombatPartyAction {
  memberName: string;
  action: string;
  target: string;
}

/** Updated player actions (attacks/items may change mid-combat). */
export interface CombatPlayerActions {
  attacks: CombatAttack[];
  items: string[];
}

/** Result returned by the combat action prompt. */
export interface CombatActionResult {
  combatStats: {
    party: CombatPartyMember[];
    enemies: CombatEnemy[];
  };
  playerActions: CombatPlayerActions;
  enemyActions: CombatEnemyAction[];
  partyActions: CombatPartyAction[];
  narrative: string;
  combatEnd?: boolean;
  result?: "victory" | "defeat" | "fled" | "interrupted";
}

/** An entry in the encounter log, tracked per-turn. */
export interface EncounterLogEntry {
  timestamp: number;
  action: string;
  result: string;
}

/** Narrative style preferences for combat and summary text. */
export interface NarrativeStyle {
  tense: "present" | "past";
  person: "first" | "second" | "third";
  narration: "omniscient" | "limited";
  pov: string;
}

/** User-configurable encounter settings. */
export interface EncounterSettings {
  combatNarrative: NarrativeStyle;
  summaryNarrative: NarrativeStyle;
  historyDepth: number;
}

// ──────────────────────────────────────────────
// API Request / Response Types
// ──────────────────────────────────────────────

/** Payload for POST /api/encounter/init */
export interface EncounterInitRequest {
  chatId: string;
  connectionId: string | null;
  settings: EncounterSettings;
  /** Optional spellbook lorebook ID to inject spell/attack data into combat */
  spellbookId?: string | null;
}

/** Response from POST /api/encounter/init */
export interface EncounterInitResponse {
  combatState: CombatInitState;
}

/** Payload for POST /api/encounter/action */
export interface EncounterActionRequest {
  chatId: string;
  connectionId: string | null;
  action: string;
  combatStats: {
    party: CombatPartyMember[];
    enemies: CombatEnemy[];
    environment: string;
  };
  playerActions: CombatPlayerActions | null;
  encounterLog: EncounterLogEntry[];
  settings: EncounterSettings;
  /** Optional spellbook lorebook ID to inject spell/attack data into combat */
  spellbookId?: string | null;
}

/** Response from POST /api/encounter/action */
export interface EncounterActionResponse {
  result: CombatActionResult;
}

/** Payload for POST /api/encounter/summary */
export interface EncounterSummaryRequest {
  chatId: string;
  connectionId: string | null;
  encounterLog: EncounterLogEntry[];
  result: "victory" | "defeat" | "fled" | "interrupted";
  settings: EncounterSettings;
}

/** Response from POST /api/encounter/summary */
export interface EncounterSummaryResponse {
  summary: string;
  messageId: string;
}
