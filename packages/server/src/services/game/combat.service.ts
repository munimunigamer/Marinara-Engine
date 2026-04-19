// ──────────────────────────────────────────────
// Game: Combat Math Service
//
// Deterministic combat calculations — initiative,
// damage, defense, status effects. The LLM only
// narrates the results; it never does the math.
// ──────────────────────────────────────────────

import { rollDice } from "./dice.service.js";
import type { ElementAura, ReactionResult } from "./element-reactions.service.js";
import { resolveElementApplication, applyReactionDamage } from "./element-reactions.service.js";

// ── Types ──

export interface CombatantStats {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  level: number;
  /** Optional status effects currently active */
  statusEffects?: StatusEffect[];
  /** Element the combatant attacks with (if any) */
  element?: string;
  /** Current elemental aura on this combatant */
  elementAura?: ElementAura | null;
}

export interface StatusEffect {
  name: string;
  /** Positive = buff, negative = debuff */
  modifier: number;
  /** Stat it modifies */
  stat: "attack" | "defense" | "speed" | "hp";
  /** Turns remaining */
  turnsLeft: number;
}

export interface InitiativeEntry {
  id: string;
  name: string;
  roll: number;
  speed: number;
  total: number;
}

export interface AttackResult {
  attackerId: string;
  defenderId: string;
  attackRoll: number;
  defenseRoll: number;
  rawDamage: number;
  mitigated: number;
  finalDamage: number;
  isCritical: boolean;
  isMiss: boolean;
  remainingHp: number;
  isKo: boolean;
  /** Elemental reaction triggered (if any) */
  reaction?: ReactionResult | null;
  /** Element used in the attack (if any) */
  element?: string;
}

export interface CombatRoundResult {
  round: number;
  initiative: InitiativeEntry[];
  actions: AttackResult[];
  statusTicks: Array<{ id: string; effect: string; expired: boolean }>;
  /** Elemental reactions that occurred this round */
  reactions: Array<{ attackerId: string; defenderId: string; reaction: string; description: string }>;
}

// ── Functions ──

/** Roll initiative for all combatants. Returns sorted order (highest first). */
export function rollInitiative(combatants: CombatantStats[]): InitiativeEntry[] {
  const entries: InitiativeEntry[] = combatants.map((c) => {
    const speedMod = Math.floor(c.speed / 5);
    const roll = rollDice("1d20").total;
    return {
      id: c.id,
      name: c.name,
      roll,
      speed: c.speed,
      total: roll + speedMod,
    };
  });

  return entries.sort((a, b) => b.total - a.total);
}

/** Calculate a single attack from attacker against defender. */
export function resolveAttack(
  attacker: CombatantStats,
  defender: CombatantStats,
  difficulty: string = "normal",
  elementPreset?: string,
): AttackResult {
  // Attack roll: 1d20 + attack stat modifier
  const attackMod = Math.floor(attacker.attack / 3);
  const attackRoll = rollDice("1d20").total + attackMod;

  // Defense check: 1d20 + defense stat modifier
  const defenseMod = Math.floor(defender.defense / 3);
  const defenseRoll = rollDice("1d20").total + defenseMod;

  // Miss check
  const isMiss = attackRoll < defenseRoll;

  // Critical hit check (natural 20 or attack roll exceeds defense by 10+)
  const isCritical = !isMiss && (attackRoll - defenseMod >= 20 || attackRoll - defenseRoll >= 10);

  // Damage calculation
  let rawDamage = 0;
  if (!isMiss) {
    // Base damage: attack stat scaled by level
    const baseDamage = Math.max(1, Math.floor(attacker.attack * (1 + attacker.level * 0.1)));
    // Dice component: scales with level
    const damageDice = rollDice(`${Math.max(1, Math.floor(attacker.level / 2))}d6`).total;
    rawDamage = baseDamage + damageDice;

    if (isCritical) rawDamage = Math.floor(rawDamage * 1.5);
  }

  // Mitigation from defense
  const mitigation = Math.floor(defender.defense * 0.4);
  const mitigated = Math.min(rawDamage, mitigation);
  let finalDamage = Math.max(0, rawDamage - mitigated);

  // Difficulty scaling
  const difficultyMult: Record<string, number> = {
    casual: 0.6,
    normal: 1.0,
    hard: 1.3,
    brutal: 1.6,
  };
  finalDamage = Math.floor(finalDamage * (difficultyMult[difficulty] ?? 1.0));

  // Apply status effect modifiers
  if (attacker.statusEffects) {
    for (const effect of attacker.statusEffects) {
      if (effect.stat === "attack") finalDamage = Math.max(0, finalDamage + effect.modifier);
    }
  }
  if (defender.statusEffects) {
    for (const effect of defender.statusEffects) {
      if (effect.stat === "defense") finalDamage = Math.max(0, finalDamage - effect.modifier);
    }
  }

  // Elemental reaction chain
  let reaction: ReactionResult | null = null;
  if (attacker.element && !isMiss) {
    const { reaction: r, newAura } = resolveElementApplication(
      defender.elementAura ?? null,
      attacker.element,
      attacker.id,
      elementPreset,
    );
    defender.elementAura = newAura;
    if (r) {
      reaction = r;
      finalDamage = applyReactionDamage(finalDamage, r);
      // Apply reaction status effects to defender (dedup: refresh turnsLeft if already present)
      if (r.appliedEffects.length > 0) {
        if (!defender.statusEffects) defender.statusEffects = [];
        for (const eff of r.appliedEffects) {
          const existing = defender.statusEffects.find((e) => e.name === eff.name);
          if (existing) {
            existing.turnsLeft = Math.max(existing.turnsLeft, eff.turnsLeft);
          } else {
            defender.statusEffects.push({ ...eff });
          }
        }
      }
    }
  }

  const remainingHp = Math.max(0, defender.hp - finalDamage);

  return {
    attackerId: attacker.id,
    defenderId: defender.id,
    attackRoll,
    defenseRoll,
    rawDamage,
    mitigated,
    finalDamage,
    isCritical,
    isMiss,
    remainingHp,
    isKo: remainingHp <= 0,
    reaction,
    element: attacker.element,
  };
}

/** Tick status effects: decrement turns, remove expired. Returns tick results. */
export function tickStatusEffects(combatant: CombatantStats): {
  updated: CombatantStats;
  ticks: Array<{ effect: string; expired: boolean }>;
} {
  if (!combatant.statusEffects?.length) {
    return { updated: combatant, ticks: [] };
  }

  const ticks: Array<{ effect: string; expired: boolean }> = [];
  const remaining: StatusEffect[] = [];

  for (const effect of combatant.statusEffects) {
    // Apply HP effects (poison, regen)
    if (effect.stat === "hp") {
      combatant.hp = Math.min(combatant.maxHp, Math.max(0, combatant.hp + effect.modifier));
    }

    const next = { ...effect, turnsLeft: effect.turnsLeft - 1 };
    const expired = next.turnsLeft <= 0;
    ticks.push({ effect: effect.name, expired });
    if (!expired) remaining.push(next);
  }

  return {
    updated: { ...combatant, statusEffects: remaining },
    ticks,
  };
}

/** Player-chosen action for their turn. */
export interface PlayerAction {
  type: "attack" | "skill" | "defend" | "item" | "flee";
  targetId?: string;
  skillId?: string;
  itemId?: string;
}

/** Run a full combat round. Modifies combatants in place and returns round result. */
export function resolveCombatRound(
  combatants: (CombatantStats & { side?: "player" | "enemy" })[],
  round: number,
  difficulty: string = "normal",
  elementPreset?: string,
  playerAction?: PlayerAction,
): CombatRoundResult {
  const alive = combatants.filter((c) => c.hp > 0);
  const initiative = rollInitiative(alive);
  const actions: AttackResult[] = [];
  const statusTicks: Array<{ id: string; effect: string; expired: boolean }> = [];
  const reactions: CombatRoundResult["reactions"] = [];

  // Track defending combatants for defense bonus
  const defendingIds = new Set<string>();

  // Each combatant acts in initiative order
  for (const entry of initiative) {
    const attacker = combatants.find((c) => c.id === entry.id);
    if (!attacker || attacker.hp <= 0) continue;

    const isPlayerSide = (attacker as { side?: string }).side === "player";

    // Player-side combatants use the player's chosen action
    if (isPlayerSide && playerAction) {
      if (playerAction.type === "defend") {
        // Defending: skip attack, gain temporary defense boost (handled below)
        defendingIds.add(attacker.id);
        continue;
      }

      if (playerAction.type === "attack" || playerAction.type === "skill") {
        // Attack the player's chosen target (if alive), otherwise fall back to random
        const opposingSide = combatants.filter(
          (c) => c.id !== attacker.id && (c as { side?: string }).side !== "player" && c.hp > 0,
        );
        if (opposingSide.length === 0) break;
        let target = playerAction.targetId ? opposingSide.find((c) => c.id === playerAction.targetId) : undefined;
        if (!target) target = opposingSide[Math.floor(Math.random() * opposingSide.length)]!;
        const result = resolveAttack(attacker, target, difficulty, elementPreset);
        actions.push(result);
        if (result.reaction) {
          reactions.push({
            attackerId: attacker.id,
            defenderId: target.id,
            reaction: result.reaction.reaction,
            description: result.reaction.description,
          });
        }
        target.hp = result.remainingHp;
        continue;
      }

      // Item / flee: skip combat action for this combatant
      continue;
    }

    // Enemy AI: attack a random player-side combatant
    const opposingSide = combatants.filter((c) => {
      const side = (c as { side?: string }).side;
      return c.hp > 0 && side !== (attacker as { side?: string }).side;
    });
    if (opposingSide.length === 0) break;

    const target = opposingSide[Math.floor(Math.random() * opposingSide.length)]!;

    // Apply defend bonus: if target is defending, temporarily boost defense
    const originalDefense = target.defense;
    if (defendingIds.has(target.id)) {
      target.defense = Math.floor(target.defense * 1.5);
    }

    const result = resolveAttack(attacker, target, difficulty, elementPreset);
    actions.push(result);

    // Restore original defense after calculation
    target.defense = originalDefense;

    // Collect reactions for narration
    if (result.reaction) {
      reactions.push({
        attackerId: attacker.id,
        defenderId: target.id,
        reaction: result.reaction.reaction,
        description: result.reaction.description,
      });
    }

    // Apply damage
    target.hp = result.remainingHp;
  }

  // Tick status effects at end of round
  for (const c of combatants) {
    if (c.hp <= 0) continue;
    const { updated, ticks } = tickStatusEffects(c);
    Object.assign(c, updated);
    for (const t of ticks) {
      statusTicks.push({ id: c.id, ...t });
    }
  }

  return { round, initiative, actions, statusTicks, reactions };
}
