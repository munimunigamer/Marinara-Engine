import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import { type SpritePlacement, type SpriteSide, type WorldMap } from "@marinara-engine/shared";
import {
  FolderOpen,
  Globe,
  Image,
  Loader2,
  Map as MapIcon,
  MoreHorizontal,
  Move,
  PenLine,
  RefreshCw,
  ScrollText,
  Settings2,
  Swords,
  ChevronUp,
  ArrowRightLeft,
  FlipHorizontal2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useUIStore } from "../../stores/ui.store";
import { useChatStore } from "../../stores/chat.store";
import { useGameStateStore } from "../../stores/game-state.store";
import { useActiveLorebookEntries } from "../../hooks/use-lorebooks";
import { useSyncWorldGraphLorebooks, useWorldGraphMap, useWorldGraphObservation } from "../../hooks/use-world-graph";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { CyoaChoices } from "./CyoaChoices";
import { EndSceneBar } from "./SceneBanner";
import { ChatCommonOverlays } from "./ChatCommonOverlays";
import type {
  CharacterMap,
  MessageSelectionToggle,
  MessageWithSwipes,
  PeekPromptData,
  PersonaInfo,
} from "./chat-area.types";

type ChatData = ComponentProps<typeof ChatCommonOverlays>["chat"];

const RoleplayHUD = lazy(async () => {
  const module = await import("./RoleplayHUD");
  return { default: module.RoleplayHUD };
});

const WeatherEffects = lazy(async () => {
  const module = await import("./WeatherEffects");
  return { default: module.WeatherEffects };
});

const SpriteOverlay = lazy(async () => {
  const module = await import("./SpriteOverlay");
  return { default: module.SpriteOverlay };
});

const EchoChamberPanel = lazy(async () => {
  const module = await import("./EchoChamberPanel");
  return { default: module.EchoChamberPanel };
});

const EncounterModal = lazy(async () => {
  const module = await import("./EncounterModal");
  return { default: module.EncounterModal };
});

const SummaryPopover = lazy(async () => {
  const module = await import("./SummaryPopover");
  return { default: module.SummaryPopover };
});

const WorldInfoPanel = lazy(async () => {
  const module = await import("./ChatRoleplayPanels");
  return { default: module.WorldInfoPanel };
});

const AuthorNotesPanel = lazy(async () => {
  const module = await import("./ChatRoleplayPanels");
  return { default: module.AuthorNotesPanel };
});

function WeatherEffectsConnected() {
  const gs = useGameStateStore((s) => s.current);
  return (
    <Suspense fallback={null}>
      <WeatherEffects weather={gs?.weather ?? null} timeOfDay={gs?.time ?? null} />
    </Suspense>
  );
}

function CrossfadeBackground({ url, className }: { url: string | null; className?: string }) {
  const [bgA, setBgA] = useState<string | null>(url);
  const [bgB, setBgB] = useState<string | null>(null);
  const [aActive, setAActive] = useState(true);
  const activeSlot = useRef<"a" | "b">("a");

  useEffect(() => {
    const currentUrl = activeSlot.current === "a" ? bgA : bgB;
    if (url === currentUrl) return;

    if (url && url.startsWith("/api/backgrounds/")) {
      fetch(url, { method: "HEAD" })
        .then((res) => {
          if (res.ok) {
            applyUrl(url);
          } else {
            console.warn(`[Background] "${url}" not found — clearing`);
            useUIStore.getState().setChatBackground(null);
          }
        })
        .catch(() => {
          applyUrl(url);
        });
      return;
    }

    applyUrl(url);

    function applyUrl(nextUrl: string | null) {
      if (activeSlot.current === "a") {
        setBgB(nextUrl);
        setAActive(false);
        activeSlot.current = "b";
      } else {
        setBgA(nextUrl);
        setAActive(true);
        activeSlot.current = "a";
      }
    }
  }, [bgA, bgB, url]);

  return (
    <>
      <div
        className={cn(
          "mari-background absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-700 ease-in-out",
          className,
        )}
        style={{ backgroundImage: bgA ? `url(${bgA})` : "none", opacity: aActive ? 1 : 0 }}
      />
      <div
        className={cn(
          "mari-background absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-700 ease-in-out",
          className,
        )}
        style={{ backgroundImage: bgB ? `url(${bgB})` : "none", opacity: aActive ? 0 : 1 }}
      />
    </>
  );
}

function StreamingIndicator({
  activeChatId,
  chatCharIds,
  characterMap,
  personaInfo,
  chatMode,
  groupChatMode,
}: {
  activeChatId: string;
  chatCharIds: string[];
  characterMap: CharacterMap;
  personaInfo?: PersonaInfo;
  chatMode: string;
  groupChatMode?: string;
}) {
  const streamBuffer = useChatStore((s) => s.streamBuffer);
  const streamingCharacterId = useChatStore((s) => s.streamingCharacterId);

  return (
    <div className="animate-message-in">
      <ChatMessage
        message={{
          id: "__streaming__",
          chatId: activeChatId,
          role: "assistant",
          characterId: streamingCharacterId ?? chatCharIds[0] ?? null,
          content: streamBuffer || "",
          activeSwipeIndex: 0,
          extra: { displayText: null, isGenerated: true, tokenCount: 0, generationInfo: null },
          createdAt: new Date().toISOString(),
        }}
        isStreaming
        characterMap={characterMap}
        personaInfo={personaInfo}
        chatMode={chatMode}
        groupChatMode={groupChatMode}
        chatCharacterIds={chatCharIds}
      />
    </div>
  );
}

function RegeneratingMessageContent({
  msg,
  ...rest
}: {
  msg: MessageWithSwipes;
} & Omit<ComponentProps<typeof ChatMessage>, "message" | "isStreaming">) {
  const streamBuffer = useChatStore((s) => s.streamBuffer);
  // Strip old-swipe attachments so a previous illustration doesn't linger
  // while the new swipe's text is streaming in.
  const parsedExtra = typeof msg.extra === "string" ? JSON.parse(msg.extra) : (msg.extra ?? {});
  const cleanExtra = { ...parsedExtra, attachments: null };
  return <ChatMessage message={{ ...msg, extra: cleanExtra, content: streamBuffer || "" }} isStreaming {...rest} />;
}

function RpToolbarButton({
  icon,
  title,
  onClick,
  size,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
  size?: "sm";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center rounded-full border bg-foreground/5 text-foreground/60 backdrop-blur-md transition-all hover:bg-foreground/10 hover:text-foreground",
        size === "sm" ? "p-1" : "p-1.5",
        "border-foreground/10",
      )}
      title={title}
    >
      {icon}
    </button>
  );
}

function ToolbarMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const compact = useUIStore((s) => s.centerCompact);
  const btnRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <>
      <div className={cn("items-center gap-1.5 max-md:hidden", compact ? "hidden" : "flex")}>{children}</div>
      <div className={cn("relative shrink-0", compact ? "block" : "block md:hidden")} ref={btnRef}>
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            "flex w-9 items-center justify-center rounded-xl border bg-black/40 p-1.5 text-foreground/60 backdrop-blur-md transition-all hover:bg-black/60 hover:text-foreground",
            "border-foreground/10",
            open && "bg-black/60 border-foreground/20 text-foreground",
          )}
          title="More options"
        >
          <MoreHorizontal size="0.9375rem" />
        </button>
        {open &&
          createPortal(
            <div
              ref={popRef}
              className="fixed z-[9999] flex w-9 flex-col items-center gap-0.5 rounded-xl border border-foreground/10 bg-black/80 p-1 shadow-xl backdrop-blur-xl animate-message-in"
              style={{ top: pos.top, right: pos.right }}
              onClick={() => setOpen(false)}
            >
              {children}
            </div>,
            document.body,
          )}
      </div>
    </>
  );
}

function SummaryButton({
  chatId,
  summary,
  summaryContextSize,
  onContextSizeChange,
}: {
  chatId: string | null;
  summary: string | null;
  summaryContextSize: number;
  onContextSizeChange: (size: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const compact = useUIStore((s) => s.centerCompact);

  if (!chatId) return null;

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center justify-center rounded-full border backdrop-blur-md transition-all",
          compact ? "p-1" : "p-1.5",
          open
            ? "bg-foreground/15 border-foreground/20 text-foreground/90"
            : summary
              ? "bg-foreground/10 border-foreground/25 text-foreground/80 hover:bg-foreground/15 hover:text-foreground"
              : "bg-foreground/5 border-foreground/10 text-foreground/60 hover:bg-foreground/10 hover:text-foreground",
        )}
        title="Chat Summary"
      >
        <ScrollText size="0.875rem" />
      </button>
      {open && (
        <Suspense fallback={null}>
          <SummaryPopover
            chatId={chatId}
            summary={summary}
            contextSize={summaryContextSize}
            onContextSizeChange={onContextSizeChange}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

function WorldInfoButton({ chatId }: { chatId: string | null }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useActiveLorebookEntries(chatId, true);
  const ref = useRef<HTMLDivElement>(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const compact = useUIStore((s) => s.centerCompact);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (!chatId) return null;

  const entries = data?.entries ?? [];
  const hasEntries = entries.length > 0;

  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center justify-center rounded-full border backdrop-blur-md transition-all",
          compact ? "p-1" : "p-1.5",
          open
            ? "bg-foreground/15 border-foreground/20 text-foreground/90"
            : hasEntries && !isLoading
              ? "bg-foreground/10 border-foreground/25 text-foreground/80 hover:bg-foreground/15 hover:text-foreground"
              : "bg-foreground/5 border-foreground/10 text-foreground/60 hover:bg-foreground/10 hover:text-foreground",
        )}
        title="Active World Info"
      >
        <Globe size="0.875rem" />
      </button>
      {open &&
        (isMobile ? (
          createPortal(
            <div
              className="fixed inset-0 z-[9999] flex items-center justify-center p-4 max-md:pt-[max(1rem,env(safe-area-inset-top))]"
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
              <div
                className="relative max-h-[calc(100dvh-4rem)] w-full max-w-sm overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-2xl shadow-black/40 animate-message-in"
                onClick={(e) => e.stopPropagation()}
              >
                <Suspense
                  fallback={
                    <div className="flex items-center gap-2 py-4 text-xs text-[var(--muted-foreground)]">
                      <Loader2 size="0.75rem" className="animate-spin" />
                      Loading world info...
                    </div>
                  }
                >
                  <WorldInfoPanel chatId={chatId} isMobile={isMobile} onClose={() => setOpen(false)} />
                </Suspense>
              </div>
            </div>,
            document.body,
          )
        ) : (
          <div className="absolute right-0 top-full z-50 mt-2 max-h-[60vh] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-2xl shadow-black/40 animate-message-in">
            <Suspense
              fallback={
                <div className="flex items-center gap-2 py-4 text-xs text-[var(--muted-foreground)]">
                  <Loader2 size="0.75rem" className="animate-spin" />
                  Loading world info...
                </div>
              }
            >
              <WorldInfoPanel chatId={chatId} isMobile={isMobile} onClose={() => setOpen(false)} />
            </Suspense>
          </div>
        ))}
    </div>
  );
}

function AuthorNotesButton({ chatId, chatMeta }: { chatId: string | null; chatMeta: Record<string, any> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const compact = useUIStore((s) => s.centerCompact);

  useEffect(() => {
    if (!open || isMobile) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, isMobile]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (!chatId) return null;

  const hasNotes = !!String(chatMeta.authorNotes ?? "").trim();

  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center justify-center rounded-full border backdrop-blur-md transition-all",
          compact ? "p-1" : "p-1.5",
          open
            ? "bg-foreground/15 border-foreground/20 text-foreground/90"
            : hasNotes
              ? "bg-foreground/10 border-foreground/25 text-foreground/80 hover:bg-foreground/15 hover:text-foreground"
              : "bg-foreground/5 border-foreground/10 text-foreground/60 hover:bg-foreground/10 hover:text-foreground",
        )}
        title="Author's Notes"
      >
        <PenLine size="0.875rem" />
      </button>
      {open &&
        (isMobile ? (
          createPortal(
            <div
              className="fixed inset-0 z-[9999] flex items-center justify-center p-4 max-md:pt-[max(1rem,env(safe-area-inset-top))]"
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
              <div
                className="relative max-h-[calc(100dvh-4rem)] w-full max-w-sm overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-2xl shadow-black/40 animate-message-in"
                onClick={(e) => e.stopPropagation()}
              >
                <Suspense
                  fallback={
                    <div className="flex items-center gap-2 py-4 text-xs text-[var(--muted-foreground)]">
                      <Loader2 size="0.75rem" className="animate-spin" />
                      Loading author's notes...
                    </div>
                  }
                >
                  <AuthorNotesPanel
                    chatId={chatId}
                    chatMeta={chatMeta}
                    isMobile={isMobile}
                    onClose={() => setOpen(false)}
                  />
                </Suspense>
              </div>
            </div>,
            document.body,
          )
        ) : (
          <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-2xl shadow-black/40 animate-message-in">
            <Suspense
              fallback={
                <div className="flex items-center gap-2 py-4 text-xs text-[var(--muted-foreground)]">
                  <Loader2 size="0.75rem" className="animate-spin" />
                  Loading author's notes...
                </div>
              }
            >
              <AuthorNotesPanel
                chatId={chatId}
                chatMeta={chatMeta}
                isMobile={isMobile}
                onClose={() => setOpen(false)}
              />
            </Suspense>
          </div>
        ))}
    </div>
  );
}

function FloatingWorldGraphWidget({ chatId }: { chatId: string }) {
  const { data: map, isLoading } = useWorldGraphMap(chatId);
  const { data: observation } = useWorldGraphObservation(chatId);
  const syncLorebooks = useSyncWorldGraphLorebooks(chatId);
  const points = useMemo(() => getWorldMapPoints(map), [map]);
  const edges = useMemo(() => getWorldMapEdges(map, points), [map, points]);
  const currentLocation = observation?.currentLocation?.attributes.name ?? "Unknown";
  const exits = observation?.exits ?? [];
  const hasLocations = points.length > 0;
  const isSyncing = syncLorebooks.isPending;

  return (
    <aside
      className="pointer-events-none absolute right-4 top-16 z-30 flex h-48 w-48 flex-col overflow-hidden rounded-lg border border-white/15 bg-black/45 text-white shadow-xl shadow-black/30 backdrop-blur-md max-md:right-2 max-md:top-14 max-md:h-32 max-md:w-32"
      aria-label="World Graph minimap"
    >
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-white/10 px-2 max-md:h-6">
        <div className="flex min-w-0 items-center gap-1.5">
          <MapIcon size="0.8125rem" className="shrink-0 text-lime-300" />
          <span className="truncate text-[0.625rem] font-semibold uppercase tracking-wide text-white/70">World</span>
        </div>
        <button
          type="button"
          className="pointer-events-auto inline-flex h-5 w-5 items-center justify-center rounded border border-white/10 bg-white/5 text-white/45 transition hover:border-lime-300/50 hover:text-lime-200 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            const toastId = toast.loading("Syncing lorebooks to world graph...");
            syncLorebooks.mutate(undefined, {
              onSuccess: (data) => {
                toast.success(`World graph synced (${data.stats.operationCount} operations)`, { id: toastId });
              },
              onError: (error) => {
                toast.error(error instanceof Error ? error.message : "World graph sync failed", {
                  id: toastId,
                  duration: 15000,
                });
              },
            });
          }}
          disabled={isSyncing}
          title={syncLorebooks.error instanceof Error ? syncLorebooks.error.message : "Sync lorebooks"}
          aria-label="Sync lorebooks to world graph"
        >
          {isLoading || isSyncing ? (
            <Loader2 size="0.6875rem" className="animate-spin" />
          ) : (
            <RefreshCw size="0.6875rem" />
          )}
        </button>
      </div>

      <div className="relative min-h-0 flex-1 border-b border-white/10 bg-emerald-950/20">
        {hasLocations ? (
          <svg viewBox="0 0 100 100" className="h-full w-full">
            <defs>
              <radialGradient id="world-graph-current" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#bef264" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#65a30d" stopOpacity="0.15" />
              </radialGradient>
            </defs>
            {edges.map((edge) => (
              <line
                key={edge.key}
                x1={edge.source.x}
                y1={edge.source.y}
                x2={edge.target.x}
                y2={edge.target.y}
                stroke={edge.kind === "in" ? "rgba(190,242,100,0.18)" : "rgba(255,255,255,0.24)"}
                strokeWidth={edge.kind === "in" ? "1" : "1.5"}
                strokeLinecap="round"
                strokeDasharray={edge.kind === "in" ? "2 2" : undefined}
              />
            ))}
            {points.map((point) => (
              <g key={point.key}>
                {point.current && <circle cx={point.x} cy={point.y} r="11" fill="url(#world-graph-current)" />}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={point.current ? 4.5 : 3.25}
                  fill={point.current ? "#bef264" : "#d1d5db"}
                  stroke="rgba(0,0,0,0.55)"
                  strokeWidth="1"
                />
              </g>
            ))}
          </svg>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-white/35">
            <MapIcon size="1.25rem" />
            <span className="text-[0.625rem]">No map yet</span>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-1 px-2 py-1.5 max-md:py-1">
        <div className="truncate text-[0.6875rem] font-medium text-lime-200">{currentLocation}</div>
        <div className="truncate text-[0.5625rem] text-white/45 max-md:hidden">
          {exits.length > 0 ? `Exits: ${exits.map((exit) => exit.attributes.name).join(", ")}` : "No exits visible"}
        </div>
      </div>
    </aside>
  );
}

function getWorldMapPoints(map?: WorldMap) {
  const locations = (map?.nodes ?? []).filter((node) => node.attributes.kind === "location");
  if (locations.length === 0) return [];

  const hasCoordinates = locations.some(
    (node) => typeof node.attributes.x === "number" || typeof node.attributes.y === "number",
  );
  const raw = locations.map((node, index) => {
    const angle = (index / Math.max(1, locations.length)) * Math.PI * 2 - Math.PI / 2;
    return {
      key: node.key,
      name: node.attributes.name,
      current: node.key === map?.currentLocationKey,
      rawX: hasCoordinates && typeof node.attributes.x === "number" ? node.attributes.x : Math.cos(angle) * 40,
      rawY: hasCoordinates && typeof node.attributes.y === "number" ? node.attributes.y : Math.sin(angle) * 40,
    };
  });

  const xs = raw.map((point) => point.rawX);
  const ys = raw.map((point) => point.rawY);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  return raw.map((point) => ({
    ...point,
    x: 14 + ((point.rawX - minX) / spanX) * 72,
    y: 14 + ((point.rawY - minY) / spanY) * 72,
  }));
}

function getWorldMapEdges(map: WorldMap | undefined, points: ReturnType<typeof getWorldMapPoints>) {
  const pointByKey = new Map(points.map((point) => [point.key, point]));
  return (map?.edges ?? [])
    .filter(
      (edge) =>
        (edge.attributes.kind === "connects_to" || edge.attributes.kind === "in") &&
        pointByKey.has(edge.source) &&
        pointByKey.has(edge.target),
    )
    .map((edge) => ({
      key: edge.key,
      kind: edge.attributes.kind,
      source: pointByKey.get(edge.source)!,
      target: pointByKey.get(edge.target)!,
    }));
}

type RoleplaySurfaceProps = {
  activeChatId: string;
  chat: ChatData | null | undefined;
  allChats: Array<{ id: string; name: string }> | undefined;
  chatMeta: Record<string, any>;
  chatMode: string;
  isRoleplay: boolean;
  centerCompact: boolean;
  chatBackground: string | null;
  weatherEffects: boolean;
  expressionAgentEnabled: boolean;
  combatAgentEnabled: boolean;
  encounterActive: boolean;
  spritePosition: SpriteSide;
  spriteCharacterIds: string[];
  spriteExpressions: Record<string, string>;
  spritePlacements: Record<string, SpritePlacement>;
  hasCustomSpritePlacements: boolean;
  spriteArrangeMode: boolean;
  enabledAgentTypes: Set<string>;
  chatCharIds: string[];
  characterMap: CharacterMap;
  characterNames: string[];
  personaInfo?: PersonaInfo;
  messages: MessageWithSwipes[] | undefined;
  msgPayload: Array<{ role: string; characterId: string | null; content: string }>;
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isStreaming: boolean;
  regenerateMessageId: string | null;
  shouldAnimateMessages: boolean;
  summaryContextSize: number;
  totalMessageCount: number;
  lastAssistantMessageId: string | null;
  settingsOpen: boolean;
  filesOpen: boolean;
  galleryOpen: boolean;
  wizardOpen: boolean;
  peekPromptData: PeekPromptData | null;
  deleteDialogMessageId: string | null;
  multiSelectMode: boolean;
  selectedMessageIds: Set<string>;
  groupChatMode?: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onLoadMore: () => void;
  onDelete: (messageId: string) => void;
  onRegenerate: (messageId: string) => void;
  onEdit: (messageId: string, content: string) => void;
  onSetActiveSwipe: (messageId: string, index: number) => void;
  onToggleConversationStart: (messageId: string, current: boolean) => void;
  onPeekPrompt: () => void;
  onBranch: (messageId: string) => void;
  onToggleSelectMessage: (toggle: MessageSelectionToggle) => void;
  onSummaryContextSizeChange: (size: number) => void;
  onRerunTrackers: () => void;
  onRetryFailedAgents?: () => void;
  onStartEncounter: () => void;
  onConcludeScene: () => void;
  onAbandonScene: () => void;
  onOpenSettings: () => void;
  onOpenFiles: () => void;
  onOpenGallery: () => void;
  onCloseSettings: () => void;
  onCloseFiles: () => void;
  onCloseGallery: () => void;
  onIllustrate?: () => void;
  onWizardFinish: () => void;
  onClosePeekPrompt: () => void;
  onResetSpritePlacements: () => void;
  onSpriteSideChange: (side: SpriteSide) => void;
  onToggleSpriteArrange: () => void;
  onToggleSpritePosition: () => void;
  onExpressionChange: (characterId: string, expression: string) => void;
  onSpritePlacementChange: (characterId: string, placement: SpritePlacement) => void;
  onDeleteConfirm: () => void;
  onDeleteMore: () => void;
  onCloseDeleteDialog: () => void;
  onBulkDelete: () => void;
  onCancelMultiSelect: () => void;
  onUnselectAllMessages: () => void;
  onSelectAllAboveSelection: () => void;
  onSelectAllBelowSelection: () => void;
  isGrouped: (index: number) => boolean;
};

export function ChatRoleplaySurface({
  activeChatId,
  chat,
  allChats,
  chatMeta,
  chatMode,
  isRoleplay,
  centerCompact,
  chatBackground,
  weatherEffects,
  expressionAgentEnabled,
  combatAgentEnabled,
  encounterActive,
  spritePosition,
  spriteCharacterIds,
  spriteExpressions,
  spritePlacements,
  hasCustomSpritePlacements,
  spriteArrangeMode,
  enabledAgentTypes,
  chatCharIds,
  characterMap,
  characterNames,
  personaInfo,
  messages,
  msgPayload,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  isStreaming,
  regenerateMessageId,
  shouldAnimateMessages,
  summaryContextSize,
  totalMessageCount,
  lastAssistantMessageId,
  settingsOpen,
  filesOpen,
  galleryOpen,
  wizardOpen,
  peekPromptData,
  deleteDialogMessageId,
  multiSelectMode,
  selectedMessageIds,
  groupChatMode,
  scrollRef,
  messagesEndRef,
  onLoadMore,
  onDelete,
  onRegenerate,
  onEdit,
  onSetActiveSwipe,
  onToggleConversationStart,
  onPeekPrompt,
  onBranch,
  onToggleSelectMessage,
  onSummaryContextSizeChange,
  onRerunTrackers,
  onRetryFailedAgents,
  onStartEncounter,
  onConcludeScene,
  onAbandonScene,
  onOpenSettings,
  onOpenFiles,
  onOpenGallery,
  onCloseSettings,
  onCloseFiles,
  onCloseGallery,
  onIllustrate,
  onWizardFinish,
  onClosePeekPrompt,
  onResetSpritePlacements,
  onSpriteSideChange,
  onToggleSpriteArrange,
  onToggleSpritePosition,
  onExpressionChange,
  onSpritePlacementChange,
  onDeleteConfirm,
  onDeleteMore,
  onCloseDeleteDialog,
  onBulkDelete,
  onCancelMultiSelect,
  onUnselectAllMessages,
  onSelectAllAboveSelection,
  onSelectAllBelowSelection,
  isGrouped,
}: RoleplaySurfaceProps) {
  const linkedChatName = chat?.connectedChatId ? allChats?.find((c) => c.id === chat.connectedChatId)?.name : undefined;
  const showWorldGraphHud = !!(chat && chatMeta.enableAgents && enabledAgentTypes.has("world-graph"));

  return (
    <div data-component="ChatArea.Roleplay" className="flex flex-1 overflow-hidden">
      <div className="rpg-chat-area mari-chat-area relative flex flex-1 flex-col overflow-hidden">
        <CrossfadeBackground url={chatBackground} />
        <div className="rpg-overlay absolute inset-0" />
        <div className="rpg-vignette pointer-events-none absolute inset-0" />
        {weatherEffects && <WeatherEffectsConnected />}
        {showWorldGraphHud && <FloatingWorldGraphWidget chatId={chat.id} />}
        {expressionAgentEnabled && spriteCharacterIds.length > 0 && (
          <Suspense fallback={null}>
            <SpriteOverlay
              characterIds={spriteCharacterIds}
              messages={msgPayload}
              side={spritePosition}
              spriteExpressions={spriteExpressions}
              spritePlacements={spritePlacements}
              editing={spriteArrangeMode}
              onExpressionChange={onExpressionChange}
              onPlacementChange={onSpritePlacementChange}
            />
          </Suspense>
        )}

        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col overflow-hidden">
            <>
              <div
                className={cn(
                  "pointer-events-none relative z-40 items-center px-4 py-2 max-md:hidden",
                  centerCompact ? "hidden" : "flex",
                )}
              >
                {chat && chatMeta.enableAgents && (
                  <div className="pointer-events-auto flex-1 overflow-x-auto">
                    <Suspense fallback={null}>
                      <RoleplayHUD
                        chatId={chat.id}
                        characterCount={chatCharIds.length}
                        layout="top"
                        onRetriggerTrackers={onRerunTrackers}
                        onRetryFailedAgents={onRetryFailedAgents}
                        enabledAgentTypes={enabledAgentTypes}
                        manualTrackers={!!chatMeta.manualTrackers}
                      />
                    </Suspense>
                  </div>
                )}
                <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-1.5">
                  <ToolbarMenu>
                    <SummaryButton
                      chatId={chat?.id ?? null}
                      summary={chatMeta.summary ?? null}
                      summaryContextSize={summaryContextSize}
                      onContextSizeChange={onSummaryContextSizeChange}
                    />
                    <WorldInfoButton chatId={chat?.id ?? null} />
                    <AuthorNotesButton chatId={chat?.id ?? null} chatMeta={chatMeta} />
                    <RpToolbarButton
                      icon={<FolderOpen size="0.875rem" />}
                      title="Manage Chat Files"
                      onClick={onOpenFiles}
                    />
                    {expressionAgentEnabled && spriteCharacterIds.length > 0 && (
                      <RpToolbarButton
                        icon={<Move size="0.875rem" />}
                        title={spriteArrangeMode ? "Finish arranging sprites" : "Arrange sprites"}
                        onClick={onToggleSpriteArrange}
                      />
                    )}
                    {expressionAgentEnabled && spriteCharacterIds.length > 0 && (
                      <RpToolbarButton
                        icon={<FlipHorizontal2 size="0.875rem" />}
                        title={
                          hasCustomSpritePlacements
                            ? `Mirror sprites to the ${spritePosition === "left" ? "right" : "left"}`
                            : `Sprite default side: ${spritePosition}`
                        }
                        onClick={onToggleSpritePosition}
                      />
                    )}
                    <RpToolbarButton icon={<Image size="0.875rem" />} title="Gallery" onClick={onOpenGallery} />
                    {chat?.connectedChatId && (
                      <RpToolbarButton
                        icon={<ArrowRightLeft size="0.875rem" />}
                        title={linkedChatName ? `Switch to ${linkedChatName}` : "Connected chat"}
                        onClick={() => useChatStore.getState().setActiveChatId(chat.connectedChatId!)}
                      />
                    )}
                    <RpToolbarButton
                      icon={<Settings2 size="0.875rem" />}
                      title="Chat Settings"
                      onClick={onOpenSettings}
                    />
                  </ToolbarMenu>
                </div>
              </div>
              <div
                className={cn(
                  "pointer-events-auto relative z-40 w-full flex-col",
                  centerCompact ? "flex" : "flex md:hidden",
                )}
              >
                {chat && chatMeta.enableAgents && (
                  <div className="flex w-full items-center justify-between px-2 pb-1 pt-2">
                    <Suspense fallback={null}>
                      <RoleplayHUD
                        chatId={chat.id}
                        characterCount={chatCharIds.length}
                        layout="top"
                        onRetriggerTrackers={onRerunTrackers}
                        onRetryFailedAgents={onRetryFailedAgents}
                        enabledAgentTypes={enabledAgentTypes}
                        manualTrackers={!!chatMeta.manualTrackers}
                        mobileCompact
                      />
                    </Suspense>
                    <ToolbarMenu>
                      <SummaryButton
                        chatId={chat?.id ?? null}
                        summary={chatMeta.summary ?? null}
                        summaryContextSize={summaryContextSize}
                        onContextSizeChange={onSummaryContextSizeChange}
                      />
                      <WorldInfoButton chatId={chat?.id ?? null} />
                      <AuthorNotesButton chatId={chat?.id ?? null} chatMeta={chatMeta} />
                      <RpToolbarButton
                        icon={<FolderOpen size="0.875rem" />}
                        title="Manage Chat Files"
                        onClick={onOpenFiles}
                      />
                      {expressionAgentEnabled && spriteCharacterIds.length > 0 && (
                        <RpToolbarButton
                          icon={<Move size="0.875rem" />}
                          title={spriteArrangeMode ? "Finish arranging sprites" : "Arrange sprites"}
                          onClick={onToggleSpriteArrange}
                        />
                      )}
                      {expressionAgentEnabled && spriteCharacterIds.length > 0 && (
                        <RpToolbarButton
                          icon={<FlipHorizontal2 size="0.875rem" />}
                          title={
                            hasCustomSpritePlacements
                              ? `Mirror sprites to the ${spritePosition === "left" ? "right" : "left"}`
                              : `Sprite default side: ${spritePosition}`
                          }
                          onClick={onToggleSpritePosition}
                        />
                      )}
                      <RpToolbarButton icon={<Image size="0.875rem" />} title="Gallery" onClick={onOpenGallery} />
                      {chat?.connectedChatId && (
                        <RpToolbarButton
                          icon={<ArrowRightLeft size="0.875rem" />}
                          title={linkedChatName ? `Switch to ${linkedChatName}` : "Connected chat"}
                          onClick={() => useChatStore.getState().setActiveChatId(chat.connectedChatId!)}
                        />
                      )}
                      <RpToolbarButton
                        icon={<Settings2 size="0.875rem" />}
                        title="Chat Settings"
                        onClick={onOpenSettings}
                      />
                    </ToolbarMenu>
                  </div>
                )}
                {chat && !chatMeta.enableAgents && (
                  <div className="flex w-full items-center justify-end gap-1.5 px-2 pb-1 pt-2">
                    <ToolbarMenu>
                      <SummaryButton
                        chatId={chat?.id ?? null}
                        summary={chatMeta.summary ?? null}
                        summaryContextSize={summaryContextSize}
                        onContextSizeChange={onSummaryContextSizeChange}
                      />
                      <WorldInfoButton chatId={chat?.id ?? null} />
                      <AuthorNotesButton chatId={chat?.id ?? null} chatMeta={chatMeta} />
                      <RpToolbarButton
                        icon={<FolderOpen size="0.875rem" />}
                        title="Manage Chat Files"
                        onClick={onOpenFiles}
                      />
                      <RpToolbarButton icon={<Image size="0.875rem" />} title="Gallery" onClick={onOpenGallery} />
                      {chat?.connectedChatId && (
                        <RpToolbarButton
                          icon={<ArrowRightLeft size="0.875rem" />}
                          title={linkedChatName ? `Switch to ${linkedChatName}` : "Connected chat"}
                          onClick={() => useChatStore.getState().setActiveChatId(chat.connectedChatId!)}
                        />
                      )}
                      <RpToolbarButton
                        icon={<Settings2 size="0.875rem" />}
                        title="Chat Settings"
                        onClick={onOpenSettings}
                      />
                    </ToolbarMenu>
                  </div>
                )}
              </div>
            </>

            {encounterActive && (
              <Suspense fallback={null}>
                <EncounterModal />
              </Suspense>
            )}

            <div className="relative z-10 flex-1 overflow-hidden">
              <div
                ref={scrollRef}
                data-chat-scroll
                className={cn(
                  "rpg-chat-messages-mobile mari-messages-scroll relative h-full overflow-y-auto overflow-x-hidden pb-1 pt-4",
                  centerCompact ? "px-3" : "px-3 md:px-[15%]",
                )}
              >
                {hasNextPage && (
                  <div className="mb-3 flex justify-center">
                    <button
                      onClick={onLoadMore}
                      disabled={isFetchingNextPage}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-black/40 px-3 py-1.5 text-xs font-medium text-foreground/70 backdrop-blur-sm transition-all hover:bg-foreground/10 hover:text-foreground/90 disabled:opacity-50"
                    >
                      {isFetchingNextPage ? (
                        <Loader2 size="0.75rem" className="animate-spin" />
                      ) : (
                        <ChevronUp size="0.75rem" />
                      )}
                      Load More
                    </button>
                  </div>
                )}

                {isLoading && (
                  <div className="flex flex-col items-center gap-3 py-12">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                  </div>
                )}

                {messages?.map((msg, i) => {
                  const isRegenerating = isStreaming && regenerateMessageId === msg.id;
                  return (
                    <div
                      key={msg.id}
                      className={shouldAnimateMessages ? "animate-message-in" : undefined}
                      style={
                        shouldAnimateMessages
                          ? { animationDelay: `${Math.min(i * 30, 200)}ms`, animationFillMode: "backwards" }
                          : undefined
                      }
                    >
                      {isRegenerating ? (
                        <RegeneratingMessageContent
                          msg={msg}
                          onDelete={onDelete}
                          onRegenerate={onRegenerate}
                          onEdit={onEdit}
                          onSetActiveSwipe={onSetActiveSwipe}
                          onToggleConversationStart={onToggleConversationStart}
                          onPeekPrompt={onPeekPrompt}
                          onBranch={onBranch}
                          isLastAssistantMessage={msg.id === lastAssistantMessageId}
                          characterMap={characterMap}
                          personaInfo={personaInfo}
                          chatMode={chatMode}
                          messageDepth={messages.length - 1 - i}
                          messageIndex={totalMessageCount - messages.length + i + 1}
                          messageOrderIndex={totalMessageCount - messages.length + i}
                          isGrouped={isGrouped(i)}
                          groupChatMode={groupChatMode}
                          chatCharacterIds={chatCharIds}
                          multiSelectMode={multiSelectMode}
                          isSelected={selectedMessageIds.has(msg.id)}
                          onToggleSelect={onToggleSelectMessage}
                        />
                      ) : (
                        <ChatMessage
                          message={msg}
                          isStreaming={false}
                          onDelete={onDelete}
                          onRegenerate={onRegenerate}
                          onEdit={onEdit}
                          onSetActiveSwipe={onSetActiveSwipe}
                          onToggleConversationStart={onToggleConversationStart}
                          onPeekPrompt={onPeekPrompt}
                          onBranch={onBranch}
                          isLastAssistantMessage={msg.id === lastAssistantMessageId}
                          characterMap={characterMap}
                          personaInfo={personaInfo}
                          chatMode={chatMode}
                          messageDepth={messages.length - 1 - i}
                          messageIndex={totalMessageCount - messages.length + i + 1}
                          messageOrderIndex={totalMessageCount - messages.length + i}
                          isGrouped={isGrouped(i)}
                          groupChatMode={groupChatMode}
                          chatCharacterIds={chatCharIds}
                          multiSelectMode={multiSelectMode}
                          isSelected={selectedMessageIds.has(msg.id)}
                          onToggleSelect={onToggleSelectMessage}
                        />
                      )}
                    </div>
                  );
                })}

                {!isStreaming && <CyoaChoices messages={messages} />}

                {isStreaming && !regenerateMessageId && (
                  <StreamingIndicator
                    activeChatId={activeChatId}
                    chatCharIds={chatCharIds}
                    characterMap={characterMap}
                    personaInfo={personaInfo}
                    chatMode={chatMode}
                    groupChatMode={groupChatMode}
                  />
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="relative z-20">
              <div className={cn("relative", centerCompact ? "px-3" : "px-3 md:px-[12%]")}>
                {chatMeta.sceneStatus === "active" && (
                  <EndSceneBar
                    sceneChatId={activeChatId}
                    originChatId={chatMeta.sceneOriginChatId}
                    onConclude={onConcludeScene}
                    onAbandon={onAbandonScene}
                  />
                )}
                {combatAgentEnabled && (
                  <div className="flex justify-center py-1">
                    <button
                      onClick={onStartEncounter}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs text-foreground/50 transition-all hover:bg-foreground/10 hover:text-orange-300"
                      title="Start Combat Encounter"
                    >
                      <Swords size="0.875rem" />
                      <span>Encounter</span>
                    </button>
                  </div>
                )}
                <ChatInput
                  mode={isRoleplay ? "roleplay" : "conversation"}
                  characterNames={characterNames}
                  groupResponseOrder={
                    chatCharIds.length > 1 && groupChatMode === "individual"
                      ? (chatMeta.groupResponseOrder ?? "sequential")
                      : undefined
                  }
                  chatCharacters={
                    chatCharIds.length > 1
                      ? chatCharIds.map((id) => {
                          const info = characterMap.get(id);
                          return { id, name: info?.name ?? "Unknown", avatarUrl: info?.avatarUrl ?? null };
                        })
                      : undefined
                  }
                />
              </div>
            </div>
          </div>
        </div>

        {/* Always mount so stagger timer runs even when panel is hidden */}
        <Suspense fallback={null}>
          <EchoChamberPanel />
        </Suspense>
      </div>

      <ChatCommonOverlays
        chat={chat}
        activeChatId={activeChatId}
        settingsOpen={settingsOpen}
        filesOpen={filesOpen}
        galleryOpen={galleryOpen}
        wizardOpen={wizardOpen}
        peekPromptData={peekPromptData}
        deleteDialogMessageId={deleteDialogMessageId}
        multiSelectMode={multiSelectMode}
        selectedMessageCount={selectedMessageIds.size}
        sceneSettings={{
          spriteArrangeMode,
          onToggleSpriteArrange,
          onResetSpritePlacements,
          onSpriteSideChange,
        }}
        onCloseSettings={onCloseSettings}
        onCloseFiles={onCloseFiles}
        onCloseGallery={onCloseGallery}
        onIllustrate={onIllustrate}
        onWizardFinish={onWizardFinish}
        onClosePeekPrompt={onClosePeekPrompt}
        onDeleteConfirm={onDeleteConfirm}
        onDeleteMore={onDeleteMore}
        onCloseDeleteDialog={onCloseDeleteDialog}
        onBulkDelete={onBulkDelete}
        onCancelMultiSelect={onCancelMultiSelect}
        onUnselectAllMessages={onUnselectAllMessages}
        onSelectAllAboveSelection={onSelectAllAboveSelection}
        onSelectAllBelowSelection={onSelectAllBelowSelection}
      />
    </div>
  );
}
