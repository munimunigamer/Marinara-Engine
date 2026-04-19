// ──────────────────────────────────────────────
// Sidecar Local Model Types
//
// Types for the built-in Gemma E2B sidecar that
// handles tracker agents, scene analysis, widget
// updates, and game mechanics locally.
// ──────────────────────────────────────────────

/** Available quantization variants for the sidecar model. */
export type SidecarQuantization = "q8_0" | "q4_k_m";

/** Current lifecycle state of the sidecar model. */
export type SidecarStatus = "not_downloaded" | "downloading" | "downloaded" | "loading" | "ready" | "error";

/** Progress info while downloading the model GGUF. */
export interface SidecarDownloadProgress {
  status: "downloading" | "complete" | "error";
  /** Bytes downloaded so far. */
  downloaded: number;
  /** Total file size in bytes (0 if unknown). */
  total: number;
  /** Download speed in bytes/second. */
  speed: number;
  /** Error message if status is "error". */
  error?: string;
}

/** Persisted sidecar configuration stored server-side. */
export interface SidecarConfig {
  /** Which quantization variant is downloaded/active. Null if none. */
  quantization: SidecarQuantization | null;
  /** Whether to use the sidecar for tracker agents in roleplay mode. */
  useForTrackers: boolean;
  /** Whether to use the sidecar for game scene analysis (backgrounds, music, widgets, etc.). */
  useForGameScene: boolean;
  /** Context size for the model. Default 8192. */
  contextSize: number;
  /** GPU layers to offload (-1 = prefer full GPU offload, then fall back to auto-fit). */
  gpuLayers: number;
}

/** Server response for sidecar status endpoint. */
export interface SidecarStatusResponse {
  status: SidecarStatus;
  config: SidecarConfig;
  /** Whether a model file is downloaded on disk. */
  modelDownloaded: boolean;
  /** Model file size in bytes (if downloaded). */
  modelSize: number | null;
}

// ── Scene Analysis Output ──

/** A single segment-tied effect batch. Applied when the user reaches this segment. */
export interface SceneSegmentEffect {
  /** 0-based index of the narration segment this effect triggers on. */
  segment: number;
  background?: string | null;
  music?: string | null;
  sfx?: string[];
  ambient?: string | null;
  expressions?: Record<string, string>;
  widgetUpdates?: SceneWidgetUpdate[];
}

/** Scene analysis result from the sidecar model for game mode.
 *  Generated after the main model's narration is complete. */
export interface SceneAnalysis {
  /** Background tag from the asset manifest to display. */
  background: string | null;
  /** Music tag to play. */
  music: string | null;
  /** Ambient loop tag. */
  ambient: string | null;
  /** Weather description update — applied immediately. */
  weather: string | null;
  /** Time of day update — applied immediately. */
  timeOfDay: string | null;
  /** NPC reputation changes — applied immediately. */
  reputationChanges: SceneReputationChange[];
  /** Scene-wide widget updates — applied immediately after the turn. */
  widgetUpdates?: SceneWidgetUpdate[];
  /** Segment-indexed effects. Each entry fires when the user reaches that segment. */
  segmentEffects?: SceneSegmentEffect[];
  /** NPC avatars generated during this scene wrap (populated by server when image gen is enabled). */
  generatedNpcAvatars?: Array<{ name: string; avatarUrl: string }>;
}

/** A single widget update from scene analysis. */
export interface SceneWidgetUpdate {
  widgetId: string;
  /** For progress_bar/gauge/relationship_meter: new value. */
  value?: number | string;
  /** For counter: new count. */
  count?: number;
  /** For list/inventory: item to add. */
  add?: string;
  /** For list/inventory: item to remove. */
  remove?: string;
  /** For timer: start/stop. */
  running?: boolean;
  /** For timer: set seconds. */
  seconds?: number;
  /** For stat_block: which stat to update (by name). */
  statName?: string;
}

/** A reputation change from scene analysis. */
export interface SceneReputationChange {
  npcName: string;
  action: string;
}

// ── Model Metadata ──

/** Info about available sidecar models for download. */
export interface SidecarModelInfo {
  quantization: SidecarQuantization;
  /** Display name, e.g. "Gemma 4 E2B — Q8" */
  label: string;
  /** Approximate file size in bytes. */
  sizeBytes: number;
  /** Approximate RAM needed at runtime. */
  ramBytes: number;
  /** HuggingFace download URL. */
  downloadUrl: string;
  /** SHA256 hash for integrity check. */
  sha256?: string;
}

/** Default sidecar configuration. */
export const SIDECAR_DEFAULT_CONFIG: SidecarConfig = {
  quantization: null,
  useForTrackers: false,
  useForGameScene: true,
  contextSize: 8192,
  gpuLayers: -1,
};

/** Available models for download. */
export const SIDECAR_MODELS: SidecarModelInfo[] = [
  {
    quantization: "q8_0",
    label: "Gemma 4 E2B — Q8 (Best Quality)",
    sizeBytes: 5_400_000_000,
    ramBytes: 5_800_000_000,
    downloadUrl: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q8_0.gguf",
  },
  {
    quantization: "q4_k_m",
    label: "Gemma 4 E2B — Q4_K_M (Smaller, Faster)",
    sizeBytes: 3_200_000_000,
    ramBytes: 3_600_000_000,
    downloadUrl: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf",
  },
];
