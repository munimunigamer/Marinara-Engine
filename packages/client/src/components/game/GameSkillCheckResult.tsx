// ──────────────────────────────────────────────
// Game: Skill Check Result Display
// ──────────────────────────────────────────────
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { SkillCheckResult } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";

interface GameSkillCheckResultProps {
  result: SkillCheckResult;
  onDismiss: () => void;
}

export function GameSkillCheckResult({ result, onDismiss }: GameSkillCheckResultProps) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    setAnimate(false);
    const raf = requestAnimationFrame(() => setAnimate(true));
    const timer = setTimeout(() => onDismiss(), 6000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const label = result.criticalSuccess
    ? "CRITICAL SUCCESS!"
    : result.criticalFailure
      ? "CRITICAL FAILURE!"
      : result.success
        ? "SUCCESS"
        : "FAILURE";

  const color = result.criticalSuccess
    ? "text-yellow-300"
    : result.criticalFailure
      ? "text-red-400"
      : result.success
        ? "text-emerald-400"
        : "text-red-300";

  return (
    <div
      className={cn(
        "absolute bottom-24 left-1/2 z-40 -translate-x-1/2 transition-all duration-300",
        animate ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
      )}
    >
      <div className="flex items-center gap-3 rounded-xl bg-black/80 px-5 py-3 shadow-lg shadow-black/30 backdrop-blur-sm ring-1 ring-white/10">
        <span className="game-dice-animate text-2xl">🎲</span>
        <div>
          <div className="text-xs font-mono text-white/60">
            {result.skill} Check (DC {result.dc})
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">
              [{result.rolls.join(", ")}]
              {result.modifier !== 0 && ` ${result.modifier > 0 ? "+" : ""}${result.modifier}`}
              {result.rollMode !== "normal" && ` (${result.rollMode})`}
            </span>
            <span className="text-lg font-bold text-white">= {result.total}</span>
          </div>
          <div className={cn("text-xs font-bold", color)}>{label}</div>
        </div>
        <button onClick={onDismiss} className="ml-2 rounded p-1 text-white/40 hover:text-white">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
