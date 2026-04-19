// ──────────────────────────────────────────────
// World Graph Sync Settings
// ──────────────────────────────────────────────

export interface WorldGraphSyncSettings {
  syncChunkCharLimit: number;
}

export const DEFAULT_WORLD_GRAPH_SYNC_CHUNK_CHAR_LIMIT = 30_000;
export const WORLD_GRAPH_SYNC_PREVIEW_CHARS = 320;
export const WORLD_GRAPH_SYNC_SCENE_MESSAGE_COUNT = 24;
export const WORLD_GRAPH_SYNC_MAX_CHUNK_REPAIR_ATTEMPTS = 1;
export const WORLD_GRAPH_SYNC_MAX_FINAL_REPAIR_ATTEMPTS = 2;

export const DEFAULT_WORLD_GRAPH_SYNC_SETTINGS: WorldGraphSyncSettings = {
  syncChunkCharLimit: DEFAULT_WORLD_GRAPH_SYNC_CHUNK_CHAR_LIMIT,
};

export function resolveWorldGraphSyncSettings(value: unknown): WorldGraphSyncSettings {
  const input = isRecord(value) ? value : {};

  return {
    syncChunkCharLimit: clampInteger(
      input.syncChunkCharLimit,
      8_000,
      120_000,
      DEFAULT_WORLD_GRAPH_SYNC_CHUNK_CHAR_LIMIT,
    ),
  };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
