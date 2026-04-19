// ──────────────────────────────────────────────
// Sidecar Routes — Model management & inference
// ──────────────────────────────────────────────

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { sidecarModelService } from "../services/sidecar/sidecar-model.service.js";
import {
  analyzeScene,
  isInferenceAvailable,
  isInferenceBusy,
  runTrackerPrompt,
  unloadModel,
} from "../services/sidecar/sidecar-inference.service.js";
import {
  buildSceneAnalyzerSystemPrompt,
  buildSceneAnalyzerUserPrompt,
  type SceneAnalyzerContext,
} from "../services/sidecar/scene-analyzer.js";
import { postProcessSceneResult, type PostProcessContext } from "../services/sidecar/scene-postprocess.js";
import { scoreMusic, scoreAmbient, type GameActiveState } from "@marinara-engine/shared";
import type { SidecarQuantization } from "@marinara-engine/shared";

export const sidecarRoutes: FastifyPluginAsync = async (app) => {
  // ── Status ──
  app.get("/status", async () => {
    const status = sidecarModelService.getStatus();
    const inferenceReady = await isInferenceAvailable();
    return { ...status, inferenceReady };
  });

  // ── Update Config ──
  const configSchema = z.object({
    useForTrackers: z.boolean().optional(),
    useForGameScene: z.boolean().optional(),
    contextSize: z.number().int().min(512).max(32768).optional(),
    gpuLayers: z.number().int().min(-1).max(256).optional(),
  });

  app.patch("/config", async (req) => {
    const body = configSchema.parse(req.body);
    const config = sidecarModelService.updateConfig(body);
    return { config };
  });

  // ── Download Model (SSE progress stream) ──
  app.post<{
    Body: { quantization: SidecarQuantization };
  }>("/download", async (req, reply) => {
    const { quantization } = req.body;
    if (!quantization || !["q8_0", "q4_k_m"].includes(quantization)) {
      return reply.status(400).send({ error: "Invalid quantization. Must be q8_0 or q4_k_m." });
    }

    // Hijack the response so Fastify doesn't try to finalize it
    await reply.hijack();

    // Set up SSE response
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (data: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await sidecarModelService.download(quantization, (progress) => {
        sendEvent(progress);
      });
      sendEvent({ status: "complete" });
    } catch (err) {
      sendEvent({
        status: "error",
        error: err instanceof Error ? err.message : "Download failed",
      });
    } finally {
      reply.raw.end();
    }
  });

  // ── Cancel Download ──
  app.post("/download/cancel", async () => {
    sidecarModelService.cancelDownload();
    return { ok: true };
  });

  // ── Delete Model ──
  app.delete("/model", async (_req, reply) => {
    if (isInferenceBusy()) {
      return reply.status(409).send({ error: "Cannot delete model while inference is in progress" });
    }
    await unloadModel();
    sidecarModelService.deleteModel();
    return { ok: true };
  });

  // ── Unload Model (free RAM without deleting file) ──
  app.post("/unload", async () => {
    await unloadModel();
    return { ok: true };
  });

  // ── Scene Analysis (game mode) ──
  const sceneBodySchema = z.object({
    narration: z.string().max(16000),
    playerAction: z.string().max(4000).optional(),
    context: z.object({
      currentState: z.string().optional(),
      availableBackgrounds: z.array(z.string()).optional(),
      availableSfx: z.array(z.string()).optional(),
      activeWidgets: z.array(z.unknown()).optional(),
      trackedNpcs: z.array(z.unknown()).optional(),
      characterNames: z.array(z.string()).optional(),
      currentBackground: z.string().nullable().optional(),
      currentMusic: z.string().nullable().optional(),
      currentAmbient: z.string().nullable().optional(),
      currentWeather: z.string().nullable().optional(),
      currentTimeOfDay: z.string().nullable().optional(),
    }),
  });

  app.post("/analyze-scene", async (req, reply) => {
    const body = sceneBodySchema.parse(req.body);
    const available = await isInferenceAvailable();
    if (!available) {
      return reply.status(503).send({ error: "Sidecar model not available" });
    }

    const bgTags = body.context.availableBackgrounds ?? [];
    const sfxTags = body.context.availableSfx ?? [];
    console.log(`[scene-analysis] Available: ${bgTags.length} bg, ${sfxTags.length} sfx`);

    const sceneCtx = body.context as SceneAnalyzerContext;
    const systemPrompt = buildSceneAnalyzerSystemPrompt(sceneCtx);
    const userPrompt = buildSceneAnalyzerUserPrompt(body.narration, body.playerAction, sceneCtx);

    console.log("[scene-analysis] === SYSTEM PROMPT ===");
    console.log(systemPrompt);
    console.log("[scene-analysis] === USER PROMPT ===");
    console.log(userPrompt);
    console.log("[scene-analysis] === END PROMPTS ===");

    try {
      const raw = await analyzeScene(systemPrompt, userPrompt);

      // Post-process: fuzzy-match prose → real tags, normalise expressions,
      // and filter widget updates to valid IDs.
      const widgets = (body.context.activeWidgets ?? []) as { id?: string }[];
      const ppCtx: PostProcessContext = {
        availableBackgrounds: bgTags,
        availableSfx: sfxTags,
        validWidgetIds: new Set(widgets.map((w) => w.id).filter(Boolean) as string[]),
        characterNames: body.context.characterNames ?? [],
      };
      const result = postProcessSceneResult(raw, ppCtx);

      // ── Dynamic music & ambient scoring ──
      // Read available tags from server-side manifest.
      const { getAssetManifest } = await import("../services/game/asset-manifest.service.js");
      const assetManifest = getAssetManifest();
      const allAssetKeys = Object.keys(assetManifest.assets ?? {});
      const serverMusicTags = allAssetKeys.filter((k: string) => k.startsWith("music:"));
      const serverAmbientTags = allAssetKeys.filter((k: string) => k.startsWith("ambient:"));

      const scoredMusic = scoreMusic({
        state: (body.context.currentState as GameActiveState) ?? "exploration",
        weather: result.weather ?? body.context.currentWeather ?? null,
        timeOfDay: result.timeOfDay ?? body.context.currentTimeOfDay ?? null,
        currentMusic: body.context.currentMusic ?? null,
        availableMusic: serverMusicTags,
      });
      if (scoredMusic) {
        result.music = scoredMusic;
      } else if (result.music) {
        result.music = null;
      }

      const scoredAmbient = scoreAmbient({
        state: (body.context.currentState as GameActiveState) ?? "exploration",
        weather: result.weather ?? body.context.currentWeather ?? null,
        timeOfDay: result.timeOfDay ?? body.context.currentTimeOfDay ?? null,
        currentAmbient: body.context.currentAmbient ?? null,
        availableAmbient: serverAmbientTags,
        background: result.background ?? body.context.currentBackground,
      });
      if (scoredAmbient) {
        result.ambient = scoredAmbient;
      } else if (result.ambient) {
        result.ambient = null;
      }

      console.log("[scene-analysis] Post-processed result:", JSON.stringify(result, null, 2));
      return { result };
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : "Scene analysis failed",
      });
    }
  });

  // ── Tracker Inference (roleplay mode) ──
  const trackerBodySchema = z.object({
    systemPrompt: z.string().max(16000),
    userPrompt: z.string().max(16000),
  });

  app.post("/tracker", async (req, reply) => {
    const body = trackerBodySchema.parse(req.body);
    const available = await isInferenceAvailable();
    if (!available) {
      return reply.status(503).send({ error: "Sidecar model not available" });
    }

    try {
      const result = await runTrackerPrompt(body.systemPrompt, body.userPrompt);
      return { result };
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : "Tracker inference failed",
      });
    }
  });
};
