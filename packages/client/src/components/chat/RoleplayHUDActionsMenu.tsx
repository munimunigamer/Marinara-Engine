import { AlertTriangle, MessageCircle, RefreshCw, Sparkles, Trash2, X } from "lucide-react";

interface ThoughtBubble {
  agentId: string;
  agentName: string;
  content: string;
  timestamp: number;
}

interface RoleplayHUDActionsMenuProps {
  isAgentProcessing: boolean;
  thoughtBubbles: ThoughtBubble[];
  clearThoughtBubbles: () => void;
  dismissThoughtBubble: (index: number) => void;
  showEcho: boolean;
  echoChamberOpen: boolean;
  toggleEchoChamber: () => void;
  echoMessageCount: number;
  clearGameState: () => void;
  onRetriggerTrackers?: () => void;
  onRetryFailedAgents?: () => void;
  failedAgentTypes?: string[];
  onClose: () => void;
}

export function RoleplayHUDActionsMenu({
  isAgentProcessing,
  thoughtBubbles,
  clearThoughtBubbles,
  dismissThoughtBubble,
  showEcho,
  echoChamberOpen,
  toggleEchoChamber,
  echoMessageCount,
  clearGameState,
  onRetriggerTrackers,
  onRetryFailedAgents,
  failedAgentTypes,
  onClose,
}: RoleplayHUDActionsMenuProps) {
  const uniqueAgentCount = new Set(thoughtBubbles.map((bubble) => bubble.agentId)).size;

  return (
    <>
      {isAgentProcessing && (
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
          <Sparkles size="0.75rem" className="text-purple-400 animate-pulse" />
          <span className="text-[0.625rem] text-purple-300/80">Agents thinking…</span>
        </div>
      )}
      {thoughtBubbles.length === 0 && !isAgentProcessing && (
        <div className="px-3 py-4 text-center text-[0.625rem] text-white/30">No agent activity yet</div>
      )}
      {thoughtBubbles.length > 0 && (
        <>
          <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
            <span className="text-[0.625rem] text-white/40">
              {uniqueAgentCount} agent{uniqueAgentCount !== 1 ? "s" : ""} triggered
            </span>
            <button
              onClick={clearThoughtBubbles}
              className="text-[0.625rem] text-white/30 hover:text-white/60 transition-colors"
            >
              Clear all
            </button>
          </div>
          <div className="flex flex-col gap-1 p-2">
            {thoughtBubbles.map((bubble, index) => (
              <div
                key={`${bubble.agentId}-${bubble.timestamp}`}
                className="relative rounded-lg bg-white/5 p-2 text-[0.625rem]"
              >
                <button
                  onClick={() => dismissThoughtBubble(index)}
                  className="absolute right-1.5 top-1.5 text-white/20 hover:text-white/60 transition-colors"
                >
                  <X size="0.625rem" />
                </button>
                <div className="pr-4">
                  <span className="font-semibold text-purple-300">{bubble.agentName}</span>
                  <p className="mt-0.5 whitespace-pre-wrap text-white/50 leading-relaxed">{bubble.content}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="border-t border-white/5 divide-y divide-white/5">
        {showEcho && (
          <button
            onClick={toggleEchoChamber}
            className="flex w-full items-center gap-2 px-3 py-2 text-[0.625rem] transition-colors hover:bg-white/5"
          >
            <MessageCircle size="0.75rem" className={echoChamberOpen ? "text-purple-400" : "text-purple-400/60"} />
            <span className={echoChamberOpen ? "text-purple-300 font-medium" : "text-white/60"}>
              Echo Chamber {echoChamberOpen ? "On" : "Off"}
            </span>
            {echoMessageCount > 0 && (
              <span className="ml-auto flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-purple-500/80 px-1 text-[0.5rem] font-bold text-white">
                {echoMessageCount}
              </span>
            )}
          </button>
        )}
        <button
          onClick={() => {
            clearGameState();
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-[0.625rem] text-white/60 transition-colors hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 size="0.75rem" className="text-purple-400/60" />
          <span>Clear Trackers</span>
        </button>
        {onRetriggerTrackers && (
          <button
            onClick={() => {
              onRetriggerTrackers();
              onClose();
            }}
            disabled={isAgentProcessing}
            className="flex w-full items-center gap-2 px-3 py-2 text-[0.625rem] font-medium text-purple-300 transition-colors hover:bg-purple-500/10 disabled:opacity-50"
          >
            <RefreshCw size="0.6875rem" className={isAgentProcessing ? "animate-spin" : ""} />
            {isAgentProcessing ? "Running…" : "Re-run Trackers"}
          </button>
        )}
        {onRetryFailedAgents && failedAgentTypes && failedAgentTypes.length > 0 && (
          <button
            onClick={() => {
              onRetryFailedAgents();
              onClose();
            }}
            disabled={isAgentProcessing}
            className="flex w-full items-center gap-2 px-3 py-2 text-[0.625rem] font-medium text-amber-300 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
          >
            <AlertTriangle size="0.6875rem" className={isAgentProcessing ? "animate-pulse" : ""} />
            {isAgentProcessing ? "Retrying…" : `Retry Failed Agents (${failedAgentTypes.length})`}
          </button>
        )}
      </div>
    </>
  );
}
