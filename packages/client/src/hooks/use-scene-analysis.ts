// ──────────────────────────────────────────────
// Hook: useSceneAnalysis
//
// Sends completed narration to the local sidecar
// model for scene analysis (backgrounds, music,
// widgets, expressions, etc.) and returns the
// structured result. Falls back to a regular
// connection via /game/scene-wrap when sidecar
// is not available.
// ──────────────────────────────────────────────

import { useMutation } from "@tanstack/react-query";
import type { SceneAnalysis, HudWidget, GameNpc, GameActiveState } from "@marinara-engine/shared";

interface AnalyzeSceneInput {
  narration: string;
  playerAction?: string;
  context: {
    currentState: GameActiveState;
    availableBackgrounds: string[];
    availableSfx: string[];
    activeWidgets: HudWidget[];
    trackedNpcs: GameNpc[];
    characterNames: string[];
    currentBackground: string | null;
    currentMusic: string | null;
    currentAmbient: string | null;
    currentWeather: string | null;
    currentTimeOfDay: string | null;
  };
  /** When provided, uses a regular connection instead of sidecar. */
  chatId?: string;
  connectionId?: string;
}

async function analyzeScene(input: AnalyzeSceneInput): Promise<SceneAnalysis> {
  // If chatId is provided, use the connection-based route
  if (input.chatId) {
    const payload = {
      chatId: input.chatId,
      narration: input.narration,
      playerAction: input.playerAction,
      context: input.context,
      connectionId: input.connectionId,
    };
    const raw = await fetch("/api/game/scene-wrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!raw.ok) {
      const body = await raw.json().catch(() => ({}));
      console.warn("[scene-wrap] Server 400 details:", JSON.stringify(body.details ?? body, null, 2));
      throw new Error(body.error ?? `scene-wrap failed: ${raw.status}`);
    }
    const res = await raw.json();
    if (!res.result) throw new Error("Scene wrap-up returned no result");
    return res.result;
  }

  // Default: use sidecar
  const res = await fetch("/api/sidecar/analyze-scene", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      narration: input.narration,
      playerAction: input.playerAction,
      context: input.context,
    }),
  });
  if (!res.ok) {
    throw new Error(`Scene analysis failed: ${res.status}`);
  }
  const data = await res.json();
  return data.result;
}

export function useSceneAnalysis() {
  return useMutation({
    mutationFn: analyzeScene,
  });
}
