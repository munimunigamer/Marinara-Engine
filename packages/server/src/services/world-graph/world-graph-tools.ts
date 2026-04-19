// ──────────────────────────────────────────────
// World Graph Tool Facade
// ──────────────────────────────────────────────
import { worldGraphPatchSchema, type WorldGraphPatch } from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { createWorldGraphStorage } from "./world-graph.storage.js";

export function createWorldGraphTools(db: DB) {
  const storage = createWorldGraphStorage(db);

  return {
    async runPatch(input: {
      chatId: string;
      patch: WorldGraphPatch;
      apply: boolean;
      sourceRole?: "user" | "assistant" | "manual" | "ingest";
      sourcePhase?: "pre_generation" | "tool" | "post_generation" | "manual" | "ingest";
      messageId?: string | null;
      swipeIndex?: number | null;
      code?: string | null;
    }) {
      const patch = worldGraphPatchSchema.parse(input.patch);
      return storage.runPatch({ ...input, patch });
    },
  };
}
