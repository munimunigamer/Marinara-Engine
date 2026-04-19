import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorldGraphSyncSettings } from "@marinara-engine/shared";
import { buildWorldObservation } from "./world-graph-retrieval.js";
import { applyWorldPatch, createWorldGraphRuntime, path } from "./world-graph-runtime.js";
import { reviewWorldGraphTopology } from "./world-graph-topology.js";

function buildGraph(ops: Parameters<typeof applyWorldPatch>[1]["ops"]) {
  const graph = createWorldGraphRuntime();
  applyWorldPatch(graph, { ops, events: [] });
  return graph;
}

test("recursive containment supports sibling travel without duplicate routes", () => {
  const graph = buildGraph([
    { type: "createCharacter", key: "player", name: "Player" },
    { type: "createLocation", key: "school", name: "School" },
    { type: "createLocation", key: "class-a", name: "Class A" },
    { type: "createLocation", key: "class-b", name: "Class B" },
    { type: "createLocation", key: "courtyard", name: "Courtyard" },
    { type: "placeLocation", location: "class-a", parent: "school" },
    { type: "placeLocation", location: "class-b", parent: "school" },
    { type: "connectLocations", from: "school", to: "courtyard" },
    { type: "moveCharacter", character: "player", to: "class-a" },
  ]);

  assert.deepEqual(path(graph, "Class A", "Class B").locations, ["Class A", "School", "Class B"]);

  const classObservation = buildWorldObservation("graph", graph, [], "Player");
  assert.deepEqual(
    classObservation.exits.map((node) => node.attributes.name),
    ["School"],
  );

  applyWorldPatch(graph, {
    ops: [{ type: "moveCharacter", character: "player", to: "school" }],
    events: [],
  });

  const schoolObservation = buildWorldObservation("graph", graph, [], "Player");
  assert.deepEqual(
    new Set(schoolObservation.exits.map((node) => node.attributes.name)),
    new Set(["Class A", "Class B", "Courtyard"]),
  );
});

test("recursive containment traverses through deep nested parents", () => {
  const graph = buildGraph([
    { type: "createLocation", key: "region", name: "Region" },
    { type: "createLocation", key: "town", name: "Town" },
    { type: "createLocation", key: "school", name: "School" },
    { type: "createLocation", key: "classroom", name: "Classroom" },
    { type: "placeLocation", location: "town", parent: "region" },
    { type: "placeLocation", location: "school", parent: "town" },
    { type: "placeLocation", location: "classroom", parent: "school" },
  ]);

  assert.deepEqual(path(graph, "Region", "Classroom").locations, ["Region", "Town", "School", "Classroom"]);
  assert.deepEqual(path(graph, "Classroom", "Town").locations, ["Classroom", "School", "Town"]);
});

test("topology review allows explicit one-way routes but flags accidental missing return paths", () => {
  const oneWayGraph = buildGraph([
    { type: "createLocation", key: "a", name: "A" },
    { type: "createLocation", key: "b", name: "B" },
    { type: "connectLocations", from: "a", to: "b", oneWay: true },
  ]);
  assert.deepEqual(reviewWorldGraphTopology(oneWayGraph).issues, []);

  const missingReturnGraph = buildGraph([
    { type: "createLocation", key: "a", name: "A" },
    { type: "createLocation", key: "b", name: "B" },
    {
      type: "connectLocations",
      from: "a",
      to: "b",
      oneWay: true,
    },
  ]);
  const edge = missingReturnGraph.edges().find((candidate) => missingReturnGraph.getEdgeAttribute(candidate, "kind") === "connects_to");
  if (edge) {
    missingReturnGraph.mergeEdgeAttributes(edge, { oneWay: false });
  }
  assert.ok(
    reviewWorldGraphTopology(missingReturnGraph).issues.some((issue) => issue.includes('Route "A" -> "B" is missing a return path.')),
  );
});

test("topology review detects disconnected location components", () => {
  const graph = buildGraph([
    { type: "createLocation", key: "school", name: "School" },
    { type: "createLocation", key: "classroom", name: "Classroom" },
    { type: "placeLocation", location: "classroom", parent: "school" },
    { type: "createLocation", key: "forest", name: "Forest" },
  ]);

  assert.ok(
    reviewWorldGraphTopology(graph).issues.some((issue) => issue.includes("Disconnected location component: Forest.")),
  );
});

test("topology review flags unplaced characters and items", () => {
  const graph = buildGraph([
    { type: "createLocation", key: "school", name: "School" },
    { type: "createCharacter", key: "player", name: "Player" },
    { type: "createCharacter", key: "teacher", name: "Teacher" },
    { type: "createItem", key: "book", name: "Book" },
  ]);

  const issues = reviewWorldGraphTopology(graph).issues;
  assert.ok(issues.some((issue) => issue.includes('Character "Player" is not placed in any location.')));
  assert.ok(issues.some((issue) => issue.includes('Character "Teacher" is not placed in any location.')));
  assert.ok(issues.some((issue) => issue.includes('Item "Book" is not placed in any location or held by any character.')));
});

test("legacy sync settings normalize down to chunk size only", () => {
  assert.deepEqual(
    resolveWorldGraphSyncSettings({
      syncProfile: "full",
      syncEntryDetail: "full",
      syncSceneMessageCount: 99,
      syncValidateDraftChunks: true,
      syncFinalRouteReview: true,
      syncMaxDraftRepairAttempts: 4,
      syncMaxFinalRepairAttempts: 5,
      syncChunkCharLimit: 42_000,
    }),
    { syncChunkCharLimit: 42_000 },
  );
});
