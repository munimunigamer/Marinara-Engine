// ──────────────────────────────────────────────
// World Graph Runtime (Graphology-backed)
// ──────────────────────────────────────────────
import Graph from "graphology";
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
export type WorldTraversalNeighborKind = "route" | "parent" | "child";

export interface WorldTraversalNeighbor {
  key: string;
  via: WorldTraversalNeighborKind;
}

export interface WorldPatchApplyResult {
  graph: WorldGraphRuntime;
  generatedEvents: string[];
  events: string[];
}

export function createWorldGraphRuntime(): WorldGraphRuntime {
  return new Graph<WorldNodeAttributes, WorldEdgeAttributes>({ type: "directed", multi: true });
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
  const found = graph.findNode(
    (_, attrs) => attrs.kind === (kind ?? attrs.kind) && attrs.name.toLowerCase() === needle,
  );
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
  const route = findLocationPathKeys(graph, fromKey, toKey);
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
    exits: getLocalTraversalExitViews(graph, locationKey),
  };
}

export function explorePath(graph: WorldGraphRuntime, locations: string[]) {
  return locations.map((location) => explore(graph, location));
}

export function getLocationTraversalNeighbors(graph: WorldGraphRuntime, locationKey: string): WorldTraversalNeighbor[] {
  const neighbors = new Map<string, WorldTraversalNeighborKind>();
  const addNeighbor = (key: string, via: WorldTraversalNeighborKind) => {
    if (key === locationKey) return;
    if (graph.getNodeAttribute(key, "kind") !== "location") return;
    if (!neighbors.has(key)) neighbors.set(key, via);
  };

  for (const edge of graph.outEdges(locationKey)) {
    const kind = graph.getEdgeAttribute(edge, "kind");
    const target = graph.target(edge);
    if (kind === "connects_to") addNeighbor(target, "route");
    if (kind === "in") addNeighbor(target, "parent");
  }

  for (const edge of graph.inEdges(locationKey)) {
    if (graph.getEdgeAttribute(edge, "kind") !== "in") continue;
    addNeighbor(graph.source(edge), "child");
  }

  return [...neighbors.entries()].map(([key, via]) => ({ key, via }));
}

export function hasTraversalNeighbor(graph: WorldGraphRuntime, locationKey: string, targetKey: string) {
  return getLocationTraversalNeighbors(graph, locationKey).some((neighbor) => neighbor.key === targetKey);
}

export function findLocationPathKeys(graph: WorldGraphRuntime, fromKey: string, toKey: string): string[] | null {
  if (fromKey === toKey) return [fromKey];

  const queue: string[] = [fromKey];
  const previous = new Map<string, string | null>([[fromKey, null]]);

  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    for (const neighbor of getLocationTraversalNeighbors(graph, current)) {
      if (previous.has(neighbor.key)) continue;
      previous.set(neighbor.key, current);
      if (neighbor.key === toKey) {
        const route: string[] = [];
        let cursor: string | null = toKey;
        while (cursor) {
          route.push(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        return route.reverse();
      }
      queue.push(neighbor.key);
    }
  }

  return null;
}

function applyOperation(graph: WorldGraphRuntime, op: WorldPatchOperation): string | null {
  switch (op.type) {
    case "createLocation": {
      const key = upsertNode(graph, op.key ?? op.name, {
        kind: "location",
        name: op.name,
        description: op.description,
        tags: op.tags ?? [],
        lorebookEntryId: op.lorebookEntryId ?? null,
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
        lorebookEntryId: op.lorebookEntryId ?? null,
        aliases: op.aliases ?? [],
        isPlayer: op.isPlayer ?? false,
        personaId: op.personaId ?? null,
      });
      return `Created character ${graph.getNodeAttribute(key, "name")}.`;
    }
    case "createItem": {
      const key = upsertNode(graph, op.key ?? op.name, {
        kind: "item",
        name: op.name,
        description: op.description,
        tags: op.tags ?? [],
        lorebookEntryId: op.lorebookEntryId ?? null,
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
      const edgeAttributes = { oneWay: op.oneWay === true ? true : undefined };
      setEdge(graph, from, to, "connects_to", edgeAttributes);
      if (!op.oneWay) {
        setEdge(graph, to, from, "connects_to", {});
      }
      return `Connected ${graph.getNodeAttribute(from, "name")} to ${graph.getNodeAttribute(to, "name")}.`;
    }
    case "disconnectLocations": {
      const from = findNodeKey(graph, op.from, "location");
      const to = findNodeKey(graph, op.to, "location");
      dropEdges(graph, from, "connects_to", to);
      if (!op.oneWay) dropEdges(graph, to, "connects_to", from);
      return `Disconnected ${graph.getNodeAttribute(from, "name")} from ${graph.getNodeAttribute(to, "name")}.`;
    }
    case "placeLocation": {
      const location = findNodeKey(graph, op.location, "location");
      const parent = findNodeKey(graph, op.parent, "location");
      if (location === parent) throw new Error("A location cannot contain itself");
      dropEdges(graph, location, "in");
      setEdge(graph, location, parent, "in", {});
      return `${graph.getNodeAttribute(location, "name")} was placed inside ${graph.getNodeAttribute(parent, "name")}.`;
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
  updates: Partial<WorldNodeAttributes>,
) {
  const key = findNodeKey(graph, value, kind);
  const sanitized = sanitizeNodeUpdates(updates);
  graph.mergeNodeAttributes(key, sanitized);
}

function setEdge(
  graph: WorldGraphRuntime,
  source: string,
  target: string,
  kind: WorldEdgeKind,
  attributes: Partial<WorldEdgeAttributes>,
) {
  const key = edgeKey(source, kind, target);
  const existing = findEdgeByKind(graph, source, target, kind);
  if (existing) {
    graph.mergeEdgeAttributes(existing, {
      kind,
      ...attributes,
    });
    dropDuplicateKindEdges(graph, source, target, kind, existing);
    return;
  }

  graph.addDirectedEdgeWithKey(key, source, target, { kind, ...attributes });
}

function dropEdges(graph: WorldGraphRuntime, source: string, kind: WorldEdgeKind, target?: string) {
  for (const edge of graph.edges()) {
    if (graph.source(edge) !== source) continue;
    if (target && graph.target(edge) !== target) continue;
    if (graph.getEdgeAttribute(edge, "kind") !== kind) continue;
    graph.dropEdge(edge);
  }
}

export function getLocalTraversalExitViews(graph: WorldGraphRuntime, locationKey: string) {
  return getLocationTraversalNeighbors(graph, locationKey)
    .filter((neighbor) => neighbor.via !== "route" || isVisibleLocation(graph, neighbor.key))
    .map((neighbor) => nodeView(graph, neighbor.key));
}

function outboundNodes(graph: WorldGraphRuntime, source: string, edgeKind: WorldEdgeKind, targetKind: WorldNodeKind) {
  return graph
    .outEdges(source)
    .filter((edge) => graph.getEdgeAttribute(edge, "kind") === edgeKind)
    .map((edge) => graph.target(edge))
    .filter((key) => graph.getNodeAttribute(key, "kind") === targetKind)
    .map((key) => nodeView(graph, key));
}

function inboundNodes(graph: WorldGraphRuntime, target: string, edgeKind: WorldEdgeKind, sourceKind: WorldNodeKind) {
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

function isVisibleLocation(graph: WorldGraphRuntime, key: string) {
  const attrs = graph.getNodeAttributes(key);
  return attrs.kind !== "location" || attrs.revealed !== false || attrs.visited === true;
}

function edgeKey(source: string, kind: WorldEdgeKind, target: string) {
  return `${source}:${kind}:${target}`;
}

function findEdgeByKind(graph: WorldGraphRuntime, source: string, target: string, kind: WorldEdgeKind) {
  return graph.outEdges(source, target).find((edge) => graph.getEdgeAttribute(edge, "kind") === kind);
}

function dropDuplicateKindEdges(
  graph: WorldGraphRuntime,
  source: string,
  target: string,
  kind: WorldEdgeKind,
  keepEdge: string,
) {
  for (const edge of graph.outEdges(source, target)) {
    if (edge === keepEdge) continue;
    if (graph.getEdgeAttribute(edge, "kind") !== kind) continue;
    graph.dropEdge(edge);
  }
}

function sanitizeNodeUpdates(updates: Partial<WorldNodeAttributes>) {
  const rest = updates as Partial<WorldNodeAttributes> & {
    type?: string;
    key?: string;
  };

  const sanitized: Partial<WorldNodeAttributes> = {};
  for (const [field, value] of Object.entries(rest)) {
    if (field === "type" || field === "key") continue;
    if (value === undefined) continue;
    (sanitized as Record<string, unknown>)[field] = value;
  }
  return sanitized;
}
