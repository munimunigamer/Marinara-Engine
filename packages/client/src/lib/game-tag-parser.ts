// ──────────────────────────────────────────────
// Game: GM Tag Parser
//
// Extracts [music:], [sfx:], [bg:], [ambient:],
// [choices:], [qte:], [reputation:], [state:],
// [direction:], [widget:], and other command tags
// from GM narration output.
// Returns clean content + extracted commands.
// ──────────────────────────────────────────────

import type { DirectionCommand, DirectionEffect, WidgetUpdate } from "@marinara-engine/shared";

export interface CombatEncounterTag {
  enemies: Array<{
    name: string;
    level: number;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    /** Element the enemy attacks with (for elemental reaction chains) */
    element?: string;
  }>;
}

export interface SkillCheckTag {
  skill: string;
  dc: number;
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface ElementAttackTag {
  /** Element used in the attack (e.g. "pyro", "ice", "lightning") */
  element: string;
  /** Target combatant name */
  target: string;
}

export interface InventoryTag {
  action: "add" | "remove";
  items: string[];
}

export interface ReadableTag {
  type: "note" | "book";
  content: string;
}

export interface ParsedGmTags {
  /** Content with all command tags stripped. */
  cleanContent: string;
  /** Music tag to play, e.g. "music:combat:epic-battle" */
  music: string | null;
  /** One-shot SFX tags */
  sfx: string[];
  /** Background image tag */
  background: string | null;
  /** Ambient loop tag */
  ambient: string | null;
  /** Choices for player (VN-style cards) */
  choices: string[] | null;
  /** QTE actions + timer */
  qte: { actions: string[]; timer: number } | null;
  /** State transition command */
  stateChange: string | null;
  /** NPC reputation changes */
  reputationActions: Array<{ npcName: string; action: string }>;
  /** Combat encounter with enemy data */
  combatEncounter: CombatEncounterTag | null;
  /** Cinematic direction commands */
  directions: DirectionCommand[];
  /** Widget update commands */
  widgetUpdates: WidgetUpdate[];
  /** Skill check requests */
  skillChecks: SkillCheckTag[];
  /** Elemental attack triggers */
  elementAttacks: ElementAttackTag[];
  /** Inventory add/remove commands */
  inventoryUpdates: InventoryTag[];
  /** Note or book content for reading display */
  readables: ReadableTag[];
}

/**
 * Remove all instances of a bracket-enclosed tag whose content may contain
 * nested brackets (e.g. JSON arrays/objects).  Counts `[` / `]` so the match
 * extends to the *balanced* closing bracket rather than the first `]`.
 */
function stripBalancedTag(text: string, tagPrefix: string): string {
  const lower = tagPrefix.toLowerCase();
  let result = text;
  let searchFrom = 0;
  while (true) {
    const idx = result.toLowerCase().indexOf(lower, searchFrom);
    if (idx === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = idx; i < result.length; i++) {
      if (result[i] === "[") depth++;
      else if (result[i] === "]") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) {
      searchFrom = idx + 1;
      continue;
    }
    result = result.slice(0, idx) + result.slice(end + 1);
  }
  return result;
}

/**
 * Extract all occurrences of a balanced bracket tag and return their inner
 * content (the part after the colon, trimmed).  Also returns the text with
 * all matched tags removed.  Handles nested `[]` inside the tag body.
 */
function extractBalancedTags(text: string, tagPrefix: string): { contents: string[]; remaining: string } {
  const lower = tagPrefix.toLowerCase();
  const prefixLen = tagPrefix.length;
  const contents: string[] = [];
  let remaining = text;
  let searchFrom = 0;
  while (true) {
    const idx = remaining.toLowerCase().indexOf(lower, searchFrom);
    if (idx === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = idx; i < remaining.length; i++) {
      if (remaining[i] === "[") depth++;
      else if (remaining[i] === "]") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) {
      searchFrom = idx + 1;
      continue;
    }
    // inner = everything between "[tagPrefix:" and the balanced "]"
    const inner = remaining.slice(idx + prefixLen, end).trim();
    contents.push(inner);
    remaining = remaining.slice(0, idx) + remaining.slice(end + 1);
  }
  return { contents, remaining };
}

/** Extract all command tags from GM narration and return clean content. */
export function parseGmTags(content: string): ParsedGmTags {
  let text = content;
  const result: ParsedGmTags = {
    cleanContent: "",
    music: null,
    sfx: [],
    background: null,
    ambient: null,
    choices: null,
    qte: null,
    stateChange: null,
    reputationActions: [],
    combatEncounter: null,
    directions: [],
    widgetUpdates: [],
    skillChecks: [],
    elementAttacks: [],
    inventoryUpdates: [],
    readables: [],
  };

  // [music: tag]
  const musicMatch = text.match(/\[music:\s*([^\]]+)\]/i);
  if (musicMatch) {
    result.music = musicMatch[1]!.trim();
    text = text.replace(musicMatch[0], "");
  }

  // [sfx: tag] — can appear multiple times
  const sfxRegex = /\[sfx:\s*([^\]]+)\]/gi;
  let sfxMatch: RegExpExecArray | null;
  while ((sfxMatch = sfxRegex.exec(text)) !== null) {
    result.sfx.push(sfxMatch[1]!.trim());
  }
  text = text.replace(/\[sfx:\s*[^\]]+\]/gi, "");

  // [bg: tag]
  const bgMatch = text.match(/\[bg:\s*([^\]]+)\]/i);
  if (bgMatch) {
    result.background = bgMatch[1]!.trim();
    text = text.replace(bgMatch[0], "");
  }

  // [ambient: tag]
  const ambientMatch = text.match(/\[ambient:\s*([^\]]+)\]/i);
  if (ambientMatch) {
    result.ambient = ambientMatch[1]!.trim();
    text = text.replace(ambientMatch[0], "");
  }

  // [choices: "A" | "B" | "C"] — use balanced bracket extraction for content with ]
  {
    const { contents, remaining } = extractBalancedTags(text, "[choices:");
    if (contents.length > 0) {
      const raw = contents[0]!;
      const choices = raw
        .split("|")
        .map((c) => c.trim().replace(/^["']|["']$/g, ""))
        .filter((c) => c.length > 0);
      if (choices.length > 0) result.choices = choices;
    }
    text = remaining;
  }

  // [qte: action1 | action2, timer: 5s]
  const qteMatch = text.match(/\[qte:\s*(.+?),\s*timer:\s*(\d+)s?\]/i);
  if (qteMatch) {
    const actions = qteMatch[1]!
      .split("|")
      .map((a) => a.trim().replace(/^["']|["']$/g, ""))
      .filter((a) => a.length > 0);
    const timer = parseInt(qteMatch[2]!, 10);
    if (actions.length > 0 && !isNaN(timer)) {
      result.qte = { actions, timer };
    }
    text = text.replace(qteMatch[0], "");
  }

  // [state: exploration|dialogue|combat|travel_rest]
  const stateMatch = text.match(/\[state:\s*(exploration|dialogue|combat|travel_rest)\]/i);
  if (stateMatch) {
    result.stateChange = stateMatch[1]!.trim();
    text = text.replace(stateMatch[0], "");
  }

  // [reputation: npc="Name" action="helped"] — can appear multiple times
  const repRegex = /\[reputation:\s*npc="([^"]+)"\s*action="([^"]+)"\]/gi;
  let repMatch: RegExpExecArray | null;
  while ((repMatch = repRegex.exec(text)) !== null) {
    result.reputationActions.push({
      npcName: repMatch[1]!.trim(),
      action: repMatch[2]!.trim(),
    });
  }
  text = text.replace(/\[reputation:\s*npc="[^"]+"\s*action="[^"]+"\]/gi, "");

  // [combat: enemies="Goblin:5:40:8:5:6, Skeleton:3:25:6:3:4"]
  // Format: Name:Level:HP:ATK:DEF:SPD — comma separated for multiple enemies
  // Simplified format: [combat: enemies="Goblin, Skeleton"] (auto-generates stats from level)
  const combatMatch = text.match(/\[combat:\s*enemies="([^"]+)"\]/i);
  if (combatMatch) {
    const raw = combatMatch[1]!;
    const enemyEntries = raw
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    const enemies: CombatEncounterTag["enemies"] = [];

    for (const entry of enemyEntries) {
      const parts = entry.split(":").map((p) => p.trim());
      if (parts.length >= 6) {
        // Full stat format: Name:Level:HP:ATK:DEF:SPD[:Element]
        enemies.push({
          name: parts[0]!,
          level: parseInt(parts[1]!, 10) || 1,
          hp: parseInt(parts[2]!, 10) || 30,
          attack: parseInt(parts[3]!, 10) || 8,
          defense: parseInt(parts[4]!, 10) || 5,
          speed: parseInt(parts[5]!, 10) || 5,
          element: parts[6] || undefined,
        });
      } else {
        // Name only or Name:Level — auto-generate stats
        const name = parts[0]!;
        const level = parts.length >= 2 ? parseInt(parts[1]!, 10) || 1 : 3;
        enemies.push({
          name,
          level,
          hp: 20 + level * 8,
          attack: 5 + level * 2,
          defense: 3 + level,
          speed: 3 + level,
        });
      }
    }

    if (enemies.length > 0) {
      result.combatEncounter = { enemies };
    }
    text = text.replace(combatMatch[0], "");
  }

  // [direction: effect, param: value, ...] — cinematic commands (can appear multiple times)
  const VALID_DIRECTIONS = new Set([
    "fade_from_black",
    "fade_to_black",
    "flash",
    "screen_shake",
    "blur",
    "vignette",
    "letterbox",
    "color_grade",
    "focus",
  ]) as Set<string>;
  const dirRegex = /\[direction:\s*([^\],]+)(?:,([^\]]*))?\]/gi;
  let dirMatch: RegExpExecArray | null;
  while ((dirMatch = dirRegex.exec(text)) !== null) {
    const effect = dirMatch[1]!.trim();
    if (!VALID_DIRECTIONS.has(effect)) continue;
    const cmd: DirectionCommand = { effect: effect as DirectionEffect };
    if (dirMatch[2]) {
      const paramStr = dirMatch[2];
      const pairs = paramStr.split(",").map((p) => p.trim());
      const extraParams: Record<string, string> = {};
      for (const pair of pairs) {
        const [k, v] = pair.split(":").map((s) => s.trim());
        if (!k || !v) continue;
        if (k === "duration") {
          const parsed = parseFloat(v);
          cmd.duration = isNaN(parsed) ? 1 : parsed;
        } else if (k === "intensity") {
          const parsed = parseFloat(v);
          cmd.intensity = Math.max(0, Math.min(1, isNaN(parsed) ? 0.5 : parsed));
        } else if (k === "target" && (v === "background" || v === "content" || v === "all")) cmd.target = v;
        else extraParams[k] = v;
      }
      if (Object.keys(extraParams).length > 0) cmd.params = extraParams;
    }
    result.directions.push(cmd);
  }
  text = text.replace(/\[direction:\s*[^\]]+\]/gi, "");

  // [widget: id, key: value, ...] — widget update commands (can appear multiple times)
  const widgetRegex = /\[widget:\s*([^,\]]+)(?:,([^\]]*))?\]/gi;
  let widgetMatch: RegExpExecArray | null;
  while ((widgetMatch = widgetRegex.exec(text)) !== null) {
    const widgetId = widgetMatch[1]!.trim();
    const changes: WidgetUpdate["changes"] = {};
    if (widgetMatch[2]) {
      const pairs = widgetMatch[2].split(",").map((p) => p.trim());
      for (const pair of pairs) {
        const colonIdx = pair.indexOf(":");
        if (colonIdx < 0) continue;
        const k = pair.slice(0, colonIdx).trim();
        const v = pair.slice(colonIdx + 1).trim();
        const stripped = v.replace(/^["']|["']$/g, "");
        if (k === "value") {
          const parsed = parseFloat(stripped);
          changes.value = isNaN(parsed) ? stripped : parsed;
        } else if (k === "stat") changes.statName = stripped;
        else if (k === "add") changes.add = stripped;
        else if (k === "remove") changes.remove = stripped;
        else if (k === "count") {
          const parsed = parseInt(stripped, 10);
          changes.count = isNaN(parsed) ? 0 : parsed;
        } else if (k === "running") changes.running = stripped === "true";
        else if (k === "seconds") {
          const parsed = parseInt(stripped, 10);
          changes.seconds = isNaN(parsed) ? 0 : parsed;
        }
      }
    }
    result.widgetUpdates.push({ widgetId, changes });
  }
  text = text.replace(/\[widget:\s*[^\]]+\]/gi, "");

  // Also strip other existing tags that the UI handles separately
  // [map_update: ...] — uses balanced bracket stripping because JSON content contains nested []
  text = stripBalancedTag(text, "[map_update:");
  // [dialogue: npc="..."]
  text = text.replace(/\[dialogue:\s*npc="[^"]*"\]/gi, "");
  // [session_end: ...]
  text = text.replace(/\[session_end:\s*[^\]]*\]/gi, "");

  // [skill_check: skill="Perception" dc=15] — can appear multiple times
  const skillRegex = /\[skill_check:\s*skill="([^"]+)"\s*dc=(\d+)(?:\s*advantage)?(?:\s*disadvantage)?\]/gi;
  let skillMatch: RegExpExecArray | null;
  while ((skillMatch = skillRegex.exec(text)) !== null) {
    const tag: SkillCheckTag = {
      skill: skillMatch[1]!.trim(),
      dc: parseInt(skillMatch[2]!, 10),
    };
    if (skillMatch[0].includes("advantage")) tag.advantage = true;
    if (skillMatch[0].includes("disadvantage")) tag.disadvantage = true;
    result.skillChecks.push(tag);
  }
  text = text.replace(/\[skill_check:\s*[^\]]+\]/gi, "");

  // [element_attack: element="pyro" target="Goblin"] — can appear multiple times
  const elemRegex = /\[element_attack:\s*element="([^"]+)"\s*target="([^"]+)"\]/gi;
  let elemMatch: RegExpExecArray | null;
  while ((elemMatch = elemRegex.exec(text)) !== null) {
    result.elementAttacks.push({
      element: elemMatch[1]!.trim().toLowerCase(),
      target: elemMatch[2]!.trim(),
    });
  }
  text = text.replace(/\[element_attack:\s*[^\]]+\]/gi, "");

  // [inventory: ...] — lenient parser: accepts any attribute order, quoted or
  // unquoted values, `item` or `items`, and a bare `add|remove` keyword.
  // Examples that all parse:
  //   [inventory: action="add" item="Bronze Key, Health Potion"]
  //   [inventory: add item="Bronze Key"]
  //   [inventory: item="Bronze Key" action=add]
  //   [inventory: items="Bronze Key, Map"]   (plural)
  //   [inventory: remove item=Bronze Key]    (unquoted single word)
  const invBlockRegex = /\[inventory:\s*([^\]]+)\]/gi;
  let invBlock: RegExpExecArray | null;
  while ((invBlock = invBlockRegex.exec(text)) !== null) {
    const body = invBlock[1] || "";
    // action: either action="add" / action=add, or a bare leading add/remove word
    let action: "add" | "remove" = "add";
    const actAttr = /action\s*=\s*"?(add|remove)"?/i.exec(body);
    if (actAttr) {
      action = actAttr[1]!.toLowerCase() as "add" | "remove";
    } else {
      const bareAct = /(^|\s)(add|remove)(\s|$)/i.exec(body);
      if (bareAct) action = bareAct[2]!.toLowerCase() as "add" | "remove";
    }
    // items: prefer quoted capture, fall back to unquoted single token / rest
    let itemStr = "";
    const itemsQuoted = /items?\s*=\s*"([^"]+)"/i.exec(body);
    if (itemsQuoted) {
      itemStr = itemsQuoted[1]!;
    } else {
      const itemsUnquoted = /items?\s*=\s*([^,\]\s][^,\]]*)/i.exec(body);
      if (itemsUnquoted) itemStr = itemsUnquoted[1]!;
    }
    const items = itemStr
      .split(",")
      .map((i) => i.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    if (items.length > 0) {
      result.inventoryUpdates.push({ action, items });
    }
  }
  text = text.replace(/\[inventory:\s*[^\]]+\]/gi, "");

  // [Note: content] or [Book: content] — readable documents (balanced brackets)
  {
    const { contents: noteContents, remaining: afterNotes } = extractBalancedTags(text, "[Note:");
    text = afterNotes;
    for (const c of noteContents) {
      if (c) result.readables.push({ type: "note", content: c });
    }
    const { contents: bookContents, remaining: afterBooks } = extractBalancedTags(text, "[Book:");
    text = afterBooks;
    for (const c of bookContents) {
      if (c) result.readables.push({ type: "book", content: c });
    }
  }

  // [dice: ...] — informational dice results
  text = text.replace(/\[dice:\s*[^\]]+\]/gi, "");

  // Catch-all: strip any remaining [tag: ...] brackets the model may invent
  text = text.replace(/\[\w+:[^\]]*\]/g, "");

  // Remove orphaned ] on a line by itself (from partially-stripped multi-line tags)
  text = text.replace(/^\s*\]\s*$/gm, "");

  result.cleanContent = text.trim();
  return result;
}

/** Strip all GM command tags from text, returning clean display content. */
export function stripGmTags(content: string): string {
  let text = content
    // Strip the tactical-combat recap block sent after a battle (multiline, no colon).
    .replace(/\[combat_result\][\s\S]*?\[\/combat_result\]/gi, "")
    .replace(/\[music:\s*[^\]]+\]/gi, "")
    .replace(/\[sfx:\s*[^\]]+\]/gi, "")
    .replace(/\[bg:\s*[^\]]+\]/gi, "")
    .replace(/\[ambient:\s*[^\]]+\]/gi, "")
    .replace(/\[qte:\s*[^\]]+\]/gi, "")
    .replace(/\[state:\s*[^\]]+\]/gi, "")
    .replace(/\[reputation:\s*[^\]]+\]/gi, "")
    .replace(/\[combat:\s*[^\]]+\]/gi, "")
    .replace(/\[direction:\s*[^\]]+\]/gi, "")
    .replace(/\[widget:\s*[^\]]+\]/gi, "")
    .replace(/\[dialogue:\s*npc="[^"]*"\]/gi, "")
    .replace(/\[session_end:\s*[^\]]*\]/gi, "")
    .replace(/\[skill_check:\s*[^\]]+\]/gi, "")
    .replace(/\[element_attack:\s*[^\]]+\]/gi, "")
    .replace(/\[inventory:\s*[^\]]+\]/gi, "")
    .replace(/\[party-turn\]/gi, "")
    .replace(/\[party-chat\]/gi, "")
    .replace(/\[dice:\s*[^\]]+\]/gi, "")
    // Catch-all: strip any remaining [tag: ...] brackets the model may invent
    .replace(/\[\w+:[^\]]*\]/g, "");
  // Balanced bracket stripping for tags whose content may contain nested []
  text = stripBalancedTag(text, "[map_update:");
  text = stripBalancedTag(text, "[choices:");
  text = stripBalancedTag(text, "[Note:");
  text = stripBalancedTag(text, "[Book:");
  // Remove orphaned ] on a line by itself (from partially-stripped multi-line tags)
  text = text.replace(/^\s*\]\s*$/gm, "");
  return text.trim();
}

/**
 * Strip all GM tags EXCEPT [Note:] and [Book:] — these are kept inline
 * so the narration parser can create readable segments at the correct
 * story position.
 */
export function stripGmTagsKeepReadables(content: string): string {
  let text = content
    // Strip the tactical-combat recap block sent after a battle (multiline, no colon).
    .replace(/\[combat_result\][\s\S]*?\[\/combat_result\]/gi, "")
    .replace(/\[music:\s*[^\]]+\]/gi, "")
    .replace(/\[sfx:\s*[^\]]+\]/gi, "")
    .replace(/\[bg:\s*[^\]]+\]/gi, "")
    .replace(/\[ambient:\s*[^\]]+\]/gi, "")
    .replace(/\[qte:\s*[^\]]+\]/gi, "")
    .replace(/\[state:\s*[^\]]+\]/gi, "")
    .replace(/\[reputation:\s*[^\]]+\]/gi, "")
    .replace(/\[combat:\s*[^\]]+\]/gi, "")
    .replace(/\[direction:\s*[^\]]+\]/gi, "")
    .replace(/\[widget:\s*[^\]]+\]/gi, "")
    .replace(/\[dialogue:\s*npc="[^"]*"\]/gi, "")
    .replace(/\[session_end:\s*[^\]]*\]/gi, "")
    .replace(/\[skill_check:\s*[^\]]+\]/gi, "")
    .replace(/\[element_attack:\s*[^\]]+\]/gi, "")
    .replace(/\[inventory:\s*[^\]]+\]/gi, "")
    .replace(/\[party-turn\]/gi, "")
    .replace(/\[party-chat\]/gi, "")
    .replace(/\[dice:\s*[^\]]+\]/gi, "")
    // Catch-all: strip unknown [tag: ...] except [Note:] and [Book:]
    .replace(/\[(?!Note:|Book:)\w+:[^\]]*\]/g, "");
  // Balanced bracket stripping for non-readable tags
  text = stripBalancedTag(text, "[map_update:");
  text = stripBalancedTag(text, "[choices:");
  // NOTE: [Note:] and [Book:] are intentionally kept!
  // Remove orphaned ] on a line by itself (from partially-stripped multi-line tags)
  text = text.replace(/^\s*\]\s*$/gm, "");
  return text.trim();
}
