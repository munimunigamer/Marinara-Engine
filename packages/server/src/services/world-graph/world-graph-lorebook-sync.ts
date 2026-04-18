// ──────────────────────────────────────────────
// World Graph Lorebook Sync (Structured Incremental Fold)
// ──────────────────────────────────────────────
import type { BaseLLMProvider } from "../llm/base-provider.js";
import type { Lorebook, LorebookEntry, WorldGraphPatch, WorldGraphSyncSettings } from "@marinara-engine/shared";
import {
  WORLD_GRAPH_SYNC_MAX_CHUNK_REPAIR_ATTEMPTS,
  WORLD_GRAPH_SYNC_MAX_FINAL_REPAIR_ATTEMPTS,
  WORLD_GRAPH_SYNC_PREVIEW_CHARS,
} from "@marinara-engine/shared";
import { applyWorldPatch, createWorldGraphRuntime, type WorldGraphRuntime } from "./world-graph-runtime.js";
import { runWorldGraphScript } from "./world-graph-script-runtime.js";
import { reviewWorldGraphTopology } from "./world-graph-topology.js";

type LorebookWithEntries = Lorebook & { entries: LorebookEntry[] };

interface SceneContext {
  characterNames: string[];
  personaName: string;
  personaDescription?: string | null;
  currentLocation?: string | null;
  recentMessages: Array<{ role: string; name?: string; content: string }>;
  summary?: string | null;
}

interface BuildLorebookGraphInput {
  provider: BaseLLMProvider;
  model: string;
  lorebooks: LorebookWithEntries[];
  scene: SceneContext;
  settings: WorldGraphSyncSettings;
}

interface StructuredPatchRequestInput {
  provider: BaseLLMProvider;
  model: string;
  runtime: WorldGraphRuntime;
  stageLabel: string;
  userPrompt: string;
  maxRepairAttempts: number;
}

interface StructuredPatchResult {
  patch: WorldGraphPatch;
  repairAttempts: number;
}

const MAX_STATE_DIGEST_CHARS = 14_000;
const MAX_VALIDATION_ERROR_CHARS = 2_000;

const QUICKJS_WORLD_DSL_REFERENCE = `QuickJS world DSL reference:

The code string is executed in QuickJS as plain JavaScript.
Allowed:
- simple statements
- const / let
- if / else
- arrays and object literals

Do not use:
- TypeScript types
- import / export
- classes
- async / await
- external libraries
- eval / Function / process / globalThis
- helper function declarations unless absolutely necessary

Readable helper functions available:
- here(characterName)
- observe(characterName)
- inventory(characterName)
- search(query, { types?: ["location" | "character" | "item"], limit?: number })
- findLocation(nameOrKey)
- findItem(nameOrKey)
- findCharacter(nameOrKey)
- path(fromLocation, toLocation)
- canMove(characterName, locationName)
- explore(locationName)
- explorePath(locationNames)

Mutation functions available:
- createLocation({ key?, name, description?, lorebookEntryId? })
- createCharacter({ key?, name, description?, lorebookEntryId?, aliases?, isPlayer?, personaId? })
- createItem({ key?, name, description?, lorebookEntryId? })
- connectLocations({ from, to, oneWay? })
- placeLocation({ location, parent })
- move(characterNameOrKey, locationNameOrKey)
- place(itemNameOrKey, locationNameOrKey)
- take(characterNameOrKey, itemNameOrKey)
- drop(characterNameOrKey, itemNameOrKey)
- reveal(locationNameOrKey)
- visit(locationNameOrKey)

Preferred patterns:
- Upsert player:
  createCharacter({ key: "player", name: "...", description: "..." });
- Upsert an existing location:
  createLocation({ key: "...", name: "...", description: "..." });
- Place a child location:
  placeLocation({ location: "...", parent: "..." });
- Move the player:
  move("player", "...");`;

const STRUCTURED_WORLD_GRAPH_SYSTEM_PROMPT = `You incrementally build a roleplay world graph from lorebook chunks.

Return raw JSON only with this shape: { "code": "..." }.
- Do not return prose explanations.
- Do not return markdown fences.
- The code field must contain QuickJS-compatible world DSL.

Core rules:
- Treat the current world state as canon unless the new chunk clearly adds or refines it.
- Never split or reinterpret entities across multiple ids when an existing id clearly matches.
- When referencing existing nodes, use the exact ids from the current world state digest.
- When a node comes directly from a lorebook entry, set lorebookEntryId to that entry's id.
- Create nodes before operations that reference them.
- Prefer updating existing nodes instead of creating near-duplicates.
- Use connectLocations only for traversable travel routes.
- Use placeLocation for containment or hierarchy: room in building, island in sea, district in city, region in country.
- Containment is already traversable through recursive parent/child movement. Do not add duplicate connectLocations edges just because one location is inside another.
- Use the tracked current location and recent messages to decide where the player, present characters, and scene items belong.
- Every character must end up in exactly one location.
- Every item must end up either in exactly one location or held by exactly one character.
- Keep descriptions concise and factual.
- Be conservative. If the chunk does not justify a mutation, return { "code": "" }.

${QUICKJS_WORLD_DSL_REFERENCE}

Examples:
{ "code": "createLocation({ key: \\"...\\", name: \\"...\\" });\\nplaceLocation({ location: \\"...\\", parent: \\"...\\" });" }
{ "code": "createCharacter({ key: \\"player\\", name: \\"...\\", description: \\"...\\" });\\nmove(\\"player\\", \\"...\\");\\nreveal(\\"...\\");" }`;

export async function buildWorldGraphPatchFromLorebooks(input: BuildLorebookGraphInput) {
  const entries = input.lorebooks.flatMap((book) => book.entries.map((entry) => ({ book, entry })));
  const chunks = chunkEntries(entries, input.settings.syncChunkCharLimit);
  const effectiveChunks = chunks.length > 0 ? chunks : [[]];
  const runtime = createWorldGraphRuntime();
  const aggregateOps: WorldGraphPatch["ops"] = [];
  let totalRepairAttempts = 0;

  const playerPatch = createPlayerBootstrapPatch(input.scene);
  if (playerPatch.ops.length > 0) {
    applyWorldPatch(runtime, playerPatch);
    aggregateOps.push(...playerPatch.ops);
  }

  for (let index = 0; index < effectiveChunks.length; index++) {
    const patchResult = await requestStructuredPatchWithRetries({
      provider: input.provider,
      model: input.model,
      runtime,
      stageLabel: `chunk ${index + 1}/${effectiveChunks.length}`,
      userPrompt: buildChunkPrompt({
        chunkIndex: index,
        chunkCount: effectiveChunks.length,
        chunkEntries: effectiveChunks[index] ?? [],
        scene: input.scene,
        runtime,
      }),
      maxRepairAttempts: WORLD_GRAPH_SYNC_MAX_CHUNK_REPAIR_ATTEMPTS,
    });

    totalRepairAttempts += patchResult.repairAttempts;
    if (patchResult.patch.ops.length === 0) continue;
    applyWorldPatch(runtime, patchResult.patch);
    aggregateOps.push(...patchResult.patch.ops);
  }

  let review = reviewWorldGraphTopology(runtime);
  let lastReviewError = review.issues[0] ?? "";

  for (let attempt = 0; attempt < WORLD_GRAPH_SYNC_MAX_FINAL_REPAIR_ATTEMPTS && review.issues.length > 0; attempt++) {
    totalRepairAttempts += 1;

    try {
      const patchResult = await requestStructuredPatchWithRetries({
        provider: input.provider,
        model: input.model,
        runtime,
        stageLabel: `final topology repair ${attempt + 1}/${WORLD_GRAPH_SYNC_MAX_FINAL_REPAIR_ATTEMPTS}`,
        userPrompt: buildFinalRepairPrompt(runtime, review),
        maxRepairAttempts: 0,
      });

      if (patchResult.patch.ops.length === 0) {
        throw new Error("Final topology repair returned no graph mutations.");
      }

      applyWorldPatch(runtime, patchResult.patch);
      aggregateOps.push(...patchResult.patch.ops);
      review = reviewWorldGraphTopology(runtime);
      lastReviewError = review.issues[0] ?? lastReviewError;
    } catch (error) {
      lastReviewError = error instanceof Error ? error.message : "Final topology repair failed";
    }
  }

  if (review.issues.length > 0) {
    throw new Error(
      `World graph topology validation failed after ${WORLD_GRAPH_SYNC_MAX_FINAL_REPAIR_ATTEMPTS} repair attempt(s): ${lastReviewError || review.issues[0]}`,
    );
  }

  const patch: WorldGraphPatch = {
    ops: aggregateOps,
    events: [],
    result: {
      source: "lorebook_structured_sync",
      batchCount: effectiveChunks.length,
      repairAttempts: totalRepairAttempts,
    },
  };

  return {
    patch,
    stats: {
      lorebookCount: input.lorebooks.length,
      entryCount: entries.length,
      batchCount: effectiveChunks.length,
      operationCount: patch.ops.length,
    },
  };
}

async function requestStructuredPatchWithRetries(input: StructuredPatchRequestInput): Promise<StructuredPatchResult> {
  let lastError = "";

  for (let attempt = 0; attempt <= input.maxRepairAttempts; attempt++) {
    try {
      const patch = await requestStructuredPatch({
        provider: input.provider,
        model: input.model,
        runtime: input.runtime,
        userPrompt: buildRepairAwarePrompt(input.userPrompt, attempt > 0 ? lastError : ""),
      });
      return {
        patch,
        repairAttempts: attempt,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Structured patch validation failed";
      if (attempt === input.maxRepairAttempts) {
        throw new Error(`World graph ${input.stageLabel} failed after ${attempt + 1} attempt(s): ${lastError}`);
      }
    }
  }

  throw new Error(`World graph ${input.stageLabel} exhausted its repair loop`);
}

async function requestStructuredPatch(input: {
  provider: BaseLLMProvider;
  model: string;
  runtime: WorldGraphRuntime;
  userPrompt: string;
}): Promise<WorldGraphPatch> {
  const requestMessages = [
    { role: "system" as const, content: STRUCTURED_WORLD_GRAPH_SYSTEM_PROMPT },
    { role: "user" as const, content: input.userPrompt },
  ];
  const requestOptions = {
    model: input.model,
    temperature: 0.15,
    maxTokens: 8_192,
  };

  const result = await input.provider.chatComplete(requestMessages, requestOptions);

  const patchCandidate = parseJsonCodeCandidate(result.content ?? "");
  return validateStructuredCodePatch(input.runtime, patchCandidate);
}

function buildRepairAwarePrompt(basePrompt: string, validationError?: string) {
  if (!validationError?.trim()) return basePrompt;
  return [
    basePrompt,
    ``,
    `<validation_error>`,
    validationError.slice(0, MAX_VALIDATION_ERROR_CHARS),
    `</validation_error>`,
  ].join("\n");
}

function buildChunkPrompt(input: {
  chunkIndex: number;
  chunkCount: number;
  chunkEntries: Array<{ book: Lorebook; entry: LorebookEntry }>;
  scene: SceneContext;
  runtime: WorldGraphRuntime;
}) {
  return [
    `Process lorebook chunk ${input.chunkIndex + 1}/${input.chunkCount}.`,
    `Return one incremental structured JSON object with a code string only.`,
    ``,
    `<current_scene_context>`,
    formatSceneContext(input.scene),
    `</current_scene_context>`,
    ``,
    `<current_world_state_digest>`,
    buildWorldStateDigest(input.runtime).slice(0, MAX_STATE_DIGEST_CHARS),
    `</current_world_state_digest>`,
    ``,
    `<lorebook_chunk>`,
    formatEntries(input.chunkEntries) ||
      "(No lorebook entries in this chunk. Create only minimal scene-facing state if clearly justified.)",
    `</lorebook_chunk>`,
  ].join("\n");
}

function buildFinalRepairPrompt(runtime: WorldGraphRuntime, review: ReturnType<typeof reviewWorldGraphTopology>) {
  return [
    `Repair only the listed topology issues in the current world graph.`,
    `Return one incremental structured JSON object with a code string only.`,
    `Do not recreate the whole graph.`,
    `Containment is already traversable through parent/child movement, so do not add duplicate routes just because a location is inside another location.`,
    `For normal travel routes, add the missing return path unless the route is clearly one-way.`,
    `For disconnected locations, either place them into the right containment tree or connect them with a real travel route justified by the existing graph.`,
    `Use the tracked current location and recent messages to decide where the player, present characters, and scene items belong.`,
    `Every character must be in exactly one location.`,
    `Every item must be either in exactly one location or held by exactly one character.`,
    ``,
    `<graph_review_issues>`,
    review.issues.join("\n"),
    `</graph_review_issues>`,
    ``,
    `<current_world_state_digest>`,
    buildWorldStateDigest(runtime).slice(0, MAX_STATE_DIGEST_CHARS),
    `</current_world_state_digest>`,
  ].join("\n");
}

function createPlayerBootstrapPatch(scene: SceneContext): WorldGraphPatch {
  const playerName = scene.personaName?.trim() || "Player";
  const playerDescription = scene.personaDescription?.trim() || `The player's persona, ${playerName}.`;
  return {
    ops: [
      {
        type: "createCharacter",
        key: "player",
        name: playerName,
        description: playerDescription,
        aliases: Array.from(new Set(["Player", playerName])).filter(Boolean),
        isPlayer: true,
      },
    ],
    events: [],
  };
}

function buildWorldStateDigest(graph: WorldGraphRuntime) {
  const playerLocationKey = findPlayerLocationKey(graph);
  const playerLocationName = playerLocationKey ? String(graph.getNodeAttribute(playerLocationKey, "name")) : "";
  const presentCharacterIds =
    playerLocationKey === null
      ? []
      : graph
          .inEdges(playerLocationKey)
          .filter((edge) => graph.getEdgeAttribute(edge, "kind") === "at")
          .map((edge) => graph.source(edge))
          .filter((key) => key !== "player");
  const visibleLocationIds = graph
    .nodes()
    .filter(
      (key) => graph.getNodeAttribute(key, "kind") === "location" && graph.getNodeAttribute(key, "revealed") === true,
    );

  const nodeIds = graph.nodes().sort((a, b) => {
    const aAttrs = graph.getNodeAttributes(a);
    const bAttrs = graph.getNodeAttributes(b);
    const aPriority = digestNodePriority(a, aAttrs.kind as string, playerLocationKey);
    const bPriority = digestNodePriority(b, bAttrs.kind as string, playerLocationKey);
    if (aPriority !== bPriority) return aPriority - bPriority;
    return String(aAttrs.name).localeCompare(String(bAttrs.name));
  });

  const nodeLines: string[] = [];
  let omittedNodes = 0;
  for (const key of nodeIds) {
    const attrs = graph.getNodeAttributes(key);
    const flags = [
      attrs.kind === "location" && attrs.revealed ? "revealed" : "",
      attrs.kind === "location" && attrs.visited ? "visited" : "",
      key === "player" ? "player" : "",
      key === playerLocationKey ? "current_location" : "",
    ]
      .filter(Boolean)
      .join(",");
    const line = [
      `[${key}]`,
      attrs.kind,
      attrs.name,
      attrs.aliases?.length ? `aliases=${attrs.aliases.join(",")}` : "",
      attrs.lorebookEntryId ? `lorebookEntryId=${attrs.lorebookEntryId}` : "",
      attrs.tags?.length ? `tags=${attrs.tags.join(",")}` : "",
      attrs.description ? `desc=${buildPreviewText(attrs.description, 140)}` : "",
      attrs.floor ? `floor=${attrs.floor}` : "",
      flags ? `flags=${flags}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    if (currentDigestSize(nodeLines, []) + line.length > MAX_STATE_DIGEST_CHARS * 0.66) {
      omittedNodes = nodeIds.length - nodeLines.length;
      break;
    }
    nodeLines.push(line);
  }

  const edgeIds = graph.edges().sort((a, b) => {
    const aSource = graph.source(a);
    const bSource = graph.source(b);
    if (aSource !== bSource) return aSource.localeCompare(bSource);
    return graph.target(a).localeCompare(graph.target(b));
  });

  const edgeLines: string[] = [];
  let omittedEdges = 0;
  for (const edge of edgeIds) {
    const attrs = graph.getEdgeAttributes(edge);
    const line = [
      `[${graph.source(edge)}]`,
      `-${attrs.kind}${attrs.oneWay ? "(one-way)" : ""}->`,
      `[${graph.target(edge)}]`,
    ].join(" ");
    if (currentDigestSize(nodeLines, edgeLines) + line.length > MAX_STATE_DIGEST_CHARS) {
      omittedEdges = edgeIds.length - edgeLines.length;
      break;
    }
    edgeLines.push(line);
  }

  return [
    `Current scene: player=player${playerLocationName ? ` | player_location=${playerLocationName}` : ""}`,
    presentCharacterIds.length ? `Present characters: ${presentCharacterIds.join(", ")}` : `Present characters: (none)`,
    visibleLocationIds.length ? `Visible locations: ${visibleLocationIds.join(", ")}` : `Visible locations: (none)`,
    `Nodes:`,
    nodeLines.join("\n") || "(none)",
    omittedNodes > 0 ? `... ${omittedNodes} more node(s) omitted ...` : "",
    `Edges:`,
    edgeLines.join("\n") || "(none)",
    omittedEdges > 0 ? `... ${omittedEdges} more edge(s) omitted ...` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function currentDigestSize(nodeLines: string[], edgeLines: string[]) {
  return nodeLines.join("\n").length + edgeLines.join("\n").length;
}

function digestNodePriority(nodeId: string, kind: string, playerLocationKey: string | null) {
  if (nodeId === "player") return 0;
  if (nodeId === playerLocationKey) return 1;
  if (kind === "location") return 2;
  if (kind === "character") return 3;
  return 4;
}

function findPlayerLocationKey(graph: WorldGraphRuntime) {
  if (!graph.hasNode("player")) return null;
  const atEdge = graph.outEdges("player").find((edge) => graph.getEdgeAttribute(edge, "kind") === "at");
  return atEdge ? graph.target(atEdge) : null;
}

function formatEntries(entries: Array<{ book: Lorebook; entry: LorebookEntry }>) {
  return entries.map((item) => formatEntry(item)).join("\n\n");
}

function formatEntry({ book, entry }: { book: Lorebook; entry: LorebookEntry }) {
  return [
    `<entry id="${entry.id}" lorebook="${escapeAttr(book.name)}" category="${escapeAttr(book.category)}">`,
    `Name: ${entry.name}`,
    entry.keys.length ? `Keys: ${entry.keys.join(", ")}` : "",
    entry.secondaryKeys.length ? `Secondary keys: ${entry.secondaryKeys.join(", ")}` : "",
    entry.tag ? `Tag: ${entry.tag}` : "",
    entry.group ? `Group: ${entry.group}` : "",
    `Content Preview:`,
    buildPreviewText(entry.content, WORLD_GRAPH_SYNC_PREVIEW_CHARS) || "(empty)",
    `</entry>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function chunkEntries(entries: Array<{ book: Lorebook; entry: LorebookEntry }>, chunkCharLimit: number) {
  const chunks: Array<Array<{ book: Lorebook; entry: LorebookEntry }>> = [];
  let current: Array<{ book: Lorebook; entry: LorebookEntry }> = [];
  let currentSize = 0;

  for (const item of entries) {
    const size = formatEntry(item).length + 2;
    if (current.length > 0 && currentSize + size > chunkCharLimit) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(item);
    currentSize += size;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function formatSceneContext(scene: SceneContext) {
  return [
    `Persona/player display name: ${scene.personaName || "Player"}`,
    scene.personaDescription ? `Persona description: ${scene.personaDescription}` : "",
    scene.currentLocation ? `Tracked current location: ${scene.currentLocation}` : "",
    scene.characterNames.length ? `Chat characters: ${scene.characterNames.join(", ")}` : `Chat characters: (none)`,
    scene.summary ? `Chat summary: ${scene.summary}` : "",
    `Recent messages:`,
    scene.recentMessages
      .map((message) => {
        const speaker = message.name || message.role;
        return `${speaker}: ${collapseWhitespace(message.content).slice(0, 900)}`;
      })
      .join("\n\n") || "(none)",
  ]
    .filter(Boolean)
    .join("\n");
}

async function validateStructuredCodePatch(runtime: WorldGraphRuntime, patchCandidate: unknown) {
  const code = extractStructuredCode(patchCandidate);
  const script = extractWorldScript(code);
  if (!script) {
    return {
      ops: [],
      events: [],
    } satisfies WorldGraphPatch;
  }

  const scriptResult = await runWorldGraphScript("lorebook-sync", runtime, script, {
    maxOps: 512,
  });
  return scriptResult.patch;
}

function parseJsonCodeCandidate(raw: string) {
  if (!raw.trim()) throw new Error('Model returned no structured world graph JSON object');
  return JSON.parse(extractJson(raw));
}

function extractStructuredCode(value: unknown) {
  if (!isRecord(value) || typeof value.code !== "string") {
    throw new Error('Model must return raw JSON with shape { "code": "..." }');
  }
  return value.code;
}

function extractJson(text: string): string {
  // Try markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) text = fenceMatch[1]!.trim();
  else {
    // Try to find a bare JSON object or array
    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) text = jsonMatch[1]!;
  }

  // Repair common LLM JSON issues
  text = repairJson(text);
  return text;
}

function repairJson(str: string) {
  return str
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,\s*([\]\}])/g, "$1")
    .replace(/\.\.\.[^"\n]*/g, "");
}

function extractWorldScript(raw: string) {
  const text = raw.trim();
  return text
    .replace(/^\s*```(?:ts|typescript|js|javascript)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .replace(/^\s*\/\/\s*world-graph-script\s*/i, "")
    .replace(/^\s*export\s+/gm, "")
    .trim();
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildPreviewText(value: string, maxChars: number) {
  return collapseWhitespace(value).slice(0, maxChars);
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
