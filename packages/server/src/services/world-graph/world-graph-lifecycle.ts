// ──────────────────────────────────────────────
// World Graph Lifecycle Helpers
// ──────────────────────────────────────────────
import type { DB } from "../../db/connection.js";
import type { CurrentWorldGraph } from "./world-graph.storage.js";
import { createWorldGraphStorage } from "./world-graph.storage.js";

export interface WorldGraphLifecycle {
  rebuildForChat(chatId: string): Promise<CurrentWorldGraph>;
}

export function createWorldGraphLifecycle(db: DB): WorldGraphLifecycle {
  const storage = createWorldGraphStorage(db);

  return {
    async rebuildForChat(chatId: string) {
      return storage.rebuildForChat(chatId);
    },
  };
}
