// ──────────────────────────────────────────────
// Model Download Modal
//
// Prompts users to download a local Gemma E2B
// model for offline tracker/scene analysis.
// Shows on first launch or from settings.
// ──────────────────────────────────────────────

import { useState, useEffect } from "react";
import { BrainCircuit, Check, Download, HardDrive, X, Zap } from "lucide-react";
import { Modal } from "../ui/Modal.js";
import { useSidecarStore } from "../../stores/sidecar.store.js";
import { SIDECAR_MODELS, type SidecarQuantization } from "@marinara-engine/shared";

interface Props {
  open: boolean;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function ModelDownloadModal({ open, onClose }: Props) {
  const { status, config, downloadProgress, startDownload, cancelDownload, markPrompted, fetchStatus } =
    useSidecarStore();
  const [selectedQuant, setSelectedQuant] = useState<SidecarQuantization>("q8_0");
  const isDownloading = downloadProgress?.status === "downloading";
  const isDownloaded = status === "downloaded" || status === "ready";

  // Refresh status when modal opens
  useEffect(() => {
    if (open) fetchStatus();
  }, [open, fetchStatus]);

  const handleSkip = () => {
    markPrompted();
    onClose();
  };

  const handleDownload = () => {
    markPrompted();
    startDownload(selectedQuant);
  };

  const handleCancel = () => {
    cancelDownload();
  };

  const handleDone = () => {
    markPrompted();
    onClose();
  };

  const progress = downloadProgress;
  const progressPercent = progress && progress.total > 0 ? Math.round((progress.downloaded / progress.total) * 100) : 0;

  return (
    <Modal open={open} onClose={isDownloading ? () => {} : onClose} title="Local AI Model" width="max-w-lg">
      <div className="flex flex-col gap-5">
        {/* Header explanation */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10">
            <BrainCircuit size="1.25rem" className="text-purple-400" />
          </div>
          <div className="text-sm text-[var(--muted-foreground)]">
            {isDownloaded ? (
              <p>
                Local AI model is ready! It will handle game mechanics, trackers, and scene effects without using your
                main model's tokens. You can manage it in Settings &rarr; Advanced.
              </p>
            ) : (
              <>
                <p>
                  Marinara Engine can run a small, local AI model to handle game mechanics, trackers, scene effects, and
                  widgets without using your main model's tokens.
                </p>
                <p className="mt-1.5 text-xs text-[var(--muted-foreground)]/70">
                  Powered by Google Gemma 4 E2B (2.3B effective parameters). Runs entirely on your device.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Success state — model already downloaded */}
        {isDownloaded && !isDownloading && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/5 p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/15">
                <Check size="1rem" className="text-green-400" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-green-300">Model Downloaded</div>
                <div className="text-xs text-[var(--muted-foreground)]/70">
                  {config.quantization?.toUpperCase()} variant installed and ready to use
                </div>
              </div>
            </div>
            <button
              onClick={handleDone}
              className="flex items-center justify-center gap-2 rounded-xl bg-purple-500/15 px-4 py-2.5 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/25"
            >
              Done
            </button>
          </div>
        )}

        {/* Model selection — only when not downloaded and not downloading */}
        {!isDownloaded && !isDownloading && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
              Select Model Size
            </span>
            {SIDECAR_MODELS.map((model) => (
              <label
                key={model.quantization}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${
                  selectedQuant === model.quantization
                    ? "border-purple-400/50 bg-purple-500/5"
                    : "border-[var(--border)] hover:bg-[var(--secondary)]/50"
                }`}
              >
                <input
                  type="radio"
                  name="quantization"
                  value={model.quantization}
                  checked={selectedQuant === model.quantization}
                  onChange={() => setSelectedQuant(model.quantization)}
                  className="sr-only"
                />
                <div
                  className={`h-4 w-4 shrink-0 rounded-full border-2 transition-colors ${
                    selectedQuant === model.quantization ? "border-purple-400 bg-purple-400" : "border-[var(--border)]"
                  }`}
                >
                  {selectedQuant === model.quantization && (
                    <div className="flex h-full items-center justify-center">
                      <div className="h-1.5 w-1.5 rounded-full bg-white" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{model.label}</div>
                  <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]/70">
                    <span className="flex items-center gap-1">
                      <Download size="0.75rem" />
                      {formatBytes(model.sizeBytes)}
                    </span>
                    <span className="flex items-center gap-1">
                      <HardDrive size="0.75rem" />~{formatBytes(model.ramBytes)} RAM
                    </span>
                  </div>
                </div>
                {model.quantization === "q8_0" && (
                  <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[0.625rem] font-medium text-purple-300">
                    Recommended
                  </span>
                )}
              </label>
            ))}
          </div>
        )}

        {/* Download progress */}
        {isDownloading && progress && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
              <span>Downloading model...</span>
              <span>
                {formatBytes(progress.downloaded)}
                {progress.total > 0 && ` / ${formatBytes(progress.total)}`}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-purple-400 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]/60">
              <span>{progressPercent}%</span>
              {progress.speed > 0 && <span>{formatSpeed(progress.speed)}</span>}
            </div>
          </div>
        )}

        {/* Error state */}
        {progress?.status === "error" && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
            {progress.error || "Download failed. Please try again."}
          </div>
        )}

        {/* Actions — only when not downloaded */}
        {!isDownloaded && (
          <div className="flex items-center gap-2">
            {!isDownloading ? (
              <>
                <button
                  onClick={handleSkip}
                  className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
                >
                  Skip for Now
                </button>
                <button
                  onClick={handleDownload}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-purple-500/15 px-4 py-2.5 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/25"
                >
                  <Zap size="0.875rem" />
                  Download Model
                </button>
              </>
            ) : (
              <button
                onClick={handleCancel}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
              >
                <X size="0.875rem" />
                Cancel Download
              </button>
            )}
          </div>
        )}

        {/* Features list — only when not yet downloaded */}
        {!isDownloaded && !isDownloading && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/50 p-3">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
              What the local model handles
            </span>
            <ul className="mt-2 flex flex-col gap-1 text-xs text-[var(--muted-foreground)]/80">
              <li>Tracker agents in roleplay mode (character state, world state, quests)</li>
              <li>Scene effects in game mode (backgrounds, music, SFX, ambient)</li>
              <li>Widget updates (health bars, inventory, counters)</li>
              <li>Character expression selection for sprites</li>
              <li>Weather and time-of-day changes</li>
              <li>NPC reputation tracking</li>
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
