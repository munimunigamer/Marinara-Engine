// ──────────────────────────────────────────────
// Sidecar Store — Client state for local model
// ──────────────────────────────────────────────

import { create } from "zustand";
import type {
  SidecarConfig,
  SidecarDownloadProgress,
  SidecarStatus,
  SidecarStatusResponse,
  SidecarQuantization,
} from "@marinara-engine/shared";
import { SIDECAR_DEFAULT_CONFIG } from "@marinara-engine/shared";
import { api } from "../lib/api-client.js";

interface SidecarState {
  status: SidecarStatus;
  config: SidecarConfig;
  inferenceReady: boolean;
  modelSize: number | null;
  downloadProgress: SidecarDownloadProgress | null;
  /** Whether the download/setup modal is open. */
  showDownloadModal: boolean;
  /** Has the user been prompted at least once (persisted in localStorage). */
  hasBeenPrompted: boolean;

  // Actions
  fetchStatus: () => Promise<void>;
  startDownload: (quantization: SidecarQuantization) => Promise<void>;
  cancelDownload: () => Promise<void>;
  deleteModel: () => Promise<void>;
  unloadModel: () => Promise<void>;
  updateConfig: (
    partial: Partial<Pick<SidecarConfig, "useForTrackers" | "useForGameScene" | "contextSize" | "gpuLayers">>,
  ) => Promise<void>;
  setShowDownloadModal: (open: boolean) => void;
  markPrompted: () => void;
}

const PROMPTED_KEY = "marinara_sidecar_prompted";

export const useSidecarStore = create<SidecarState>((set, get) => ({
  status: "not_downloaded",
  config: { ...SIDECAR_DEFAULT_CONFIG },
  inferenceReady: false,
  modelSize: null,
  downloadProgress: null,
  showDownloadModal: false,
  hasBeenPrompted: localStorage.getItem(PROMPTED_KEY) === "true",

  fetchStatus: async () => {
    try {
      const res = await api.get<SidecarStatusResponse & { inferenceReady: boolean }>("/sidecar/status");
      set({
        status: res.status,
        config: res.config,
        inferenceReady: res.inferenceReady,
        modelSize: res.modelSize,
      });
    } catch {
      // Server might not support sidecar yet
    }
  },

  startDownload: async (quantization) => {
    set({ downloadProgress: { status: "downloading", downloaded: 0, total: 0, speed: 0 } });

    try {
      const response = await fetch("/api/sidecar/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantization }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Download request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6)) as SidecarDownloadProgress;
            set({ downloadProgress: data });

            if (data.status === "complete") {
              set({ status: "downloaded", downloadProgress: null });
              get().fetchStatus();
              return;
            }
            if (data.status === "error") {
              set({ downloadProgress: data });
              return;
            }
          } catch {
            // Skip malformed events
          }
        }
      }

      // Process any remaining data in the buffer after stream ends
      if (buffer.trim()) {
        const remaining = buffer.split("\n");
        for (const line of remaining) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6)) as SidecarDownloadProgress;
            if (data.status === "complete") {
              set({ status: "downloaded", downloadProgress: null });
              get().fetchStatus();
              return;
            }
          } catch {
            // Skip malformed events
          }
        }
      }

      // Stream ended without explicit complete — fetch status to check
      set({ downloadProgress: null });
      await get().fetchStatus();
    } catch {
      // Only clear progress if it wasn't already set to error by an SSE event
      if (get().downloadProgress?.status !== "error") {
        set({ downloadProgress: null });
      }
    }
  },

  cancelDownload: async () => {
    try {
      await api.post("/sidecar/download/cancel");
    } catch {
      /* best-effort */
    }
    set({ downloadProgress: null });
  },

  deleteModel: async () => {
    try {
      await api.delete("/sidecar/model");
      set({ status: "not_downloaded", inferenceReady: false, modelSize: null });
    } catch {
      /* best-effort */
    }
  },

  unloadModel: async () => {
    try {
      await api.post("/sidecar/unload");
      set({ status: "downloaded", inferenceReady: false });
    } catch {
      /* best-effort */
    }
  },

  updateConfig: async (partial) => {
    // Optimistic update so toggles feel instant
    const prev = get().config;
    set({ config: { ...prev, ...partial } });
    try {
      const res = await api.patch<{ config: SidecarConfig }>("/sidecar/config", partial);
      set({ config: res.config });
    } catch {
      // Revert on failure
      set({ config: prev });
    }
  },

  setShowDownloadModal: (open) => set({ showDownloadModal: open }),

  markPrompted: () => {
    localStorage.setItem(PROMPTED_KEY, "true");
    set({ hasBeenPrompted: true });
  },
}));
