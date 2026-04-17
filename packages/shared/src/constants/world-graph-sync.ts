// ──────────────────────────────────────────────
// World Graph Sync Settings
// ──────────────────────────────────────────────

export type WorldGraphSyncProfile = "fast" | "balanced" | "full";
export type WorldGraphSyncEntryDetail = "preview" | "full";

export interface WorldGraphSyncSettings {
  syncProfile: WorldGraphSyncProfile;
  syncEntryDetail: WorldGraphSyncEntryDetail;
  syncPreviewChars: number;
  syncChunkCharLimit: number;
  syncSceneMessageCount: number;
  syncValidateDraftChunks: boolean;
  syncFinalRouteReview: boolean;
  syncMaxDraftRepairAttempts: number;
  syncMaxFinalRepairAttempts: number;
}

export type WorldGraphSyncProfileDefaults = Omit<WorldGraphSyncSettings, "syncChunkCharLimit">;

export const DEFAULT_WORLD_GRAPH_SYNC_CHUNK_CHAR_LIMIT = 30_000;

export const WORLD_GRAPH_SYNC_PROFILE_DEFAULTS: Record<WorldGraphSyncProfile, WorldGraphSyncProfileDefaults> = {
  fast: {
    syncProfile: "fast",
    syncEntryDetail: "preview",
    syncPreviewChars: 180,
    syncSceneMessageCount: 12,
    syncValidateDraftChunks: false,
    syncFinalRouteReview: false,
    syncMaxDraftRepairAttempts: 0,
    syncMaxFinalRepairAttempts: 1,
  },
  balanced: {
    syncProfile: "balanced",
    syncEntryDetail: "preview",
    syncPreviewChars: 320,
    syncSceneMessageCount: 24,
    syncValidateDraftChunks: false,
    syncFinalRouteReview: true,
    syncMaxDraftRepairAttempts: 0,
    syncMaxFinalRepairAttempts: 2,
  },
  full: {
    syncProfile: "full",
    syncEntryDetail: "full",
    syncPreviewChars: 600,
    syncSceneMessageCount: 36,
    syncValidateDraftChunks: true,
    syncFinalRouteReview: true,
    syncMaxDraftRepairAttempts: 1,
    syncMaxFinalRepairAttempts: 3,
  },
};

export const DEFAULT_WORLD_GRAPH_SYNC_SETTINGS: WorldGraphSyncSettings = {
  ...WORLD_GRAPH_SYNC_PROFILE_DEFAULTS.balanced,
  syncChunkCharLimit: DEFAULT_WORLD_GRAPH_SYNC_CHUNK_CHAR_LIMIT,
};

export function resolveWorldGraphSyncSettings(value: unknown): WorldGraphSyncSettings {
  const input = isRecord(value) ? value : {};
  const requestedProfile = parseProfile(input.syncProfile);
  const base = WORLD_GRAPH_SYNC_PROFILE_DEFAULTS[requestedProfile];

  return {
    syncProfile: requestedProfile,
    syncEntryDetail: parseEntryDetail(input.syncEntryDetail, base.syncEntryDetail),
    syncPreviewChars: clampInteger(input.syncPreviewChars, 80, 4_000, base.syncPreviewChars),
    syncChunkCharLimit: clampInteger(
      input.syncChunkCharLimit,
      8_000,
      120_000,
      DEFAULT_WORLD_GRAPH_SYNC_CHUNK_CHAR_LIMIT,
    ),
    syncSceneMessageCount: clampInteger(input.syncSceneMessageCount, 1, 120, base.syncSceneMessageCount),
    syncValidateDraftChunks: parseBoolean(input.syncValidateDraftChunks, base.syncValidateDraftChunks),
    syncFinalRouteReview: parseBoolean(input.syncFinalRouteReview, base.syncFinalRouteReview),
    syncMaxDraftRepairAttempts: clampInteger(
      input.syncMaxDraftRepairAttempts,
      0,
      5,
      base.syncMaxDraftRepairAttempts,
    ),
    syncMaxFinalRepairAttempts: clampInteger(
      input.syncMaxFinalRepairAttempts,
      0,
      6,
      base.syncMaxFinalRepairAttempts,
    ),
  };
}

function parseProfile(value: unknown): WorldGraphSyncProfile {
  return value === "fast" || value === "balanced" || value === "full" ? value : DEFAULT_WORLD_GRAPH_SYNC_SETTINGS.syncProfile;
}

function parseEntryDetail(
  value: unknown,
  fallback: WorldGraphSyncEntryDetail,
): WorldGraphSyncEntryDetail {
  return value === "preview" || value === "full" ? value : fallback;
}

function parseBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
