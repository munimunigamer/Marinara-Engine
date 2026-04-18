// ──────────────────────────────────────────────
// World Graph Read Models
// ──────────────────────────────────────────────
import type { WorldEdgeKind, WorldEdgeView, WorldMap, WorldNodeKind, WorldObservation } from "@marinara-engine/shared";
import { findNodeKey, getLocalTraversalExitViews, here, nodeView, type WorldGraphRuntime } from "./world-graph-runtime.js";

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
    exits: currentLocationKey ? getLocalTraversalExitViews(graph, currentLocationKey) : [],
    recentEvents: recentEvents.slice(-10),
  };
}

export function buildWorldMap(graphId: string, graph: WorldGraphRuntime, characterName = "Player"): WorldMap {
  const playerKey = findOptionalNodeKey(graph, characterName, "character");
  const currentLocation = playerKey ? here(graph, playerKey) : null;
  const currentLocationKey = currentLocation?.key ?? null;
  const visibleLocationKeys = new Set(
    graph.nodes().filter((key) => {
      const attrs = graph.getNodeAttributes(key);
      return (
        attrs.kind === "location" && (key === currentLocationKey || attrs.revealed !== false || attrs.visited === true)
      );
    }),
  );
  const visibleNodeKeys = new Set(
    graph.nodes().filter((key) => isNodeVisibleOnMap(graph, key, visibleLocationKeys, playerKey)),
  );

  return {
    graphId,
    nodes: graph
      .nodes()
      .filter((key) => visibleNodeKeys.has(key))
      .map((key) => nodeView(graph, key)),
    edges: graph
      .edges()
      .filter((key) => visibleNodeKeys.has(graph.source(key)) && visibleNodeKeys.has(graph.target(key)))
      .map((key): WorldEdgeView => {
        return {
          key,
          source: graph.source(key),
          target: graph.target(key),
          attributes: graph.getEdgeAttributes(key),
        };
      }),
    currentLocationKey,
    playerKey,
  };
}

function isNodeVisibleOnMap(
  graph: WorldGraphRuntime,
  key: string,
  visibleLocationKeys: Set<string>,
  playerKey: string | null,
) {
  const attrs = graph.getNodeAttributes(key);
  if (attrs.kind === "location") return visibleLocationKeys.has(key);
  if (attrs.kind === "character") {
    if (key === playerKey) return true;
    const atEdge = graph.findOutboundEdge(key, (_, edgeAttrs) => edgeAttrs.kind === "at");
    return atEdge ? visibleLocationKeys.has(graph.target(atEdge)) : false;
  }
  if (attrs.kind === "item") {
    const inEdge = graph.findOutboundEdge(key, (_, edgeAttrs) => edgeAttrs.kind === "in");
    if (inEdge && visibleLocationKeys.has(graph.target(inEdge))) return true;
    const heldEdge = graph.findOutboundEdge(key, (_, edgeAttrs) => edgeAttrs.kind === "held_by");
    return !!heldEdge && graph.target(heldEdge) === playerKey;
  }
  return false;
}

function findOptionalNodeKey(graph: WorldGraphRuntime, value: string, kind: WorldNodeKind): string | null {
  try {
    return findNodeKey(graph, value, kind);
  } catch {
    return null;
  }
}

function inboundNodeViews(
  graph: WorldGraphRuntime,
  target: string,
  edgeKind: WorldEdgeKind,
  sourceKind: WorldNodeKind,
) {
  return graph
    .inEdges(target)
    .filter((edge) => graph.getEdgeAttribute(edge, "kind") === edgeKind)
    .map((edge) => graph.source(edge))
    .filter((key) => graph.getNodeAttribute(key, "kind") === sourceKind)
    .map((key) => nodeView(graph, key));
}
