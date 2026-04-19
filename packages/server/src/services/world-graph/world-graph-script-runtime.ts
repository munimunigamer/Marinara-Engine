// ──────────────────────────────────────────────
// World Graph Script Runtime (QuickJS DSL)
// ──────────────────────────────────────────────
import { getQuickJS } from "quickjs-emscripten";
import type { WorldGraphPatch, WorldNodeKind, WorldPatchOperation } from "@marinara-engine/shared";
import {
  applyWorldPatch,
  explore,
  explorePath,
  findNodeKey,
  hasTraversalNeighbor,
  here,
  nodeView,
  path,
  type WorldGraphRuntime,
} from "./world-graph-runtime.js";
import { buildWorldObservation } from "./world-graph-retrieval.js";

export interface WorldScriptRuntimeOptions {
  maxWallTimeMs?: number;
  maxOps?: number;
  maxPathLength?: number;
  maxJsonBytes?: number;
  memoryLimitBytes?: number;
  stackSizeBytes?: number;
}

export interface WorldScriptRunResult {
  patch: WorldGraphPatch;
  observation: ReturnType<typeof buildWorldObservation>;
  scriptResult: unknown;
}

const DEFAULT_OPTIONS: Required<WorldScriptRuntimeOptions> = {
  maxWallTimeMs: 1_500,
  maxOps: 64,
  maxPathLength: 32,
  maxJsonBytes: 64_000,
  memoryLimitBytes: 4 * 1024 * 1024,
  stackSizeBytes: 512 * 1024,
};

const FORBIDDEN_CODE_PATTERNS = [
  /\bimport\b/,
  /\brequire\s*\(/,
  /\bprocess\b/,
  /\bglobalThis\b/,
  /\bFunction\s*\(/,
  /\beval\s*\(/,
];

export async function runWorldGraphScript(
  graphId: string,
  graph: WorldGraphRuntime,
  code: string,
  options: WorldScriptRuntimeOptions = {},
): Promise<WorldScriptRunResult> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const trimmedCode = code.trim();
  if (!trimmedCode) throw new Error("World script is empty");
  if (FORBIDDEN_CODE_PATTERNS.some((pattern) => pattern.test(trimmedCode))) {
    throw new Error("World script contains unsupported JavaScript features");
  }

  const runtimeGraph = graph.copy() as WorldGraphRuntime;
  const ops: WorldPatchOperation[] = [];
  const events: string[] = [];
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(config.memoryLimitBytes);
  runtime.setMaxStackSize(config.stackSizeBytes);
  const deadline = Date.now() + config.maxWallTimeMs;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();

  const callWorld = (name: string, args: unknown[]) => {
    const result = executeWorldFunction(runtimeGraph, ops, events, config, name, args);
    const payload = JSON.stringify({ ok: true, value: result });
    if (payload.length > config.maxJsonBytes) throw new Error("World script result exceeded JSON size limit");
    return payload;
  };

  try {
    const callHandle = vm.newFunction("__worldCall", (nameHandle, argsHandle) => {
      try {
        const name = vm.getString(nameHandle);
        const argsJson = vm.getString(argsHandle);
        if (argsJson.length > config.maxJsonBytes) throw new Error("World script arguments exceeded JSON size limit");
        const args = JSON.parse(argsJson) as unknown[];
        return vm.newString(callWorld(name, args));
      } catch (error) {
        return vm.newString(
          JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : "World script call failed",
          }),
        );
      }
    });
    vm.setProp(vm.global, "__worldCall", callHandle);
    callHandle.dispose();

    vm.unwrapResult(vm.evalCode(WORLD_DSL_BOOTSTRAP, "world-dsl-bootstrap.js", { type: "global" })).dispose();
    const resultHandle = vm.unwrapResult(vm.evalCode(trimmedCode, "world-script.js", { type: "global" }));
    const scriptResult = vm.dump(resultHandle);
    resultHandle.dispose();

    return {
      patch: { ops, events },
      observation: buildWorldObservation(graphId, runtimeGraph, events),
      scriptResult,
    };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

function executeWorldFunction(
  graph: WorldGraphRuntime,
  ops: WorldPatchOperation[],
  events: string[],
  options: Required<WorldScriptRuntimeOptions>,
  name: string,
  args: unknown[],
) {
  switch (name) {
    case "here":
      return flattenNodeView(here(graph, stringArg(args, 0, "Player")));
    case "observe":
      return flattenObservation(buildWorldObservation("runtime", graph, events, stringArg(args, 0, "Player")));
    case "inventory":
      return inventory(graph, stringArg(args, 0, "Player"));
    case "search":
      return search(graph, stringArg(args, 0), objectArg(args, 1));
    case "findLocation":
      return findOne(graph, stringArg(args, 0), "location");
    case "findItem":
      return findOne(graph, stringArg(args, 0), "item");
    case "findCharacter":
      return findOne(graph, stringArg(args, 0), "character");
    case "path": {
      const route = path(graph, stringArg(args, 0), stringArg(args, 1));
      if (route.locations.length > options.maxPathLength) throw new Error("World path exceeded maximum length");
      return route;
    }
    case "canMove":
      return canMove(graph, stringArg(args, 0), stringArg(args, 1));
    case "move":
      return applyScriptOp(graph, ops, events, options, {
        type: "moveCharacter",
        character: stringArg(args, 0),
        to: stringArg(args, 1),
      });
    case "followPath":
      return followPath(graph, ops, events, options, stringArg(args, 0), stringArrayArg(args, 1));
    case "explore":
      return flattenScene(explore(graph, stringArg(args, 0)));
    case "explorePath":
      return explorePath(graph, stringArrayArg(args, 0)).map(flattenScene);
    case "take":
      return applyScriptOp(graph, ops, events, options, {
        type: "takeItem",
        character: stringArg(args, 0),
        item: stringArg(args, 1),
      });
    case "drop":
      return applyScriptOp(graph, ops, events, options, {
        type: "dropItem",
        character: stringArg(args, 0),
        item: stringArg(args, 1),
      });
    case "place":
      return applyScriptOp(graph, ops, events, options, {
        type: "placeItem",
        item: stringArg(args, 0),
        location: stringArg(args, 1),
      });
    case "createLocation":
      return applyScriptOp(graph, ops, events, options, createLocationOp(objectArg(args, 0)));
    case "createItem":
      return applyScriptOp(graph, ops, events, options, createItemOp(objectArg(args, 0)));
    case "createCharacter":
      return applyScriptOp(graph, ops, events, options, createCharacterOp(objectArg(args, 0)));
    case "connect": {
      const optionsArg = objectArg(args, 2);
      return applyScriptOp(graph, ops, events, options, {
        type: "connectLocations",
        from: stringArg(args, 0),
        to: stringArg(args, 1),
        oneWay: booleanField(optionsArg, "oneWay"),
      });
    }
    case "connectLocations": {
      const input = objectArg(args, 0);
      return applyScriptOp(graph, ops, events, options, {
        type: "connectLocations",
        from: stringField(input, "from"),
        to: stringField(input, "to"),
        oneWay: booleanField(input, "oneWay"),
      });
    }
    case "placeLocation": {
      const input = objectArg(args, 0);
      return applyScriptOp(graph, ops, events, options, {
        type: "placeLocation",
        location: stringField(input, "location"),
        parent: stringField(input, "parent"),
      });
    }
    case "reveal":
      return applyScriptOp(graph, ops, events, options, { type: "revealLocation", location: stringArg(args, 0) });
    case "visit":
      return applyScriptOp(graph, ops, events, options, { type: "visitLocation", location: stringArg(args, 0) });
    default:
      throw new Error(`Unknown world function: ${name}`);
  }
}

function applyScriptOp(
  graph: WorldGraphRuntime,
  ops: WorldPatchOperation[],
  events: string[],
  options: Required<WorldScriptRuntimeOptions>,
  op: WorldPatchOperation,
) {
  if (ops.length >= options.maxOps) throw new Error("World script exceeded maximum operation count");
  const applied = applyWorldPatch(graph, { ops: [op], events: [] });
  ops.push(op);
  events.push(...applied.events);
  return applied.events[0] ?? "OK";
}

function followPath(
  graph: WorldGraphRuntime,
  ops: WorldPatchOperation[],
  events: string[],
  options: Required<WorldScriptRuntimeOptions>,
  character: string,
  locations: string[],
) {
  if (locations.length > options.maxPathLength) throw new Error("World path exceeded maximum length");
  return locations.map((location) =>
    applyScriptOp(graph, ops, events, options, { type: "moveCharacter", character, to: location }),
  );
}

function canMove(graph: WorldGraphRuntime, character: string, location: string) {
  const current = here(graph, character);
  if (!current) return false;
  const targetKey = findNodeKey(graph, location, "location");
  return hasTraversalNeighbor(graph, current.key, targetKey);
}

function inventory(graph: WorldGraphRuntime, character: string) {
  const characterKey = findNodeKey(graph, character, "character");
  return graph
    .inEdges(characterKey)
    .filter((edge) => graph.getEdgeAttribute(edge, "kind") === "held_by")
    .map((edge) => flattenNodeView(nodeView(graph, graph.source(edge))));
}

function search(graph: WorldGraphRuntime, query: string, options: Record<string, unknown>) {
  const needle = query.trim().toLowerCase();
  const types = Array.isArray(options.types) ? new Set(options.types.map(String)) : null;
  const limit = typeof options.limit === "number" ? Math.max(1, Math.min(50, options.limit)) : 10;
  const matches = graph
    .nodes()
    .map((key) => flattenNodeView(nodeView(graph, key)))
    .filter((node) => {
      if (!node) return false;
      if (types && !types.has(String(node.kind))) return false;
      const haystack = [node.name, node.description, ...(Array.isArray(node.tags) ? node.tags : [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  return matches.slice(0, limit);
}

function findOne(graph: WorldGraphRuntime, value: string, kind: WorldNodeKind) {
  try {
    return flattenNodeView(nodeView(graph, findNodeKey(graph, value, kind)));
  } catch {
    return null;
  }
}

function flattenScene(scene: ReturnType<typeof explore>) {
  return {
    location: flattenNodeView(scene.location),
    items: scene.items.map(flattenNodeView),
    characters: scene.characters.map(flattenNodeView),
    exits: scene.exits.map(flattenNodeView),
  };
}

function flattenObservation(observation: ReturnType<typeof buildWorldObservation>) {
  return {
    currentLocation: flattenNodeView(observation.currentLocation),
    currentCharacter: flattenNodeView(observation.currentCharacter),
    inventory: observation.inventory.map(flattenNodeView),
    visibleItems: observation.visibleItems.map(flattenNodeView),
    presentCharacters: observation.presentCharacters.map(flattenNodeView),
    exits: observation.exits.map(flattenNodeView),
    recentEvents: observation.recentEvents,
  };
}

function flattenNodeView(node: ReturnType<typeof nodeView> | null) {
  if (!node) return null;
  return {
    key: node.key,
    ...node.attributes,
  };
}

function stringArg(args: unknown[], index: number, fallback?: string) {
  const value = args[index];
  if (typeof value === "string" && value.trim()) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Expected string argument at position ${index + 1}`);
}

function stringArrayArg(args: unknown[], index: number) {
  const value = args[index];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Expected string array argument at position ${index + 1}`);
  }
  return value;
}

function objectArg(args: unknown[], index: number) {
  const value = args[index];
  return isPlainRecord(value) ? value : {};
}

function stringField(input: Record<string, unknown>, field: string, optional?: boolean) {
  const value = input[field];
  if (typeof value === "string" && value.trim()) return value;
  if (optional) return "";
  throw new Error(`Expected string field "${field}"`);
}

function optionalStringField(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function nullableStringField(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (value === null) return null;
  return optionalStringField(input, field);
}

function booleanField(input: Record<string, unknown>, field: string) {
  return typeof input[field] === "boolean" ? input[field] : undefined;
}

function numberField(input: Record<string, unknown>, field: string) {
  return typeof input[field] === "number" && Number.isFinite(input[field]) ? input[field] : undefined;
}

function stringArrayField(input: Record<string, unknown>, field: string) {
  const value = input[field];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function createLocationOp(input: Record<string, unknown>): WorldPatchOperation {
  return {
    type: "createLocation",
    key: optionalStringField(input, "key"),
    name: stringField(input, "name"),
    description: optionalStringField(input, "description"),
    tags: stringArrayField(input, "tags"),
    lorebookEntryId: nullableStringField(input, "lorebookEntryId"),
    x: numberField(input, "x"),
    y: numberField(input, "y"),
    floor: nullableStringField(input, "floor"),
    revealed: booleanField(input, "revealed"),
    visited: booleanField(input, "visited"),
  };
}

function createItemOp(input: Record<string, unknown>): WorldPatchOperation {
  return {
    type: "createItem",
    key: optionalStringField(input, "key"),
    name: stringField(input, "name"),
    description: optionalStringField(input, "description"),
    tags: stringArrayField(input, "tags"),
    lorebookEntryId: nullableStringField(input, "lorebookEntryId"),
  };
}

function createCharacterOp(input: Record<string, unknown>): WorldPatchOperation {
  return {
    type: "createCharacter",
    key: optionalStringField(input, "key"),
    name: stringField(input, "name"),
    description: optionalStringField(input, "description"),
    lorebookEntryId: nullableStringField(input, "lorebookEntryId"),
    aliases: stringArrayField(input, "aliases"),
    isPlayer: booleanField(input, "isPlayer"),
    personaId: nullableStringField(input, "personaId"),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const WORLD_DSL_BOOTSTRAP = `
const __callWorld = (name, args) => {
  const payload = JSON.parse(__worldCall(name, JSON.stringify(args)));
  if (!payload.ok) throw new Error(payload.error || "World function failed");
  return payload.value;
};

function here(characterName) { return __callWorld("here", [characterName]); }
function observe(characterName) { return __callWorld("observe", [characterName]); }
function inventory(characterName) { return __callWorld("inventory", [characterName]); }
function search(query, options) { return __callWorld("search", [query, options]); }
function findLocation(name) { return __callWorld("findLocation", [name]); }
function findItem(name) { return __callWorld("findItem", [name]); }
function findCharacter(name) { return __callWorld("findCharacter", [name]); }
function path(fromLocation, toLocation) { return __callWorld("path", [fromLocation, toLocation]); }
function canMove(characterName, locationName) { return __callWorld("canMove", [characterName, locationName]); }
function move(characterName, locationName) { return __callWorld("move", [characterName, locationName]); }
function followPath(characterName, locationNames) { return __callWorld("followPath", [characterName, locationNames]); }
function explore(locationName) { return __callWorld("explore", [locationName]); }
function explorePath(locationNames) { return __callWorld("explorePath", [locationNames]); }
function take(characterName, itemName) { return __callWorld("take", [characterName, itemName]); }
function drop(characterName, itemName) { return __callWorld("drop", [characterName, itemName]); }
function place(itemName, locationName) { return __callWorld("place", [itemName, locationName]); }
function createLocation(input) { return __callWorld("createLocation", [input]); }
function createItem(input) { return __callWorld("createItem", [input]); }
function createCharacter(input) { return __callWorld("createCharacter", [input]); }
function connect(fromLocation, toLocation, options) { return __callWorld("connect", [fromLocation, toLocation, options]); }
function connectLocations(input) { return __callWorld("connectLocations", [input]); }
function placeLocation(input) { return __callWorld("placeLocation", [input]); }
function reveal(locationName) { return __callWorld("reveal", [locationName]); }
function visit(locationName) { return __callWorld("visit", [locationName]); }
`;
