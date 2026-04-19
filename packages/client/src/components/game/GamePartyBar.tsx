// ──────────────────────────────────────────────
// Game: Compact Party Portraits Bar (top-left, horizontal)
// ──────────────────────────────────────────────
import { useGameModeStore } from "../../stores/game-mode.store";

interface PartyBarMember {
  id: string;
  name: string;
  avatarUrl?: string | null;
  nameColor?: string;
}

interface PartyBarCard {
  title: string;
  subtitle?: string;
  mood?: string;
  status?: string;
  level?: number;
  avatarUrl?: string | null;
  stats?: Array<{ name: string; value: number; max?: number; color?: string }>;
  inventory?: Array<{ name: string; quantity?: number; location?: string }>;
  customFields?: Record<string, string>;
}

interface GamePartyBarProps {
  partyMembers: PartyBarMember[];
  partyCards: Record<string, PartyBarCard>;
}

export function GamePartyBar({ partyMembers, partyCards }: GamePartyBarProps) {
  const openCharacterSheet = useGameModeStore((s) => s.openCharacterSheet);

  if (partyMembers.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {partyMembers.map((member) => {
        const card = partyCards[member.id];
        const avatarSrc = card?.avatarUrl ?? member.avatarUrl;

        return (
          <button
            key={member.id}
            onClick={() => openCharacterSheet(member.id)}
            className="group relative shrink-0 transition-transform hover:scale-110"
            title={`${member.name} — Click to open character sheet`}
          >
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt={member.name}
                className="h-9 w-9 rounded-full border-2 border-white/20 object-cover shadow-lg transition-colors group-hover:border-white/40"
              />
            ) : (
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white/20 bg-[var(--accent)] text-xs font-bold shadow-lg transition-colors group-hover:border-white/40"
                style={member.nameColor ? { color: member.nameColor } : undefined}
              >
                {member.name[0]}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
