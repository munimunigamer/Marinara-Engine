// ──────────────────────────────────────────────
// Sidecar Local Model — Inference Service
//
// Loads the GGUF model via node-llama-cpp and
// runs inference with JSON schema grammar
// constraints. Falls back gracefully when the
// native module isn't available.
// ──────────────────────────────────────────────

import type { SceneAnalysis } from "@marinara-engine/shared";
import { sidecarModelService } from "./sidecar-model.service.js";

// node-llama-cpp is an optional dependency — all access is via dynamic import.
// We store runtime references as `unknown` and cast at call sites to avoid
// needing the types at compile time.

let llamaModuleLoaded = false;
let llamaModule: Record<string, unknown> | null = null;
let llamaInstance: unknown | null = null;
let loadedModel: unknown | null = null;
let modelContext: unknown | null = null;
let sceneContext: unknown | null = null;

/** Simple async mutex — only one inference at a time. */
let inferenceLock: Promise<void> = Promise.resolve();
export function isInferenceBusy(): boolean {
  let busy = true;
  inferenceLock.then(() => {
    busy = false;
  });
  return busy;
}
function withInferenceLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  const prev = inferenceLock;
  inferenceLock = next;
  return prev.then(fn).finally(() => release!());
}

/** Maximum output tokens for all sidecar generations. */
const MAX_OUTPUT_TOKENS = 8192;

/** Max output tokens for scene analysis — bounded JSON, typically ~100-300 tokens. */
const SCENE_ANALYSIS_MAX_TOKENS = 4096;

/** Fixed context size for scene analysis — narration + asset lists + output headroom. */
const SCENE_ANALYSIS_CONTEXT_SIZE = 16_384;

function getLoadErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isGemma4ArchitectureError(err: unknown): boolean {
  const message = getLoadErrorMessage(err).toLowerCase();
  return message.includes("unknown model architecture") && message.includes("gemma4");
}

function formatModelLoadError(err: unknown): Error {
  if (isGemma4ArchitectureError(err)) {
    return new Error(
      "The local Gemma runtime is too old to load Gemma 4. Restart Marinara Engine so it can rebuild llama.cpp, then try again.",
    );
  }
  return err instanceof Error ? err : new Error(getLoadErrorMessage(err));
}

async function loadModelWithGpuPreference(
  llama: { loadModel: (opts: Record<string, unknown>) => Promise<unknown> },
  modelPath: string,
  config: ReturnType<typeof sidecarModelService.getConfig>,
): Promise<unknown> {
  const baseOptions = {
    modelPath,
    // Enable FA at model level so GPU layer auto-fitting accounts for the
    // reduced memory footprint of flash attention.
    defaultContextFlashAttention: true,
  };

  if (config.gpuLayers !== -1) {
    console.log(`[sidecar] Loading model with user-configured gpuLayers=${config.gpuLayers}`);
    try {
      return await llama.loadModel({ ...baseOptions, gpuLayers: config.gpuLayers });
    } catch (err) {
      throw formatModelLoadError(err);
    }
  }

  try {
    console.log("[sidecar] Loading model with gpuLayers=max (prefer full GPU offload)");
    return await llama.loadModel({ ...baseOptions, gpuLayers: "max" });
  } catch (err) {
    if (isGemma4ArchitectureError(err)) {
      throw formatModelLoadError(err);
    }

    console.warn(
      `[sidecar] Full GPU offload failed (${getLoadErrorMessage(err)}). Retrying with fitted auto GPU layers.`,
    );

    try {
      return await llama.loadModel({
        ...baseOptions,
        gpuLayers: {
          min: 1,
          fitContext: { contextSize: Math.max(config.contextSize, SCENE_ANALYSIS_CONTEXT_SIZE) },
        },
      });
    } catch (fallbackErr) {
      throw formatModelLoadError(fallbackErr);
    }
  }
}

/** Try to import node-llama-cpp. Returns null if not installed. */
async function getLlamaModule(): Promise<Record<string, unknown> | null> {
  if (llamaModuleLoaded) return llamaModule;
  llamaModuleLoaded = true;
  try {
    // Use a variable to prevent TypeScript from resolving this at compile time
    const moduleName = "node-llama-cpp";
    llamaModule = (await import(/* webpackIgnore: true */ moduleName)) as Record<string, unknown>;
    return llamaModule;
  } catch {
    return null;
  }
}

/** Initialize the llama runtime (once). */
async function ensureLlama(): Promise<unknown> {
  if (llamaInstance) return llamaInstance;
  const mod = await getLlamaModule();
  if (!mod) throw new Error("node-llama-cpp is not installed. Run: pnpm add node-llama-cpp");
  const getLlama = mod.getLlama as (opts?: Record<string, unknown>) => Promise<unknown>;
  llamaInstance = await getLlama({ gpu: "auto" });
  return llamaInstance;
}

/** Load the GGUF model into memory. */
async function ensureModel(): Promise<unknown> {
  if (loadedModel) return loadedModel;

  const modelPath = sidecarModelService.getModelFilePath();
  if (!modelPath) throw new Error("No sidecar model downloaded");

  const config = sidecarModelService.getConfig();
  sidecarModelService.setStatus("loading");

  try {
    const llama = (await ensureLlama()) as { loadModel: (opts: Record<string, unknown>) => Promise<unknown> };
    loadedModel = await loadModelWithGpuPreference(llama, modelPath, config);
    const resolvedGpuLayers = (loadedModel as { gpuLayers?: number } | null)?.gpuLayers;
    console.log(
      `[sidecar] Model loaded (gpuLayers=${resolvedGpuLayers ?? "unknown"}, contextSize=${config.contextSize})`,
    );
    sidecarModelService.setStatus("ready");
    return loadedModel;
  } catch (err) {
    sidecarModelService.setStatus("error");
    throw formatModelLoadError(err);
  }
}

/** Create a context for inference. */
async function ensureContext(): Promise<unknown> {
  if (modelContext) return modelContext;
  const model = (await ensureModel()) as { createContext: (opts: Record<string, unknown>) => Promise<unknown> };
  const config = sidecarModelService.getConfig();
  modelContext = await model.createContext({
    contextSize: config.contextSize,
    flashAttention: true,
    // Larger batch = faster prompt evaluation (process more tokens per GPU pass).
    batchSize: config.contextSize,
    // Use all available CPU math cores for token evaluation.
    threads: 0,
  });
  return modelContext;
}

/** Create (or reuse) a lightweight context dedicated to scene analysis. */
async function ensureSceneContext(): Promise<unknown> {
  if (sceneContext) return sceneContext;
  const model = (await ensureModel()) as { createContext: (opts: Record<string, unknown>) => Promise<unknown> };
  sceneContext = await model.createContext({
    contextSize: SCENE_ANALYSIS_CONTEXT_SIZE,
    flashAttention: true,
    batchSize: SCENE_ANALYSIS_CONTEXT_SIZE,
    threads: 0,
  });
  return sceneContext;
}

/** Unload the model and free memory. */
export async function unloadModel(): Promise<void> {
  if (sceneContext && typeof (sceneContext as { dispose?: () => void }).dispose === "function") {
    (sceneContext as { dispose: () => void }).dispose();
  }
  sceneContext = null;

  if (modelContext && typeof (modelContext as { dispose?: () => void }).dispose === "function") {
    (modelContext as { dispose: () => void }).dispose();
  }
  modelContext = null;

  if (loadedModel && typeof (loadedModel as { dispose?: () => void }).dispose === "function") {
    (loadedModel as { dispose: () => void }).dispose();
  }
  loadedModel = null;

  sidecarModelService.setStatus("downloaded");
}

// ── JSON Schema Definitions ──

/** JSON schema for SceneAnalysis output — used for grammar-constrained generation. */
const SCENE_ANALYSIS_SCHEMA = {
  type: "object" as const,
  properties: {
    background: { type: ["string", "null"] as const },
    music: { type: ["string", "null"] as const },
    ambient: { type: ["string", "null"] as const },
    weather: { type: ["string", "null"] as const },
    timeOfDay: { type: ["string", "null"] as const },
    reputationChanges: {
      type: "array" as const,
      maxItems: 5,
      items: {
        type: "object" as const,
        properties: {
          npcName: { type: "string" as const },
          action: { type: "string" as const },
        },
        required: ["npcName", "action"] as const,
      },
    },
    segmentEffects: {
      type: "array" as const,
      maxItems: 20,
      items: {
        type: "object" as const,
        properties: {
          segment: { type: "number" as const },
          sfx: { type: "array" as const, items: { type: "string" as const }, maxItems: 3 },
          background: { type: "string" as const },
        },
        required: ["segment"] as const,
      },
    },
  },
  additionalProperties: false as const,
  required: ["background", "music", "ambient", "weather", "timeOfDay", "reputationChanges", "segmentEffects"] as const,
};

// ── Public Inference API ──

/**
 * Run scene analysis on a completed narration turn.
 * Returns a structured SceneAnalysis object with grammar-enforced JSON.
 */
export async function analyzeScene(systemPrompt: string, userPrompt: string): Promise<SceneAnalysis> {
  return withInferenceLock(async () => {
    console.log("[sidecar] Starting scene analysis inference...");
    console.log(
      `[sidecar] System prompt length: ${systemPrompt.length} chars, User prompt length: ${userPrompt.length} chars`,
    );
    const startTime = Date.now();
    const mod = await getLlamaModule();
    if (!mod) throw new Error("node-llama-cpp is not installed");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const llama = (await ensureLlama()) as any;
    // Use a dedicated small context for scene analysis
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const context = (await ensureSceneContext()) as any;

    const grammar = await llama.createGrammarForJsonSchema(SCENE_ANALYSIS_SCHEMA);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ChatSession = (mod as any).LlamaChatSession;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const InputLookup = (mod as any).InputLookupTokenPredictor;
    const session = new ChatSession({ contextSequence: context.getSequence() });

    try {
      const response = await session.prompt(userPrompt, {
        grammar,
        maxTokens: SCENE_ANALYSIS_MAX_TOKENS,
        // HuggingFace recommended sampling for Gemma 4
        temperature: 1.0,
        topP: 0.95,
        topK: 64,
        systemPrompt,
        // Speculative decoding: n-gram lookup from input tokens. Scene analysis
        // output frequently repeats asset tag names from the prompt, so this
        // predicts multiple tokens per step for free (no draft model needed).
        tokenPredictor: InputLookup ? new InputLookup() : undefined,
      });

      console.log(`[sidecar] Scene analysis complete (${Date.now() - startTime}ms)`);
      console.log(`[sidecar] Raw response length: ${response.length} chars`);
      console.log("[sidecar] Raw response:\n", response);
      // Grammar constrains generation; use JSON.parse for validation since
      // grammar.parse() has bugs with union types like ["array", "null"].
      const parsed = JSON.parse(response) as SceneAnalysis;
      console.log("[sidecar] Parsed result:", JSON.stringify(parsed, null, 2));
      return parsed;
    } finally {
      session.dispose?.();
    }
  });
}

/**
 * Run a tracker agent prompt through the sidecar model.
 * Returns raw text output (tracker agents produce structured text, not JSON).
 */
export async function runTrackerPrompt(systemPrompt: string, userPrompt: string): Promise<string> {
  return withInferenceLock(async () => {
    console.log("[sidecar] Starting tracker inference...");
    const startTime = Date.now();
    const mod = await getLlamaModule();
    if (!mod) throw new Error("node-llama-cpp is not installed");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const context = (await ensureContext()) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ChatSession = (mod as any).LlamaChatSession;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const InputLookup = (mod as any).InputLookupTokenPredictor;
    const session = new ChatSession({ contextSequence: context.getSequence() });

    try {
      const response = await session.prompt(userPrompt, {
        maxTokens: MAX_OUTPUT_TOKENS,
        // HuggingFace recommended sampling for Gemma 4
        temperature: 1.0,
        topP: 0.95,
        topK: 64,
        systemPrompt,
        tokenPredictor: InputLookup ? new InputLookup() : undefined,
      });

      console.log(`[sidecar] Tracker inference complete (${Date.now() - startTime}ms)`);
      return response;
    } finally {
      session.dispose?.();
    }
  });
}

/**
 * Check if the sidecar inference is available (model downloaded + module installed).
 */
export async function isInferenceAvailable(): Promise<boolean> {
  const mod = await getLlamaModule();
  if (!mod) return false;
  return sidecarModelService.getModelFilePath() !== null;
}
