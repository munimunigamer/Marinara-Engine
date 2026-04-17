// ──────────────────────────────────────────────
// World Graph Runtime (Graphology-backed)
// ──────────────────────────────────────────────
import Graph from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted.js";
import type {
  WorldEdgeAttributes,
  WorldEdgeKind,
  WorldGraphPatch,
  WorldNodeAttributes,
  WorldNodeKind,
  WorldRoute,
} from "@marinara-engine/shared";
import type { WorldPatchOperation } from "@marinara-engine/shared";

export type WorldGraphRuntime = Graph<WorldNodeAttributes, WorldEdgeAttributes>;

export interface WorldPatchApplyResult {
  graph: WorldGraphRuntime;
  generatedEvents: string[];
  events: string[];
}

export function createWorldGraphRuntime(): WorldGraphRuntime {
  return new Graph<WorldNodeAttributes, WorldEdgeAttributes>({ type: "directed", multi: false });
}

export function importWorldGraphRuntime(snapshotJson: string | null | undefined): WorldGraphRuntime {
  const graph = createWorldGraphRuntime();
  if (!snapshotJson) return graph;
  graph.import(JSON.parse(snapshotJson));
  return graph;
}

export function exportWorldGraphRuntime(graph: WorldGraphRuntime) {
  return JSON.stringify(graph.export());
}

export function normalizeWorldKey(value: string): string {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return key || "node";
}

export function applyWorldPatch(graph: WorldGraphRuntime, patch: WorldGraphPatch): WorldPatchApplyResult {
  const generatedEvents: string[] = [];

  for (const op of patch.ops) {
    const event = applyOperation(graph, op);
    if (event) generatedEvents.push(event);
  }

  return {
    graph,
    generatedEvents,
    events: patch.events.length > 0 ? patch.events : generatedEvents,
  };
}

export function findNodeKey(graph: WorldGraphRuntime, value: string, kind?: WorldNodeKind): string {
  const direct = graph.hasNode(value) ? value : normalizeWorldKey(value);
  if (graph.hasNode(direct)) {
    const attrs = graph.getNodeAttributes(direct);
    if (!kind || attrs.kind === kind) return direct;
  }

  const needle = value.trim().toLowerCase();
  const found = graph.findNode((_, attrs) => attrs.kind === (kind ?? attrs.kind) && attrs.name.toLowerCase() === needle);
  if (!found) throw new Error(`World node not found: ${value}`);
  return found;
}

export function here(graph: WorldGraphRuntime, character = "Player") {
  const characterKey = findNodeKey(graph, character, "character");
  const edge = graph.findOutboundEdge(characterKey, (_, attrs) => attrs.kind === "at");
  if (!edge) return null;
  return nodeView(graph, graph.target(edge));
}

export function path(graph: WorldGraphRuntime, fromLocation: string, toLocation: string): WorldRoute {
  const fromKey = findNodeKey(graph, fromLocation, "location");
  const toKey = findNodeKey(graph, toLocation, "location");
  const route = bidirectional(graph, fromKey, toKey);
  if (!route) throw new Error(`No route from ${fromLocation} to ${toLocation}`);
  return {
    locations: route.map((key) => graph.getNodeAttribute(key, "name") as string),
  };
}

export function explore(graph: WorldGraphRuntime, location: string) {
  const locationKey = findNodeKey(graph, location, "location");
  return {
    location: nodeView(graph, locationKey),
    items: inboundNodes(graph, locationKey, "in", "item"),
    characters: inboundNodes(graph, locationKey, "at", "character"),
    exits: outboundNodes(graph, locationKey, "connects_to", "location"),
  };
}

export function explorePath(graph: WorldGraphRuntime, locations: string[]) {
  return locations.map((location) => explore(graph, location));
}

function applyOperation(graph: WorldGraphRuntime, op: WorldPatchOperation): string | null {
  switch (op.type) {
    case "createLocation": {
      const key = upsertNode(graph, op.key ?? op.name, {
        kind: "location",
        name: op.name,
        description: op.description,
        tags: op.tags ?? [],
        data: op.data ?? {},
        x: op.x ?? null,
        y: op.y ?? null,
        floor: op.floor ?? null,
        revealed: op.revealed ?? true,
        visited: op.visited ?? false,
      });
      return `Created location ${graph.getNodeAttribute(key, "name")}.`;
    }
    case "createCharacter": {
      const key = upsertNode(graph, op.key ?? op.name, {
        kind: "character",
        name: op.name,
        description: op.description,
        data: op.data ?? {},
      });
      return `Created character ${graph.getNodeAttribute(key, "name")}.`;
    }
    case "createItem": {
      const key = upsertNode(graph, op.key ?? op.name, {
        kind: "item",
        name: op.name,
        description: op.description,
        tags: op.tags ?? [],
        data: op.data ?? {},
      });
      return `Created item ${graph.getNodeAttribute(key, "name")}.`;
    }
    case "updateLocation":
      updateNode(graph, op.key, "location", op);
      return `Updated location ${graph.getNodeAttribute(findNodeKey(graph, op.key, "location"), "name")}.`;
    case "updateCharacter":
      updateNode(graph, op.key, "character", op);
      return `Updated character ${graph.getNodeAttribute(findNodeKey(graph, op.key, "character"), "name")}.`;
    case "updateItem":
      updateNode(graph, op.key, "item", op);
      return `Updated item ${graph.getNodeAttribute(findNodeKey(graph, op.key, "item"), "name")}.`;
    case "connectLocations": {
      const from = findNodeKey(graph, op.from, "location");
      const to = findNodeKey(graph, op.to, "location");
      setEdge(graph, from, to, "connects_to", op.data ?? {});
      if (op.bidirectional ?? true) setEdge(graph, to, from, "connects_to", op.data ?? {});
      return `Connected ${graph.getNodeAttribute(from, "name")} to ${graph.getNodeAttribute(to, "name")}.`;
    }
    case "disconnectLocations": {
      const from = findNodeKey(graph, op.from, "location");
      const to = findNodeKey(graph, op.to, "location");
      dropEdges(graph, from, "connects_to", to);
      if (op.bidirectional ?? true) dropEdges(graph, to, "connects_to", from);
      return `Disconnected ${graph.getNodeAttribute(from, "name")} from ${graph.getNodeAttribute(to, "name")}.`;
    }
    case "moveCharacter": {
      const character = findNodeKey(graph, op.character, "character");
      const location = findNodeKey(graph, op.to, "location");
      dropEdges(graph, character, "at");
      setEdge(graph, character, location, "at", {});
      graph.mergeNodeAttributes(location, { revealed: true, visited: true });
      return `${graph.getNodeAttribute(character, "name")} moved to ${graph.getNodeAttribute(location, "name")}.`;
    }
    case "placeItem": {
      const item = findNodeKey(graph, op.item, "item");
      const location = findNodeKey(graph, op.location, "location");
      dropEdges(graph, item, "in");
      dropEdges(graph, item, "held_by");
      setEdge(graph, item, location, "in", {});
      return `${graph.getNodeAttribute(item, "name")} was placed in ${graph.getNodeAttribute(location, "name")}.`;
    }
    case "takeItem": {
      const character = findNodeKey(graph, op.character, "character");
      const item = findNodeKey(graph, op.item, "item");
      dropEdges(graph, item, "in");
      dropEdges(graph, item, "held_by");
      setEdge(graph, item, character, "held_by", {});
      return `${graph.getNodeAttribute(character, "name")} picked up ${graph.getNodeAttribute(item, "name")}.`;
    }
    case "dropItem": {
      const character = findNodeKey(graph, op.character, "character");
      const item = findNodeKey(graph, op.item, "item");
      const atEdge = graph.findOutboundEdge(character, (_, attrs) => attrs.kind === "at");
      if (!atEdge) throw new Error(`${graph.getNodeAttribute(character, "name")} is not at a location`);
      const location = graph.target(atEdge);
      dropEdges(graph, item, "held_by", character);
      dropEdges(graph, item, "in");
      setEdge(graph, item, location, "in", {});
      return `${graph.getNodeAttribute(character, "name")} dropped ${graph.getNodeAttribute(item, "name")}.`;
    }
    case "revealLocation": {
      const location = findNodeKey(graph, op.location, "location");
      graph.mergeNodeAttributes(location, { revealed: true });
      return `${graph.getNodeAttribute(location, "name")} was revealed.`;
    }
    case "visitLocation": {
      const location = findNodeKey(graph, op.location, "location");
      graph.mergeNodeAttributes(location, { revealed: true, visited: true });
      return `${graph.getNodeAttribute(location, "name")} was visited.`;
    }
  }
}

function upsertNode(graph: WorldGraphRuntime, keySource: string, attributes: WorldNodeAttributes) {
  const key = normalizeWorldKey(keySource);
  if (graph.hasNode(key)) {
    graph.mergeNodeAttributes(key, attributes);
  } else {
    graph.addNode(key, attributes);
  }
  return key;
}

function updateNode(
  graph: WorldGraphRuntime,
  value: string,
  kind: WorldNodeKind,
  updates: Partial<WorldNodeAttributes> & { data?: Record<string, unknown> },
) {
  const key = findNodeKey(graph, value, kind);
  const current = graph.getNodeAttributes(key);
  graph.mergeNodeAttributes(key, {
    ...updates,
    data: updates.data ? { ...(current.data ?? {}), ...updates.data } : current.data,
  });
}

function setEdge(
  graph: WorldGraphRuntime,
  source: string,
  target: string,
  kind: WorldEdgeKind,
  data: Record<string, unknown>,
) {
  const key = edgeKey(source, kind, target);
  const attributes: WorldEdgeAttributes = { kind, data };
  if (graph.hasEdge(key)) {
    graph.mergeEdgeAttributes(key, attributes);
  } else {
    graph.addDirectedEdgeWithKey(key, source, target, attributes);
  }
}

function dropEdges(graph: WorldGraphRuntime, source: string, kind: WorldEdgeKind, target?: string) {
  for (const edge of graph.edges()) {
    if (graph.source(edge) !== source) continue;
    if (target && graph.target(edge) !== target) continue;
    if (graph.getEdgeAttribute(edge, "kind") !== kind) continue;
    graph.dropEdge(edge);
  }
}

function outboundNodes(
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

function inboundNodes(
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

export function nodeView(graph: WorldGraphRuntime, key: string) {
  return {
    key,
    attributes: graph.getNodeAttributes(key),
  };
}

function edgeKey(source: string, kind: WorldEdgeKind, target: string) {
  return `${source}:${kind}:${target}`;
}
