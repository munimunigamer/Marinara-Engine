// ──────────────────────────────────────────────
// Game: Dice Roll Result Display
// ──────────────────────────────────────────────
import { useEffect, useState } from "react";
import type { DiceRollResult } from "@marinara-engine/shared";
import { X } from "lucide-react";

interface GameDiceResultProps {
  result: DiceRollResult;
  onDismiss: () => void;
}

export function GameDiceResult({ result, onDismiss }: GameDiceResultProps) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    setAnimate(false);
    // Trigger animation on next frame so the transition plays
    const raf = requestAnimationFrame(() => setAnimate(true));
    const timer = setTimeout(() => onDismiss(), 5000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
    // onDismiss is stable (useCallback with stable deps) — safe to exclude
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  return (
    <div
      className={`absolute bottom-24 left-1/2 z-40 -translate-x-1/2 transition-all duration-300 ${
        animate ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      }`}
    >
      <div className="flex items-center gap-3 rounded-xl bg-black/80 px-5 py-3 shadow-lg shadow-black/30 backdrop-blur-sm ring-1 ring-white/10">
        <span className="game-dice-animate text-2xl">🎲</span>
        <div>
          <div className="text-xs font-mono text-white/60">{result.notation}</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">
              [{result.rolls.join(", ")}]
              {result.modifier !== 0 && ` ${result.modifier > 0 ? "+" : ""}${result.modifier}`}
            </span>
            <span className="text-lg font-bold text-white">= {result.total}</span>
          </div>
        </div>
        <button onClick={onDismiss} className="ml-2 rounded p-1 text-white/40 hover:text-white">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
