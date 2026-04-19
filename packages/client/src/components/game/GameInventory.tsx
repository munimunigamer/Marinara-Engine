// ──────────────────────────────────────────────
// Game: Inventory Panel
// ──────────────────────────────────────────────
import { useState, useCallback, useEffect } from "react";
import { X, Package, Wand2 } from "lucide-react";
import { cn } from "../../lib/utils";

export interface InventoryItem {
  name: string;
  description?: string;
  quantity: number;
}

interface GameInventoryProps {
  items: InventoryItem[];
  open: boolean;
  onClose: () => void;
  /** Called when the user wants to use an item during input phase */
  onUseItem?: (itemName: string) => void;
  /** Whether the player can interact (input phase) */
  canInteract?: boolean;
}

export function GameInventory({ items, open, onClose, onUseItem, canInteract }: GameInventoryProps) {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const handleItemClick = useCallback(
    (item: InventoryItem) => {
      if (!canInteract) {
        // Just toggle inspect
        setSelectedItem((prev) => (prev === item.name ? null : item.name));
        return;
      }
      setSelectedItem((prev) => (prev === item.name ? null : item.name));
    },
    [canInteract],
  );

  const handleUse = useCallback(
    (itemName: string) => {
      onUseItem?.(itemName);
      setSelectedItem(null);
    },
    [onUseItem],
  );

  // Clear selection if the selected item was removed
  useEffect(() => {
    if (selectedItem && !items.some((i) => i.name === selectedItem)) {
      setSelectedItem(null);
    }
  }, [items, selectedItem]);

  if (!open) return null;

  const SLOT_COUNT = 20;
  const slots: Array<InventoryItem | null> = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    slots.push(items[i] ?? null);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative mx-4 flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-lg border border-white/10 bg-black shadow-[0_0_40px_rgba(0,0,0,0.8)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 bg-white/[0.02] px-4 py-3">
          <div className="flex items-center gap-2">
            <Package size={15} className="text-amber-400/80" />
            <h2 className="text-sm font-semibold tracking-wide text-white/90">Inventory</h2>
            <span className="rounded bg-white/8 px-1.5 py-0.5 text-[0.6rem] tabular-nums text-white/40">
              {items.length}/{SLOT_COUNT}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
          >
            <X size={14} />
          </button>
        </div>

        {/* Slot grid */}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-5 gap-1.5">
            {slots.map((item, i) => (
              <button
                key={`slot-${i}`}
                onClick={() => item && handleItemClick(item)}
                disabled={!item}
                className={cn(
                  "group relative flex aspect-square flex-col items-center justify-center rounded border transition-all",
                  item
                    ? selectedItem === item.name
                      ? "border-amber-500/50 bg-amber-500/10 shadow-[inset_0_0_12px_rgba(245,158,11,0.08)]"
                      : "border-white/8 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]"
                    : "border-white/[0.04] bg-white/[0.015]",
                )}
              >
                {item ? (
                  <>
                    <div className="flex h-7 w-7 items-center justify-center rounded bg-gradient-to-b from-white/8 to-white/[0.02] text-sm font-bold text-amber-400/80">
                      {item.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="mt-0.5 line-clamp-1 max-w-full px-0.5 text-[0.55rem] leading-tight text-white/70">
                      {item.name}
                    </span>
                    {item.quantity > 1 && (
                      <span className="absolute right-0.5 top-0.5 min-w-[14px] rounded bg-white/15 px-0.5 text-center text-[0.5rem] font-semibold tabular-nums text-white/80">
                        {item.quantity}
                      </span>
                    )}
                  </>
                ) : (
                  <div className="h-7 w-7 rounded bg-white/[0.02]" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Action bar — when an item is selected */}
        {selectedItem && (
          <div className="border-t border-white/8 bg-white/[0.02] px-4 py-2.5">
            <div className="mb-2 text-[0.7rem] font-medium text-white/60">
              {items.find((i) => i.name === selectedItem)?.description || selectedItem}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => setSelectedItem(null)}
                className="flex flex-1 items-center justify-center gap-1 rounded border border-white/8 bg-white/[0.03] py-1.5 text-[0.7rem] text-white/60 transition-colors hover:bg-white/[0.06]"
              >
                <X size={12} />
                Deselect
              </button>
              {canInteract && onUseItem && (
                <button
                  onClick={() => handleUse(selectedItem)}
                  className="flex flex-1 items-center justify-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 py-1.5 text-[0.7rem] font-semibold text-amber-400 transition-colors hover:bg-amber-500/15"
                >
                  <Wand2 size={12} />
                  Use
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
