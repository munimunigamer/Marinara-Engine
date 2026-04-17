// ──────────────────────────────────────────────
// World Graph Bootstrap
// ──────────────────────────────────────────────
import type { DB } from "../../db/connection.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { createWorldGraphStorage } from "./world-graph.storage.js";
import { normalizeWorldKey } from "./world-graph-runtime.js";

export async function ensureWorldGraphPlayer(db: DB, chatId: string) {
  const chats = createChatsStorage(db);
  const characters = createCharactersStorage(db);
  const storage = createWorldGraphStorage(db);

  const chat = await chats.getById(chatId);
  if (!chat) return null;

  const persona = chat.personaId ? await characters.getPersona(chat.personaId) : null;
  const playerName = persona?.name?.trim() || "Player";
  const playerDescription = buildPlayerDescription(persona);
  const current = await storage.getCurrentGraphForChat(chatId);

  const directKey = normalizeWorldKey("Player");
  const existingKey =
    current.runtime.hasNode(directKey)
      ? directKey
      : current.runtime.findNode((_, attrs) => {
          if (attrs.kind !== "character") return false;
          if (attrs.data && typeof attrs.data === "object" && (attrs.data as Record<string, unknown>).isPlayer === true) {
            return true;
          }
          return attrs.name.trim().toLowerCase() === playerName.toLowerCase();
        });

  const desiredData = {
    isPlayer: true,
    personaId: chat.personaId ?? null,
    aliases: Array.from(new Set(["Player", playerName])).filter(Boolean),
  };

  if (!existingKey) {
    await storage.runPatch({
      chatId,
      apply: true,
      sourceRole: "ingest",
      sourcePhase: "ingest",
      patch: {
        ops: [
          {
            type: "createCharacter",
            key: "player",
            name: playerName,
            description: playerDescription,
            data: desiredData,
          },
        ],
        events: [`Created player character ${playerName}.`],
      },
    });
    return { name: playerName, description: playerDescription };
  }

  const attrs = current.runtime.getNodeAttributes(existingKey);
  const currentData = attrs.data ?? {};
  const aliases = Array.isArray((currentData as Record<string, unknown>).aliases)
    ? ((currentData as Record<string, unknown>).aliases as unknown[]).map(String)
    : [];
  const dataChanged =
    (currentData as Record<string, unknown>).isPlayer !== true ||
    (currentData as Record<string, unknown>).personaId !== (chat.personaId ?? null) ||
    aliases.join("|") !== desiredData.aliases.join("|");
  const needsUpdate = attrs.name !== playerName || (attrs.description ?? "") !== playerDescription || dataChanged;

  if (needsUpdate) {
    await storage.runPatch({
      chatId,
      apply: true,
      sourceRole: "ingest",
      sourcePhase: "ingest",
      patch: {
        ops: [
          {
            type: "updateCharacter",
            key: existingKey,
            name: playerName,
            description: playerDescription,
            data: desiredData,
          },
        ],
        events: [`Updated player character ${playerName}.`],
      },
    });
  }

  return { name: playerName, description: playerDescription };
}

function buildPlayerDescription(
  persona:
    | {
        description?: string | null;
        personality?: string | null;
        appearance?: string | null;
        backstory?: string | null;
      }
    | null
    | undefined,
) {
  if (!persona) return "The player.";
  const parts = [
    persona.description?.trim(),
    persona.appearance?.trim() ? `Appearance: ${persona.appearance.trim()}` : "",
    persona.personality?.trim() ? `Personality: ${persona.personality.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return parts || "The player.";
}
