// ──────────────────────────────────────────────
// Panel: World Graph
// ──────────────────────────────────────────────
import { useMemo, useState } from "react";
import { AlertCircle, Boxes, Check, Compass, Loader2, MapPin, Package, Play, RefreshCw, Users } from "lucide-react";
import type { WorldGraphPatch, WorldMap, WorldNodeView, WorldObservation } from "@marinara-engine/shared";
import { useChatStore } from "../../stores/chat.store";
import {
  useRebuildWorldGraph,
  useRunWorldGraph,
  useWorldGraphMap,
  useWorldGraphObservation,
} from "../../hooks/use-world-graph";
import { cn } from "../../lib/utils";

const SAMPLE_SCRIPT = `createLocation({ name: "Foyer", description: "A quiet entry hall.", x: 0, y: 0 });
createLocation({ name: "Hallway", description: "A narrow passage with several doors.", x: 180, y: 0 });
createItem({ name: "Brass Key", description: "A small old key." });
createCharacter({ name: "Player" });
connect("Foyer", "Hallway");
move("Player", "Foyer");
place("Brass Key", "Hallway");
observe();`;

export function WorldGraphPanel() {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const { data: map, isLoading: mapLoading, error: mapError } = useWorldGraphMap(activeChatId);
  const { data: observation, isLoading: observationLoading } = useWorldGraphObservation(activeChatId);
  const runWorld = useRunWorldGraph(activeChatId);
  const rebuildWorld = useRebuildWorldGraph(activeChatId);
  const [mode, setMode] = useState<"script" | "patch">("script");
  const [input, setInput] = useState(SAMPLE_SCRIPT);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestSuccess, setIngestSuccess] = useState<string | null>(null);

  const counts = useMemo(() => countNodes(map), [map]);
  const busy = runWorld.isPending || rebuildWorld.isPending;

  const handleIngest = async () => {
    if (!activeChatId || busy) return;
    setIngestError(null);
    setIngestSuccess(null);

    try {
      if (mode === "patch") {
        const patch = JSON.parse(input) as WorldGraphPatch;
        await runWorld.mutateAsync({ patch, apply: true });
      } else {
        await runWorld.mutateAsync({ code: input, apply: true });
      }
      setIngestSuccess("World graph updated.");
    } catch (error) {
      setIngestError(error instanceof Error ? error.message : "World graph ingest failed");
    }
  };

  if (!activeChatId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-[var(--muted-foreground)]">
        Open a chat to inspect or ingest a world graph.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <section className="space-y-2 border-b border-[var(--border)] pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold">World Graph</h3>
            <p className="text-[0.625rem] text-[var(--muted-foreground)]">
              Ingest a map, then enable the World Graph agent in chat settings.
            </p>
          </div>
          <button
            onClick={() => rebuildWorld.mutate()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50"
            title="Rebuild from committed patches"
          >
            {rebuildWorld.isPending ? (
              <Loader2 size="0.75rem" className="animate-spin" />
            ) : (
              <RefreshCw size="0.75rem" />
            )}
            Rebuild
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <StatTile icon={<MapPin size="0.75rem" />} label="Locations" value={counts.location} />
          <StatTile icon={<Users size="0.75rem" />} label="Characters" value={counts.character} />
          <StatTile icon={<Package size="0.75rem" />} label="Items" value={counts.item} />
        </div>
      </section>

      <section className="space-y-2 border-b border-[var(--border)] pb-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">Ingest</h3>
          <div className="flex rounded-lg bg-[var(--secondary)] p-0.5 ring-1 ring-[var(--border)]">
            <ModeButton active={mode === "script"} onClick={() => setMode("script")}>
              Script
            </ModeButton>
            <ModeButton active={mode === "patch"} onClick={() => setMode("patch")}>
              Patch
            </ModeButton>
          </div>
        </div>
        <textarea
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setIngestError(null);
            setIngestSuccess(null);
          }}
          spellCheck={false}
          className="h-48 w-full resize-y rounded-lg bg-[var(--secondary)] px-3 py-2 font-mono text-[0.6875rem] leading-relaxed outline-none ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)]/50 focus:ring-[var(--ring)]"
          placeholder={mode === "script" ? "World DSL script..." : '{"ops":[],"events":[]}'}
        />
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setInput(SAMPLE_SCRIPT)}
            className="rounded-lg px-2 py-1 text-[0.625rem] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            Load sample
          </button>
          <button
            onClick={handleIngest}
            disabled={busy || !input.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity disabled:opacity-50"
          >
            {runWorld.isPending ? <Loader2 size="0.8125rem" className="animate-spin" /> : <Play size="0.8125rem" />}
            Apply
          </button>
        </div>
        {ingestError && (
          <p className="flex items-center gap-1 text-[0.625rem] text-red-400">
            <AlertCircle size="0.6875rem" />
            {ingestError}
          </p>
        )}
        {ingestSuccess && (
          <p className="flex items-center gap-1 text-[0.625rem] text-emerald-400">
            <Check size="0.6875rem" />
            {ingestSuccess}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold">Current View</h3>
        {mapLoading || observationLoading ? (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-3 text-xs text-[var(--muted-foreground)]">
            <Loader2 size="0.875rem" className="animate-spin" />
            Loading world graph...
          </div>
        ) : mapError ? (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">Could not load world graph.</div>
        ) : (
          <>
            <ObservationView observation={observation} />
            <WorldMapSketch map={map} />
            <NodeGroups map={map} />
          </>
        )}
      </section>
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[var(--secondary)] px-2 py-2 ring-1 ring-[var(--border)]">
      <div className="flex items-center gap-1 text-[var(--muted-foreground)]">
        {icon}
        <span className="text-[0.5625rem]">{label}</span>
      </div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1 text-[0.625rem] font-medium transition-colors",
        active
          ? "bg-[var(--primary)]/15 text-[var(--primary)]"
          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
      )}
    >
      {children}
    </button>
  );
}

function ObservationView({ observation }: { observation?: WorldObservation }) {
  const location = observation?.currentLocation?.attributes;
  const inventory = observation?.inventory ?? [];
  const visibleItems = observation?.visibleItems ?? [];
  const exits = observation?.exits ?? [];

  return (
    <div className="space-y-2 rounded-lg bg-[var(--secondary)] px-3 py-3 ring-1 ring-[var(--border)]">
      <div className="flex items-start gap-2">
        <Compass size="0.875rem" className="mt-0.5 shrink-0 text-[var(--primary)]" />
        <div className="min-w-0">
          <div className="text-xs font-semibold">{location?.name ?? "No current location"}</div>
          {location?.description && (
            <p className="mt-0.5 line-clamp-3 text-[0.625rem] text-[var(--muted-foreground)]">{location.description}</p>
          )}
        </div>
      </div>
      <MiniList label="Inventory" items={inventory} empty="Empty" />
      <MiniList label="Visible Items" items={visibleItems} empty="None" />
      <MiniList label="Exits" items={exits} empty="None" />
      {observation?.recentEvents && observation.recentEvents.length > 0 && (
        <div>
          <div className="mb-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">Recent Events</div>
          <div className="space-y-1">
            {observation.recentEvents.slice(-4).map((event, index) => (
              <div key={`${event}-${index}`} className="text-[0.625rem] text-[var(--foreground)]/80">
                {event}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniList({ label, items, empty }: { label: string; items: WorldNodeView[]; empty: string }) {
  return (
    <div>
      <div className="mb-1 text-[0.625rem] font-medium text-(--muted-foreground)">{label}</div>
      <div className="flex flex-wrap gap-1">
        {items.length === 0 ? (
          <span className="text-[0.625rem] text-(--muted-foreground)">{empty}</span>
        ) : (
          items.map((item) => (
            <span
              key={item.key}
              className="rounded-md bg-(--background) px-1.5 py-0.5 text-[0.625rem] text-(--foreground) ring-1 ring-(--border)"
            >
              {item.attributes.name}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function WorldMapSketch({ map }: { map?: WorldMap }) {
  const locations = (map?.nodes ?? []).filter((node) => node.attributes.kind === "location");

  if (locations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-(--border) px-3 py-6 text-center text-xs text-(--muted-foreground)">
        No map locations yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-(--border) p-2">
      <div className="mb-2 flex items-center gap-1.5 text-[0.625rem] font-medium text-(--muted-foreground)">
        <Boxes size="0.75rem" />
        View Area
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {locations.map((location) => {
          const current = location.key === map?.currentLocationKey;
          return (
            <div
              key={location.key}
              className={cn(
                "min-h-14 rounded-lg px-2 py-2 ring-1 transition-colors",
                current
                  ? "bg-(--primary)/15 ring-(--primary)/40"
                  : "bg-(--secondary) ring-(--border)",
              )}
            >
              <div className="flex items-center gap-1.5">
                <MapPin
                  size="0.75rem"
                  className={current ? "text-(--primary)" : "text-(--muted-foreground)"}
                />
                <span className="min-w-0 truncate text-[0.6875rem] font-semibold">{location.attributes.name}</span>
              </div>
              <div className="mt-1 text-[0.5625rem] text-(--muted-foreground)">
                {current ? "Current location" : location.attributes.visited ? "Visited" : "Unvisited"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NodeGroups({ map }: { map?: WorldMap }) {
  const groups = useMemo(() => {
    const nodes = map?.nodes ?? [];
    return {
      Locations: nodes.filter((node) => node.attributes.kind === "location"),
      Characters: nodes.filter((node) => node.attributes.kind === "character"),
      Items: nodes.filter((node) => node.attributes.kind === "item"),
    };
  }, [map]);

  return (
    <div className="space-y-2">
      {Object.entries(groups).map(([label, nodes]) => (
        <div key={label}>
          <div className="mb-1 text-[0.625rem] font-medium text-(--muted-foreground)">{label}</div>
          {nodes.length === 0 ? (
            <p className="text-[0.625rem] text-(--muted-foreground)">None</p>
          ) : (
            <div className="space-y-1">
              {nodes.map((node) => (
                <div
                  key={node.key}
                  className="rounded-lg bg-(--secondary) px-2 py-1.5 ring-1 ring-(--border)"
                >
                  <div className="truncate text-[0.6875rem] font-medium">{node.attributes.name}</div>
                  {node.attributes.description && (
                    <div className="mt-0.5 line-clamp-2 text-[0.5625rem] text-(--muted-foreground)">
                      {node.attributes.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function countNodes(map?: WorldMap) {
  const counts = { location: 0, character: 0, item: 0 };
  for (const node of map?.nodes ?? []) {
    if (node.attributes.kind === "location") counts.location += 1;
    if (node.attributes.kind === "character") counts.character += 1;
    if (node.attributes.kind === "item") counts.item += 1;
  }
  return counts;
}
