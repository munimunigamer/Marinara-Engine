// ──────────────────────────────────────────────
// Game: Character Sheet Modal (tabletop-style character sheet)
// ──────────────────────────────────────────────
import { Heart, Shield, Sparkles, Swords, X, Zap, Target, AlertTriangle, Info } from "lucide-react";

interface CharacterSheetCard {
  title: string;
  subtitle?: string;
  mood?: string;
  status?: string;
  level?: number;
  avatarUrl?: string | null;
  stats?: Array<{ name: string; value: number; max?: number; color?: string }>;
  inventory?: Array<{ name: string; quantity?: number; location?: string }>;
  customFields?: Record<string, string>;
  /** Game-specific character card data generated at setup */
  gameCard?: {
    shortDescription: string;
    class: string;
    abilities: string[];
    strengths: string[];
    weaknesses: string[];
    extra: Record<string, string>;
    rpgStats?: {
      attributes: Array<{ name: string; value: number }>;
      hp: { value: number; max: number };
    };
  };
}

interface GameCharacterSheetProps {
  card: CharacterSheetCard;
  onClose: () => void;
}

export function GameCharacterSheet({ card, onClose }: GameCharacterSheetProps) {
  const gc = card.gameCard;
  const hasRpgStats = gc?.rpgStats && gc.rpgStats.attributes.length > 0;
  const hasGameData =
    gc &&
    (gc.class ||
      gc.abilities.length > 0 ||
      gc.strengths.length > 0 ||
      gc.weaknesses.length > 0 ||
      Object.keys(gc.extra).length > 0);
  const hasAnyData =
    hasGameData ||
    hasRpgStats ||
    (card.stats?.length ?? 0) > 0 ||
    (card.inventory?.length ?? 0) > 0 ||
    card.customFields;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative mx-4 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        >
          <X size={18} />
        </button>

        {/* Header: Avatar + Name + Class */}
        <div className="relative border-b border-[var(--border)] bg-[var(--secondary)]/50 px-5 py-4">
          <div className="flex items-center gap-4">
            {card.avatarUrl ? (
              <img
                src={card.avatarUrl}
                alt={card.title}
                className="h-20 w-20 rounded-xl border-2 border-[var(--border)] object-cover shadow-xl"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-[var(--border)] bg-[var(--secondary)] text-2xl font-bold text-[var(--muted-foreground)]">
                {card.title[0]}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-bold text-[var(--foreground)]">{card.title}</h2>
              {gc?.class && <p className="text-xs font-medium text-[var(--primary)]">{gc.class}</p>}
              {gc?.shortDescription && !gc.class && (
                <p className="text-xs text-[var(--muted-foreground)]">{gc.shortDescription}</p>
              )}
              {card.subtitle && !gc?.class && !gc?.shortDescription && (
                <p className="text-xs text-[var(--muted-foreground)]">{card.subtitle}</p>
              )}
              {card.mood && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Heart size={11} className="text-rose-400/70" />
                  <span className="text-[0.6875rem] italic text-rose-400/70">{card.mood}</span>
                </div>
              )}
              {card.status && (
                <p className="mt-1 text-[0.6875rem] text-[var(--muted-foreground)] line-clamp-2">{card.status}</p>
              )}
            </div>
            {card.level != null && (
              <div className="flex items-center gap-1 rounded border border-[var(--primary)]/20 bg-[var(--primary)]/10 px-1.5 py-0.5">
                <span className="text-[0.4375rem] uppercase tracking-wider text-[var(--primary)]/60">LVL</span>
                <span className="text-xs font-bold leading-none text-[var(--primary)]">{card.level}</span>
              </div>
            )}
          </div>
          {gc?.shortDescription && gc.class && (
            <p className="mt-2 text-[0.6875rem] italic text-[var(--muted-foreground)]">{gc.shortDescription}</p>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* RPG Attributes (tabletop grid) */}
          {hasRpgStats && (
            <div className="border-b border-[var(--border)] px-5 py-4">
              <div className="mb-2.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <Shield size={12} />
                <span>Attributes</span>
              </div>
              <div className="mb-3 grid grid-cols-3 gap-2">
                {gc!.rpgStats!.attributes.map((attr) => (
                  <div
                    key={attr.name}
                    className="flex flex-col items-center rounded-lg border border-[var(--border)] bg-[var(--secondary)]/50 px-2 py-1.5"
                  >
                    <span className="text-[0.5625rem] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
                      {attr.name}
                    </span>
                    <span className="text-lg font-bold leading-tight text-[var(--foreground)]">{attr.value}</span>
                  </div>
                ))}
              </div>
              {/* HP bar */}
              <div>
                <div className="mb-0.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--foreground)]/80">HP</span>
                  <span className="font-mono text-[var(--muted-foreground)]">
                    {gc!.rpgStats!.hp.value}/{gc!.rpgStats!.hp.max}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-[var(--secondary)] ring-1 ring-[var(--border)]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(gc!.rpgStats!.hp.value / Math.max(1, gc!.rpgStats!.hp.max)) * 100}%`,
                      background: "#ef4444",
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Runtime stats (progress bars from game state) */}
          {card.stats && card.stats.length > 0 && (
            <div className="border-b border-[var(--border)] px-5 py-4">
              <div className="mb-2.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <Shield size={12} />
                <span>Stats</span>
              </div>
              <div className="space-y-2">
                {card.stats.map((stat) => {
                  const max = Math.max(1, stat.max ?? 100);
                  const value = Math.max(0, Math.min(max, stat.value));
                  const width = (value / max) * 100;
                  return (
                    <div key={stat.name}>
                      <div className="mb-0.5 flex items-center justify-between text-xs">
                        <span className="font-medium text-[var(--foreground)]/80">{stat.name}</span>
                        <span className="font-mono text-[var(--muted-foreground)]">
                          {value}/{max}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--secondary)] ring-1 ring-[var(--border)]">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${width}%`,
                            background: stat.color || "var(--primary)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Abilities */}
          {gc && gc.abilities.length > 0 && (
            <div className="border-b border-[var(--border)] px-5 py-4">
              <div className="mb-2.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <Zap size={12} />
                <span>Abilities</span>
              </div>
              <div className="space-y-1">
                {gc.abilities.map((ability, i) => (
                  <div
                    key={i}
                    className="rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)]/80"
                  >
                    {ability}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Strengths & Weaknesses side by side */}
          {gc && (gc.strengths.length > 0 || gc.weaknesses.length > 0) && (
            <div className="border-b border-[var(--border)] px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                {gc.strengths.length > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center gap-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-emerald-500/80">
                      <Target size={11} />
                      <span>Strengths</span>
                    </div>
                    <div className="space-y-0.5">
                      {gc.strengths.map((s, i) => (
                        <div key={i} className="text-[0.6875rem] text-[var(--foreground)]/70">
                          • {s}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {gc.weaknesses.length > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center gap-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-red-400/80">
                      <AlertTriangle size={11} />
                      <span>Weaknesses</span>
                    </div>
                    <div className="space-y-0.5">
                      {gc.weaknesses.map((w, i) => (
                        <div key={i} className="text-[0.6875rem] text-[var(--foreground)]/70">
                          • {w}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Extra info (gender, title, element, etc.) */}
          {gc && Object.keys(gc.extra).length > 0 && (
            <div className="border-b border-[var(--border)] px-5 py-4">
              <div className="mb-2.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <Info size={12} />
                <span>Details</span>
              </div>
              <div className="space-y-1.5 text-xs">
                {Object.entries(gc.extra).map(([key, val]) => (
                  <div key={key} className="flex items-start justify-between gap-3">
                    <span className="shrink-0 capitalize text-[var(--muted-foreground)]">
                      {key.replaceAll("_", " ")}
                    </span>
                    <span className="text-right text-[var(--foreground)]/80">{val}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inventory */}
          {card.inventory && card.inventory.length > 0 && (
            <div className="border-b border-[var(--border)] px-5 py-4">
              <div className="mb-2.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <Swords size={12} />
                <span>Inventory</span>
              </div>
              <div className="space-y-1">
                {card.inventory.map((item) => (
                  <div
                    key={`${item.name}-${item.location ?? "bag"}`}
                    className="flex items-center justify-between rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--foreground)]/80">{item.name}</span>
                      {item.location && (
                        <span className="rounded bg-[var(--primary)]/10 px-1.5 py-0.5 text-[0.5625rem] text-[var(--muted-foreground)]">
                          {item.location}
                        </span>
                      )}
                    </div>
                    {item.quantity != null && item.quantity > 1 && (
                      <span className="font-mono text-[var(--muted-foreground)]">x{item.quantity}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Custom Fields / Traits (from runtime game state) */}
          {card.customFields && Object.keys(card.customFields).length > 0 && (
            <div className="border-b border-[var(--border)] px-5 py-4">
              <div className="mb-2.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <Sparkles size={12} />
                <span>Traits</span>
              </div>
              <div className="space-y-1.5 text-xs">
                {Object.entries(card.customFields).map(([key, val]) => (
                  <div key={key} className="flex items-start justify-between gap-3">
                    <span className="shrink-0 text-[var(--muted-foreground)]">{key}</span>
                    <span className="text-right text-[var(--foreground)]/80">{val}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fallback when no data yet */}
          {!hasAnyData && (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-[var(--muted-foreground)]">
                Character data will populate as the story progresses.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
