// ──────────────────────────────────────────────
// Game: Travel/Rest View (camping, travel, downtime)
// ──────────────────────────────────────────────
import { Flame } from "lucide-react";
import { AnimatedText } from "./AnimatedText";

interface GameTravelViewProps {
  /** Ambient overlay for the travel/rest state. */
  children: React.ReactNode;
}

export function GameTravelView({ children }: GameTravelViewProps) {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Ambient overlay with warm tones */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-amber-900/10 via-transparent to-amber-950/20" />

      {/* Rest indicator */}
      <div className="flex items-center gap-2 border-b border-amber-800/30 bg-amber-900/10 px-4 py-2">
        <Flame size={14} className="game-campfire text-amber-400" />
        <AnimatedText html="The party rests. Time passes gently..." className="text-xs text-amber-300" />
      </div>

      {/* Content (narration + input) */}
      {children}
    </div>
  );
}
