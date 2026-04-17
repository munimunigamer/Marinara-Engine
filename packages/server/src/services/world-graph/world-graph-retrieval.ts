// ──────────────────────────────────────────────
// World Graph Read Models
// ──────────────────────────────────────────────
import type { WorldEdgeKind, WorldEdgeView, WorldMap, WorldNodeKind, WorldObservation } from "@marinara-engine/shared";
import { findNodeKey, here, nodeView, type WorldGraphRuntime } from "./world-graph-runtime.js";

export function buildWorldObservation(
  graphId: string,
  graph: WorldGraphRuntime,
  recentEvents: string[] = [],
  characterName = "Player",
): WorldObservation {
  const currentCharacterKey = findOptionalNodeKey(graph, characterName, "character");
  const currentLocation = currentCharacterKey ? here(graph, currentCharacterKey) : null;
  const currentLocationKey = currentLocation?.key ?? null;

  return {
    graphId,
    currentLocation,
    currentCharacter: currentCharacterKey ? nodeView(graph, currentCharacterKey) : null,
    inventory: currentCharacterKey ? inboundNodeViews(graph, currentCharacterKey, "held_by", "item") : [],
    visibleItems: currentLocationKey ? inboundNodeViews(graph, currentLocationKey, "in", "item") : [],
    presentCharacters: currentLocationKey ? inboundNodeViews(graph, currentLocationKey, "at", "character") : [],
    exits: currentLocationKey ? outboundNodeViews(graph, currentLocationKey, "connects_to", "location") : [],
    recentEvents: recentEvents.slice(-10),
  };
}

export function buildWorldMap(graphId: string, graph: WorldGraphRuntime, characterName = "Player"): WorldMap {
  const playerKey = findOptionalNodeKey(graph, characterName, "character");
  const currentLocation = playerKey ? here(graph, playerKey) : null;

  return {
    graphId,
    nodes: graph.nodes().map((key) => nodeView(graph, key)),
    edges: graph.edges().map((key): WorldEdgeView => {
      return {
        key,
        source: graph.source(key),
        target: graph.target(key),
        attributes: graph.getEdgeAttributes(key),
      };
    }),
    currentLocationKey: currentLocation?.key ?? null,
    playerKey,
  };
}

function findOptionalNodeKey(graph: WorldGraphRuntime, value: string, kind: WorldNodeKind): string | null {
  try {
    return findNodeKey(graph, value, kind);
  } catch {
    return null;
  }
}

function inboundNodeViews(graph: WorldGraphRuntime, target: string, edgeKind: WorldEdgeKind, sourceKind: WorldNodeKind) {
  return graph
    .inEdges(target)
    .filter((edge) => graph.getEdgeAttribute(edge, "kind") === edgeKind)
    .map((edge) => graph.source(edge))
    .filter((key) => graph.getNodeAttribute(key, "kind") === sourceKind)
    .map((key) => nodeView(graph, key));
}

function outboundNodeViews(
  graph: WorldGraphRuntime,
  source: string,
  edgeKind: WorldEdgeKind,
  targetKind: WorldNodeKind,
) {
  return graph
    .outEdges(source)
    .filter((edge) => graph.getEdgeAttribute(edge, "kind") === edgeKind)
    .map((edge) => graph.target(edge))
    .filter((key) => graph.getNodeAttribute(key, "kind") === targetKind)
    .map((key) => nodeView(graph, key));
}
