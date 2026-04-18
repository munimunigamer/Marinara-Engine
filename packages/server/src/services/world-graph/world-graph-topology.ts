// ──────────────────────────────────────────────
// World Graph Topology Review
// ──────────────────────────────────────────────
import { getLocationTraversalNeighbors, type WorldGraphRuntime } from "./world-graph-runtime.js";

export interface WorldGraphTopologyReview {
  issues: string[];
}

export function reviewWorldGraphTopology(graph: WorldGraphRuntime): WorldGraphTopologyReview {
  const issues: string[] = [];

  for (const edge of graph.edges()) {
    if (graph.getEdgeAttribute(edge, "kind") !== "connects_to") continue;
    const source = graph.source(edge);
    const target = graph.target(edge);
    const edgeAttrs = graph.getEdgeAttributes(edge);
    if (edgeAttrs.oneWay === true) continue;

    const reverseExists = graph
      .outEdges(target, source)
      .some((candidate) => graph.getEdgeAttribute(candidate, "kind") === "connects_to");
    if (reverseExists) continue;

    issues.push(
      `Route "${graph.getNodeAttribute(source, "name")}" -> "${graph.getNodeAttribute(target, "name")}" is missing a return path.`,
    );
  }

  const locationKeys = graph.nodes().filter((key) => graph.getNodeAttribute(key, "kind") === "location");
  if (locationKeys.length > 1) {
    const disconnectedComponents = findDisconnectedLocationComponents(graph, locationKeys);
    for (const component of disconnectedComponents.slice(1)) {
      const names = component
        .map((key) => String(graph.getNodeAttribute(key, "name")))
        .sort((a, b) => a.localeCompare(b));
      issues.push(`Disconnected location component: ${names.join(", ")}.`);
    }
  }

  for (const key of graph.nodes()) {
    const kind = graph.getNodeAttribute(key, "kind");
    if (kind === "character") {
      const atTargets = graph
        .outEdges(key)
        .filter((edge) => graph.getEdgeAttribute(edge, "kind") === "at")
        .map((edge) => graph.target(edge));
      if (atTargets.length === 0) {
        issues.push(`Character "${graph.getNodeAttribute(key, "name")}" is not placed in any location.`);
      } else if (atTargets.length > 1) {
        issues.push(`Character "${graph.getNodeAttribute(key, "name")}" is placed in multiple locations.`);
      }
    }

    if (kind === "item") {
      const locationTargets = graph
        .outEdges(key)
        .filter((edge) => graph.getEdgeAttribute(edge, "kind") === "in")
        .map((edge) => graph.target(edge));
      const holderTargets = graph
        .outEdges(key)
        .filter((edge) => graph.getEdgeAttribute(edge, "kind") === "held_by")
        .map((edge) => graph.target(edge));
      const totalPlacements = locationTargets.length + holderTargets.length;
      if (totalPlacements === 0) {
        issues.push(`Item "${graph.getNodeAttribute(key, "name")}" is not placed in any location or held by any character.`);
      } else if (totalPlacements > 1) {
        issues.push(`Item "${graph.getNodeAttribute(key, "name")}" has multiple placements.`);
      }
    }
  }

  return { issues };
}

function findDisconnectedLocationComponents(graph: WorldGraphRuntime, locationKeys: string[]) {
  const adjacency = new Map<string, Set<string>>();
  for (const key of locationKeys) {
    adjacency.set(key, new Set<string>());
  }

  for (const key of locationKeys) {
    for (const neighbor of getLocationTraversalNeighbors(graph, key)) {
      adjacency.get(key)?.add(neighbor.key);
      adjacency.get(neighbor.key)?.add(key);
    }
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const start of locationKeys) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const queue: string[] = [start];
    visited.add(start);

    for (let index = 0; index < queue.length; index++) {
      const current = queue[index]!;
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    components.push(component);
  }

  components.sort((a, b) => b.length - a.length);
  return components;
}
