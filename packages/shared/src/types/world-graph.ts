// ──────────────────────────────────────────────
// World Graph Types
// ──────────────────────────────────────────────

export type WorldNodeKind = "location" | "character" | "item";
export type WorldEdgeKind = "connects_to" | "at" | "in" | "held_by";

export type WorldPatchSourceRole = "user" | "assistant" | "manual" | "ingest";
export type WorldPatchSourcePhase = "pre_generation" | "tool" | "post_generation" | "manual" | "ingest";
export type WorldPatchStatus = "pending" | "committed" | "inactive" | "orphaned" | "rejected";

export type WorldNodeAttributes = {
  kind: WorldNodeKind;
  name: string;
  description?: string;
  tags?: string[];
  lorebookEntryId?: string | null;
  aliases?: string[];
  isPlayer?: boolean;
  personaId?: string | null;
  x?: number | null;
  y?: number | null;
  floor?: string | null;
  revealed?: boolean;
  visited?: boolean;
};

export type WorldEdgeAttributes = {
  kind: WorldEdgeKind;
  oneWay?: boolean;
};

export interface WorldGraph {
  id: string;
  chatId: string | null;
  name: string;
  snapshotJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorldNodeView {
  key: string;
  attributes: WorldNodeAttributes;
}

export interface WorldEdgeView {
  key: string;
  source: string;
  target: string;
  attributes: WorldEdgeAttributes;
}

export interface WorldObservation {
  graphId: string;
  currentLocation: WorldNodeView | null;
  currentCharacter: WorldNodeView | null;
  inventory: WorldNodeView[];
  visibleItems: WorldNodeView[];
  presentCharacters: WorldNodeView[];
  exits: WorldNodeView[];
  recentEvents: string[];
}

export interface WorldMap {
  graphId: string;
  nodes: WorldNodeView[];
  edges: WorldEdgeView[];
  currentLocationKey: string | null;
  playerKey: string | null;
}

export interface WorldRoute {
  locations: string[];
}
