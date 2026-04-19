// ──────────────────────────────────────────────
// Sidecar Local Model — Model Lifecycle Service
//
// Manages downloading, loading, and unloading the
// local Gemma GGUF model. Persists config to a
// JSON file in data/models/.
// ──────────────────────────────────────────────

import { existsSync, mkdirSync, statSync, createWriteStream, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { pipeline as streamPipeline } from "stream/promises";
import { Readable } from "stream";
import {
  SIDECAR_DEFAULT_CONFIG,
  SIDECAR_MODELS,
  type SidecarConfig,
  type SidecarDownloadProgress,
  type SidecarQuantization,
  type SidecarStatus,
  type SidecarStatusResponse,
} from "@marinara-engine/shared";
import { getDataDir } from "../../utils/data-dir.js";

/** Directory where model files and config are stored. */
const MODELS_DIR = join(getDataDir(), "models");
const CONFIG_PATH = join(MODELS_DIR, "sidecar-config.json");

/** Event callbacks for download progress. */
type ProgressCallback = (progress: SidecarDownloadProgress) => void;

/** Singleton state for the sidecar model lifecycle. */
class SidecarModelService {
  private config: SidecarConfig;
  private status: SidecarStatus = "not_downloaded";
  private downloadAbort: AbortController | null = null;
  private progressListeners = new Set<ProgressCallback>();

  constructor() {
    mkdirSync(MODELS_DIR, { recursive: true });
    this.config = this.loadConfig();
    this.status = this.detectStatus();
  }

  // ── Config Persistence ──

  private loadConfig(): SidecarConfig {
    try {
      if (existsSync(CONFIG_PATH)) {
        const raw = readFileSync(CONFIG_PATH, "utf-8");
        return { ...SIDECAR_DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
    } catch {
      // Corrupted config → reset
    }
    return { ...SIDECAR_DEFAULT_CONFIG };
  }

  private saveConfig(): void {
    writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), "utf-8");
  }

  private detectStatus(): SidecarStatus {
    if (!this.config.quantization) return "not_downloaded";
    const path = this.getModelPath(this.config.quantization);
    if (path && existsSync(path)) return "downloaded";
    return "not_downloaded";
  }

  // ── Public Getters ──

  getStatus(): SidecarStatusResponse {
    const modelPath = this.config.quantization ? this.getModelPath(this.config.quantization) : null;
    let modelSize: number | null = null;
    if (modelPath && existsSync(modelPath)) {
      try {
        modelSize = statSync(modelPath).size;
      } catch {}
    }
    return {
      status: this.status,
      config: { ...this.config },
      modelDownloaded: modelPath !== null && existsSync(modelPath),
      modelSize,
    };
  }

  getConfig(): SidecarConfig {
    return { ...this.config };
  }

  getModelFilePath(): string | null {
    if (!this.config.quantization) return null;
    const p = this.getModelPath(this.config.quantization);
    return p && existsSync(p) ? p : null;
  }

  isReady(): boolean {
    return this.status === "ready" || this.status === "downloaded";
  }

  // ── Config Updates ──

  updateConfig(
    partial: Partial<Pick<SidecarConfig, "useForTrackers" | "useForGameScene" | "contextSize" | "gpuLayers">>,
  ): SidecarConfig {
    Object.assign(this.config, partial);
    this.saveConfig();
    return { ...this.config };
  }

  // ── Download ──

  async download(quantization: SidecarQuantization, onProgress?: ProgressCallback): Promise<void> {
    const modelInfo = SIDECAR_MODELS.find((m) => m.quantization === quantization);
    if (!modelInfo) throw new Error(`Unknown quantization: ${quantization}`);

    if (this.status === "downloading") throw new Error("Download already in progress");

    this.status = "downloading";
    this.downloadAbort = new AbortController();

    const destPath = this.getModelPath(quantization)!;
    const tempPath = destPath + ".download";

    try {
      const res = await fetch(modelInfo.downloadUrl, {
        signal: this.downloadAbort.signal,
        headers: { "User-Agent": "MarinaraEngine/1.0" },
      });

      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
      if (!res.body) throw new Error("No response body");

      const total = parseInt(res.headers.get("content-length") || "0", 10);
      let downloaded = 0;
      let lastReportTime = Date.now();
      let lastReportBytes = 0;

      const reader = res.body.getReader();
      const ws = createWriteStream(tempPath);

      const readable = new Readable({
        async read() {
          try {
            const { done, value } = await reader.read();
            if (done) {
              this.push(null);
              return;
            }
            downloaded += value.byteLength;

            // Report progress at most 4 times per second
            const now = Date.now();
            if (now - lastReportTime >= 250) {
              const elapsed = (now - lastReportTime) / 1000;
              const speed = elapsed > 0 ? (downloaded - lastReportBytes) / elapsed : 0;
              const progress: SidecarDownloadProgress = {
                status: "downloading",
                downloaded,
                total,
                speed,
              };
              this.emit("download-progress", progress);
              onProgress?.(progress);
              for (const listener of sidecarModelService.progressListeners) {
                listener(progress);
              }
              lastReportTime = now;
              lastReportBytes = downloaded;
            }

            this.push(value);
          } catch (err) {
            this.destroy(err as Error);
          }
        },
      });

      await streamPipeline(readable, ws);

      // Rename temp → final
      const { renameSync } = await import("fs");
      renameSync(tempPath, destPath);

      // Update config
      this.config.quantization = quantization;
      this.saveConfig();
      this.status = "downloaded";

      const completeProgress: SidecarDownloadProgress = {
        status: "complete",
        downloaded: total || downloaded,
        total: total || downloaded,
        speed: 0,
      };
      onProgress?.(completeProgress);
      for (const listener of this.progressListeners) {
        listener(completeProgress);
      }
    } catch (err) {
      // Clean up partial download
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      } catch {}

      this.status = this.detectStatus();

      const error = err instanceof Error ? err.message : "Unknown download error";
      if (error.includes("abort")) {
        throw new Error("Download cancelled");
      }

      const errorProgress: SidecarDownloadProgress = {
        status: "error",
        downloaded: 0,
        total: 0,
        speed: 0,
        error,
      };
      onProgress?.(errorProgress);
      for (const listener of this.progressListeners) {
        listener(errorProgress);
      }
      throw err;
    } finally {
      this.downloadAbort = null;
    }
  }

  cancelDownload(): void {
    if (this.downloadAbort) {
      this.downloadAbort.abort();
      this.downloadAbort = null;
    }
  }

  // ── Delete Model ──

  deleteModel(): void {
    if (this.config.quantization) {
      const p = this.getModelPath(this.config.quantization);
      if (p && existsSync(p)) {
        unlinkSync(p);
      }
    }
    this.config.quantization = null;
    this.saveConfig();
    this.status = "not_downloaded";
  }

  // ── Progress Listeners (for SSE) ──

  addProgressListener(cb: ProgressCallback): void {
    this.progressListeners.add(cb);
  }

  removeProgressListener(cb: ProgressCallback): void {
    this.progressListeners.delete(cb);
  }

  // ── Internals ──

  setStatus(s: SidecarStatus): void {
    this.status = s;
  }

  private getModelPath(quant: SidecarQuantization): string | null {
    const info = SIDECAR_MODELS.find((m) => m.quantization === quant);
    if (!info) return null;
    const filename = `gemma-4-E2B-it-${quant.toUpperCase()}.gguf`;
    return join(MODELS_DIR, filename);
  }
}

export const sidecarModelService = new SidecarModelService();
