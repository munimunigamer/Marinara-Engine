// ──────────────────────────────────────────────
// Service: Skill Check Resolution
//
// Resolves d20-based skill checks using player
// stats. Supports advantage/disadvantage, crits,
// and attribute-linked modifiers.
// ──────────────────────────────────────────────

import type { RPGAttributes } from "@marinara-engine/shared";

export interface SkillCheckInput {
  /** Skill name (e.g. "Perception", "Stealth"). */
  skill: string;
  /** Difficulty class to beat. */
  dc: number;
  /** Skill modifier from playerStats.skills (pre-looked-up). */
  skillModifier: number;
  /** Attribute modifier (floor((score - 10) / 2) — D&D-style). */
  attributeModifier: number;
  /** Roll with advantage (take higher of 2) or disadvantage (take lower). */
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface SkillCheckResult {
  skill: string;
  dc: number;
  /** The raw d20 roll(s) — 2 if advantage/disadvantage, 1 otherwise. */
  rolls: number[];
  /** Which roll was used (index into rolls). */
  usedRoll: number;
  /** Total modifier applied (skill + attribute). */
  modifier: number;
  /** Final total: usedRoll + modifier. */
  total: number;
  /** Whether the check passed. */
  success: boolean;
  /** Natural 20 on the used roll. */
  criticalSuccess: boolean;
  /** Natural 1 on the used roll. */
  criticalFailure: boolean;
  /** "advantage" | "disadvantage" | "normal" */
  rollMode: string;
}

function d20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

/**
 * Compute a D&D-style attribute modifier: floor((score - 10) / 2).
 */
export function attributeModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Map common skills to their governing attribute.
 * Falls back to "int" for unlisted skills.
 */
const SKILL_ATTRIBUTE_MAP: Record<string, keyof RPGAttributes> = {
  // STR
  athletics: "str",

  // DEX
  acrobatics: "dex",
  sleight_of_hand: "dex",
  stealth: "dex",

  // CON
  endurance: "con",

  // INT
  arcana: "int",
  history: "int",
  investigation: "int",
  nature: "int",
  religion: "int",

  // WIS
  animal_handling: "wis",
  insight: "wis",
  medicine: "wis",
  perception: "wis",
  survival: "wis",

  // CHA
  deception: "cha",
  intimidation: "cha",
  performance: "cha",
  persuasion: "cha",
};

/**
 * Look up the governing attribute for a skill name.
 * Normalises the skill name (lowercase, spaces → underscores).
 */
export function getGoverningAttribute(skill: string): keyof RPGAttributes {
  const key = skill.toLowerCase().replace(/\s+/g, "_");
  return SKILL_ATTRIBUTE_MAP[key] ?? "int";
}

/**
 * Resolve a skill check with d20 + modifiers vs DC.
 */
export function resolveSkillCheck(input: SkillCheckInput): SkillCheckResult {
  const modifier = input.skillModifier + input.attributeModifier;

  // Roll d20 (twice if advantage/disadvantage)
  const useAdvantage = input.advantage && !input.disadvantage;
  const useDisadvantage = input.disadvantage && !input.advantage;
  const rollTwice = useAdvantage || useDisadvantage;

  const rolls = rollTwice ? [d20(), d20()] : [d20()];
  const usedRoll = rollTwice
    ? useAdvantage
      ? Math.max(rolls[0]!, rolls[1]!)
      : Math.min(rolls[0]!, rolls[1]!)
    : rolls[0]!;

  const total = usedRoll + modifier;
  const criticalSuccess = usedRoll === 20;
  const criticalFailure = usedRoll === 1;

  // Crit success always passes, crit failure always fails
  const success = criticalSuccess ? true : criticalFailure ? false : total >= input.dc;

  return {
    skill: input.skill,
    dc: input.dc,
    rolls,
    usedRoll,
    modifier,
    total,
    success,
    criticalSuccess,
    criticalFailure,
    rollMode: useAdvantage ? "advantage" : useDisadvantage ? "disadvantage" : "normal",
  };
}
