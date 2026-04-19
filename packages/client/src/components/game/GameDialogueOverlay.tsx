// ──────────────────────────────────────────────
// Game: Dialogue Overlay (NPC conversation state)
// ──────────────────────────────────────────────
import { useState, type KeyboardEvent } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import { cn } from "../../lib/utils";
import { AnimatedText } from "./AnimatedText";

interface DialogueMessage {
  id: string;
  speaker: string;
  content: string;
  isNpc: boolean;
}

interface GameDialogueOverlayProps {
  npcName: string;
  npcEmoji: string;
  messages: DialogueMessage[];
  onSend: (message: string) => void;
  onConclude: () => void;
  isStreaming: boolean;
}

export function GameDialogueOverlay({
  npcName,
  npcEmoji,
  messages,
  onSend,
  onConclude,
  isStreaming,
}: GameDialogueOverlayProps) {
  const [text, setText] = useState("");

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="game-dialogue-enter absolute inset-0 z-30 flex flex-col bg-black/40 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between bg-sky-900/60 px-4 py-2">
        <div className="flex items-center gap-2">
          <MessageCircle size={16} className="text-sky-300" />
          <span className="text-sm font-medium text-sky-300">Dialogue</span>
          <span className="text-sm text-[var(--foreground)]">
            {npcEmoji} {npcName}
          </span>
        </div>
        <button
          onClick={onConclude}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <X size={14} />
          End Dialogue
        </button>
      </div>

      {/* Messages */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "max-w-[80%] rounded-lg px-4 py-2",
              msg.isNpc ? "self-start bg-sky-900/40" : "self-end bg-[var(--primary)]/20",
            )}
          >
            <div className="mb-0.5 text-xs font-semibold" style={{ color: msg.isNpc ? "#7dd3fc" : "#fbbf24" }}>
              {msg.speaker}
            </div>
            <AnimatedText html={msg.content} className="text-sm text-[var(--foreground)]" />
          </div>
        ))}
        {isStreaming && (
          <AnimatedText
            html={`${npcName} is speaking...`}
            className="self-start text-xs text-[var(--muted-foreground)] animate-pulse"
          />
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 border-t border-sky-800/50 bg-sky-900/30 px-4 py-3">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Say something to ${npcName}...`}
          className="flex-1 rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || isStreaming}
          className="rounded-lg bg-sky-500/20 p-2 text-sky-300 hover:bg-sky-500/30 disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
