// ──────────────────────────────────────────────
// World Graph Lorebook Sync (CodeAct via QuickJS DSL)
// ──────────────────────────────────────────────
import type { BaseLLMProvider } from "../llm/base-provider.js";
import type { Lorebook, LorebookEntry, WorldGraphPatch } from "@marinara-engine/shared";
import { applyWorldPatch, createWorldGraphRuntime, type WorldGraphRuntime } from "./world-graph-runtime.js";
import { runWorldGraphScript } from "./world-graph-script-runtime.js";

type LorebookWithEntries = Lorebook & { entries: LorebookEntry[] };

interface SceneContext {
  characterNames: string[];
  personaName: string;
  personaDescription?: string | null;
  recentMessages: Array<{ role: string; name?: string; content: string }>;
  summary?: string | null;
}

interface BuildLorebookGraphInput {
  provider: BaseLLMProvider;
  model: string;
  lorebooks: LorebookWithEntries[];
  scene: SceneContext;
}

const ENTRY_CHUNK_CHAR_LIMIT = 22_000;
const MAX_MANIFEST_CHARS = 18_000;
const MAX_DIGEST_CHARS = 14_000;
const MAX_FINAL_SCRIPT_CHARS = 80_000;
const MAX_DRAFT_REPAIR_ATTEMPTS = 1;
const MAX_FINAL_REPAIR_ATTEMPTS = 3;

export async function buildWorldGraphPatchFromLorebooks(input: BuildLorebookGraphInput) {
  const entries = input.lorebooks.flatMap((book) => book.entries.map((entry) => ({ book, entry })));
  const manifest = buildEntryManifest(entries).slice(0, MAX_MANIFEST_CHARS);
  const chunks = chunkEntries(entries);
  const draftScripts: string[] = [];
  const draftRuntime = createWorldGraphRuntime();
  let graphDigest = "No graph operations have been drafted yet.";

  const effectiveChunks = chunks.length > 0 ? chunks : [[]];
  for (let index = 0; index < effectiveChunks.length; index++) {
    const batch = effectiveChunks[index] ?? [];
    const raw = await input.provider.chatComplete(
      [
        { role: "system", content: CODEACT_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Write world graph DSL code for lorebook batch ${index + 1}/${effectiveChunks.length}.`,
            ``,
            `<current_scene_context>`,
            formatSceneContext(input.scene),
            `</current_scene_context>`,
            ``,
            `<all_lorebook_entry_manifest>`,
            manifest || "(No lorebook entries are attached. Create a minimal scene graph from current context.)",
            `</all_lorebook_entry_manifest>`,
            ``,
            `<graph_so_far>`,
            graphDigest,
            `</graph_so_far>`,
            ``,
            `<entries_to_review_in_this_batch>`,
            formatEntries(batch) || "(No lorebook entries in this batch.)",
            `</entries_to_review_in_this_batch>`,
          ].join("\n"),
        },
      ],
      { model: input.model, temperature: 0.2, maxTokens: 8192 },
    );

    const script = extractWorldScript(raw.content ?? "");
    if (script) {
      try {
        const validatedDraft = await validateWorldGraphScriptWithRetries({
          provider: input.provider,
          model: input.model,
          scene: input.scene,
          runtime: draftRuntime,
          script,
          graphId: "draft",
          stageLabel: `draft batch ${index + 1}/${effectiveChunks.length}`,
          maxRepairAttempts: MAX_DRAFT_REPAIR_ATTEMPTS,
          repairContext: [
            `<graph_so_far>`,
            graphDigest,
            `</graph_so_far>`,
            ``,
            `<entries_to_review_in_this_batch>`,
            formatEntries(batch) || "(No lorebook entries in this batch.)",
            `</entries_to_review_in_this_batch>`,
          ].join("\n"),
        });
        draftScripts.push(validatedDraft.script);
        applyWorldPatch(draftRuntime, validatedDraft.scriptResult.patch);
        graphDigest = summarizePatchHistory(draftScripts, validatedDraft.scriptResult.patch).slice(0, MAX_DIGEST_CHARS);
      } catch (error) {
        graphDigest = [
          graphDigest,
          `Draft ${index + 1} failed validation and repair: ${error instanceof Error ? error.message : "unknown error"}`,
        ]
          .join("\n")
          .slice(0, MAX_DIGEST_CHARS);
      }
    }
  }

  const finalRaw = await input.provider.chatComplete(
    [
      { role: "system", content: CODEACT_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Reconcile these draft world graph scripts into ONE final script.`,
          ``,
          `Rules:`,
          `- Merge duplicate locations, characters, and items.`,
          `- Keep all useful known locations ready in the graph.`,
          `- Set revealed=false for locations the player should not see on the HUD yet.`,
          `- Set revealed=true for the current location, obvious exits, or places explicitly visible/known from the scene.`,
          `- Set visited=true only for the current or previously established visited locations.`,
          `- Place Player at the best current scene location. Create Player if needed.`,
          `- Place only characters who are plausibly present in the current scene. Other characters may exist without move().`,
          `- Use connectLocations(...) only for navigable map paths. Put soft relationships in descriptions/tags/data.`,
          `- Use placeLocation(...) for containment such as island in sea, country in planet, room in building, or region in world.`,
          `- Use structured edge metadata so the UI can display paths later: label, description, direction, type.`,
          `- Return only executable world graph DSL code.`,
          ``,
          `<current_scene_context>`,
          formatSceneContext(input.scene),
          `</current_scene_context>`,
          ``,
          `<all_lorebook_entry_manifest>`,
          manifest || "(No lorebook entries are attached.)",
          `</all_lorebook_entry_manifest>`,
          ``,
          `<draft_scripts>`,
          draftScripts.join("\n\n// ---- next draft ----\n\n").slice(0, MAX_FINAL_SCRIPT_CHARS),
          `</draft_scripts>`,
        ].join("\n"),
      },
    ],
    { model: input.model, temperature: 0.15, maxTokens: 16_000 },
  );

  const finalSeedScript =
    extractWorldScript(finalRaw.content ?? "") ||
    draftScripts.join("\n\n") ||
    `createCharacter({ name: "Player", description: "The player." });
createLocation({ name: "Current Scene", description: "The player's current scene location.", revealed: true, visited: true });
move("Player", "Current Scene");`;
  const finalValidation = await validateWorldGraphScriptWithRetries({
    provider: input.provider,
    model: input.model,
    scene: input.scene,
    runtime: createWorldGraphRuntime(),
    script: finalSeedScript,
    graphId: "sync",
    stageLabel: "final reconciliation",
    maxRepairAttempts: MAX_FINAL_REPAIR_ATTEMPTS,
    enableRouteReview: true,
    repairContext: [
      `<all_lorebook_entry_manifest>`,
      manifest || "(No lorebook entries are attached.)",
      `</all_lorebook_entry_manifest>`,
      ``,
      `<draft_scripts>`,
      draftScripts.join("\n\n// ---- next draft ----\n\n").slice(0, MAX_FINAL_SCRIPT_CHARS) || "(none)",
      `</draft_scripts>`,
    ].join("\n"),
  });
  const finalScript = withRuntimeDefaults(finalValidation.script, input.scene);
  const scriptResult = finalValidation.scriptResult;
  const patch: WorldGraphPatch = {
    ...scriptResult.patch,
    events: scriptResult.patch.events.length
      ? scriptResult.patch.events
      : [`Synced world graph from lorebooks (${scriptResult.patch.ops.length} operations).`],
    result: {
      source: "lorebook_codeact_sync",
      script: finalScript,
      scriptResult: scriptResult.scriptResult,
      operationCount: scriptResult.patch.ops.length,
      repairAttempts: finalValidation.repairAttempts,
      validationErrors: finalValidation.validationErrors,
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

const CODEACT_SYSTEM_PROMPT = `You are a CodeAct world graph builder for a roleplay app.

You must write executable JavaScript using ONLY this world graph DSL:

createLocation({
  name: string,
  description?: string,
  tags?: string[],
  x?: number | null,
  y?: number | null,
  floor?: string | null,
  revealed?: boolean,
  visited?: boolean,
  data?: object
});

createCharacter({ name: string, description?: string, data?: object });
createItem({ name: string, description?: string, tags?: string[], data?: object });

connectLocations({
  from: string,
  to: string,
  label?: string,
  description?: string,
  direction?: string,
  type?: "door" | "path" | "road" | "stairs" | "portal" | "interior" | "route" | string,
  bidirectional?: boolean,
  hidden?: boolean,
  data?: object
});

placeLocation({
  location: string,
  parent: string,
  label?: string,
  description?: string,
  type?: "inside" | "part_of" | "region" | "country" | "planet" | "building" | string,
  data?: object
});

move(characterName: string, locationName: string);
place(itemName: string, locationName: string);
reveal(locationName: string);
visit(locationName: string);

Important runtime constraints:
- No imports, require, eval, Function, process, globalThis, async, timers, classes, or external libraries.
- Do not define TypeScript types. The runtime executes JavaScript in QuickJS.
- Return only code. A fenced \`\`\`js block is acceptable, but no explanation.
- Prefer arrays and forEach only when helpful; simple direct calls are best.
- Every call is validated and converted into a graph patch.

Visibility rules:
- Include useful known locations now, even if hidden.
- Use revealed=false on places the HUD should not show yet.
- Use revealed=true for the current location, immediate obvious exits, or known visible places.
- Use visited=true only for the current or previously established visited locations.

Connection rules:
- Only connect locations when they are navigable map paths.
- Do not use connectLocations for containment. Use placeLocation for "inside", "part of", "region of", "country on planet", "room in building", etc.
- Soft relationships such as family, politics, ownership, history, hatred, or prophecy belong in descriptions, tags, or data, not location edges.
- Always include useful edge metadata when known: label, description, direction, type.

Scene placement:
- A player character already exists with key "player".
- Do not create a duplicate player character.
- Use move("Player", ...) to place the player in the best current scene location.
- Place present scene characters with move().
- Characters not currently present can be created without move().`;

const WORLD_GRAPH_REPAIR_SYSTEM_PROMPT = `You repair world graph DSL after runtime validation failures.

Return only executable world graph DSL code.

Rules:
- Preserve as much valid intent from the failed script as possible.
- Fix the reported runtime error directly.
- Do not add explanations, markdown prose, or comments outside the code.
- Keep using only the supported DSL calls.
- Avoid duplicate entities and contradictory placement.
- Use placeLocation(...) for containment and connectLocations(...) for navigable travel.`;

const WORLD_GRAPH_ROUTE_REVIEW_SYSTEM_PROMPT = `You review and repair world graph DSL so the map is navigable and semantically sensible.

Return only executable world graph DSL code.

Rules:
- Preserve as much valid world information as possible.
- Review every location route and containment relationship before responding.
- For normal travel routes (door, path, road, stairs, interior, route), prefer bidirectional travel unless a one-way path is clearly intended.
- Do not use connectLocations(...) and placeLocation(...) on the same exact source/target pair unless the route is truly navigable and containment is also clearly needed.
- Current player-facing locations should have sensible exits when the surrounding map implies they should.
- Use placeLocation(...) for containment and connectLocations(...) for traversable movement.
- Remove or rewrite nonsensical containment such as dimensions being physically inside city buildings unless the lore explicitly requires it.`;

function buildEntryManifest(entries: Array<{ book: Lorebook; entry: LorebookEntry }>) {
  return entries
    .map(({ book, entry }, index) => {
      const keys = [...entry.keys, ...entry.secondaryKeys].filter(Boolean).join(", ");
      const tagParts = [entry.tag, entry.group, book.category, ...book.tags].filter(Boolean).join(", ");
      const preview = collapseWhitespace(entry.content).slice(0, 220);
      return [
        `${index + 1}. [${entry.id}] ${book.name} / ${entry.name}`,
        keys ? `keys: ${keys}` : "",
        tagParts ? `tags: ${tagParts}` : "",
        preview ? `preview: ${preview}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .join("\n");
}

function chunkEntries(entries: Array<{ book: Lorebook; entry: LorebookEntry }>) {
  const chunks: Array<Array<{ book: Lorebook; entry: LorebookEntry }>> = [];
  let current: Array<{ book: Lorebook; entry: LorebookEntry }> = [];
  let currentSize = 0;

  for (const item of entries) {
    const size = formatEntry(item).length + 2;
    if (current.length > 0 && currentSize + size > ENTRY_CHUNK_CHAR_LIMIT) {
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
    `Content:`,
    entry.content || "(empty)",
    `</entry>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSceneContext(scene: SceneContext) {
  return [
    `Persona/player display name: ${scene.personaName || "Player"}`,
    scene.personaDescription ? `Persona description: ${scene.personaDescription}` : "",
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

function extractWorldScript(raw: string) {
  const fenceMatch = raw.match(/```(?:ts|typescript|js|javascript)?\s*\n?([\s\S]*?)```/i);
  const text = (fenceMatch?.[1] ?? raw).trim();
  return text
    .replace(/^\s*\/\/\s*world-graph-script\s*/i, "")
    .replace(/^\s*export\s+/gm, "")
    .trim();
}

function withRuntimeDefaults(script: string, scene: SceneContext) {
  const body = script.trim();
  if (!body) return "";
  const playerName = scene.personaName?.trim() || "Player";
  const playerDescription = scene.personaDescription?.trim() || `The player's persona, ${playerName}.`;
  return [
    `createCharacter({ key: "player", name: "${escapeJsString(playerName)}", description: "${escapeJsString(playerDescription)}", data: { isPlayer: true, aliases: ["Player", "${escapeJsString(playerName)}"] } });`,
    body,
  ].join("\n");
}

async function validateWorldGraphScriptWithRetries(input: {
  provider: BaseLLMProvider;
  model: string;
  scene: SceneContext;
  runtime: WorldGraphRuntime;
  script: string;
  graphId: string;
  stageLabel: string;
  maxRepairAttempts: number;
  enableRouteReview?: boolean;
  repairContext?: string;
}) {
  let candidate = extractWorldScript(input.script);
  const validationErrors: string[] = [];

  if (!candidate) throw new Error(`World graph ${input.stageLabel} produced no executable code`);

  for (let attempt = 0; attempt <= input.maxRepairAttempts; attempt++) {
    try {
      const rawScriptResult = await runWorldGraphScript(input.graphId, input.runtime, withRuntimeDefaults(candidate, input.scene), {
        maxOps: 512,
      });
      const previewRuntime = input.runtime.copy() as WorldGraphRuntime;
      applyWorldPatch(previewRuntime, rawScriptResult.patch);
      const autoRepairPatch = buildWorldGraphRouteAutoRepairPatch(previewRuntime);
      if (autoRepairPatch.ops.length > 0) {
        applyWorldPatch(previewRuntime, autoRepairPatch);
      }
      const scriptResult =
        autoRepairPatch.ops.length > 0
          ? {
              ...rawScriptResult,
              patch: {
                ...rawScriptResult.patch,
                ops: [...rawScriptResult.patch.ops, ...autoRepairPatch.ops],
                events: [...rawScriptResult.patch.events, ...autoRepairPatch.events],
              },
            }
          : rawScriptResult;
      if (input.enableRouteReview) {
        const routeReview = reviewWorldGraphTopology(previewRuntime);
        if (routeReview.issues.length > 0) {
          validationErrors.push(...routeReview.issues);
          if (attempt === input.maxRepairAttempts) {
            throw new Error(
              `World graph ${input.stageLabel} route review failed after ${attempt + 1} attempt(s): ${routeReview.issues[0]}`,
            );
          }
          candidate = await requestWorldGraphRouteReviewRepair({
            provider: input.provider,
            model: input.model,
            scene: input.scene,
            failedScript: candidate,
            stageLabel: input.stageLabel,
            routeIssues: routeReview.issues,
            routeSummary: routeReview.summary,
            repairContext: input.repairContext,
          });
          continue;
        }
      }
      return {
        script: candidate,
        scriptResult,
        repairAttempts: attempt,
        validationErrors,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      validationErrors.push(message);
      if (attempt === input.maxRepairAttempts) {
        throw new Error(`World graph ${input.stageLabel} failed after ${attempt + 1} attempt(s): ${message}`);
      }
      candidate = await requestWorldGraphScriptRepair({
        provider: input.provider,
        model: input.model,
        scene: input.scene,
        failedScript: candidate,
        stageLabel: input.stageLabel,
        validationError: message,
        previousErrors: validationErrors,
        repairContext: input.repairContext,
      });
    }
  }

  throw new Error(`World graph ${input.stageLabel} exhausted its repair loop`);
}

async function requestWorldGraphScriptRepair(input: {
  provider: BaseLLMProvider;
  model: string;
  scene: SceneContext;
  failedScript: string;
  stageLabel: string;
  validationError: string;
  previousErrors: string[];
  repairContext?: string;
}) {
  const raw = await input.provider.chatComplete(
    [
      { role: "system", content: WORLD_GRAPH_REPAIR_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Repair this world graph script so it passes runtime validation.`,
          `Stage: ${input.stageLabel}`,
          ``,
          `<current_scene_context>`,
          formatSceneContext(input.scene),
          `</current_scene_context>`,
          ``,
          input.repairContext?.trim() || "",
          input.repairContext?.trim() ? `` : "",
          `<validation_error>`,
          input.validationError,
          `</validation_error>`,
          ``,
          `<previous_errors>`,
          input.previousErrors.join("\n"),
          `</previous_errors>`,
          ``,
          `<failed_script>`,
          input.failedScript,
          `</failed_script>`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    { model: input.model, temperature: 0.1, maxTokens: 8_192 },
  );

  const repaired = extractWorldScript(raw.content ?? "");
  if (!repaired) throw new Error(`World graph ${input.stageLabel} repair returned no executable code`);
  return repaired;
}

async function requestWorldGraphRouteReviewRepair(input: {
  provider: BaseLLMProvider;
  model: string;
  scene: SceneContext;
  failedScript: string;
  stageLabel: string;
  routeIssues: string[];
  routeSummary: string;
  repairContext?: string;
}) {
  const raw = await input.provider.chatComplete(
    [
      { role: "system", content: WORLD_GRAPH_ROUTE_REVIEW_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Review all location routes and containment relationships, then repair the script.` ,
          `Stage: ${input.stageLabel}`,
          ``,
          `<current_scene_context>`,
          formatSceneContext(input.scene),
          `</current_scene_context>`,
          ``,
          input.repairContext?.trim() || "",
          input.repairContext?.trim() ? `` : "",
          `<route_issues>`,
          input.routeIssues.join("\n"),
          `</route_issues>`,
          ``,
          `<route_summary>`,
          input.routeSummary,
          `</route_summary>`,
          ``,
          `<failed_script>`,
          input.failedScript,
          `</failed_script>`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    { model: input.model, temperature: 0.1, maxTokens: 8_192 },
  );

  const repaired = extractWorldScript(raw.content ?? "");
  if (!repaired) throw new Error(`World graph ${input.stageLabel} route review returned no executable code`);
  return repaired;
}

function buildWorldGraphRouteAutoRepairPatch(graph: WorldGraphRuntime): WorldGraphPatch {
  const ops: WorldGraphPatch["ops"] = [];
  const events: string[] = [];
  const addedRouteKeys = new Set<string>();
  const currentLocationKey = findPlayerLocationKey(graph);
  const connectEdges = graph.edges().filter((edge) => graph.getEdgeAttribute(edge, "kind") === "connects_to");

  for (const edge of connectEdges) {
    const source = graph.source(edge);
    const target = graph.target(edge);
    const sourceName = String(graph.getNodeAttribute(source, "name"));
    const targetName = String(graph.getNodeAttribute(target, "name"));
    const edgeData = graph.getEdgeAttribute(edge, "data") as Record<string, unknown> | undefined;
    const routeType = String(edgeData?.type ?? "").trim().toLowerCase();
    const reverseExists = graph
      .directedEdges(target, source)
      .some((candidate) => graph.getEdgeAttribute(candidate, "kind") === "connects_to");
    const oneWayRoute = routeType === "portal" || edgeData?.oneWay === true || edgeData?.unidirectional === true;
    if (reverseExists || oneWayRoute) continue;

    const repairKey = `${target}->${source}`;
    if (addedRouteKeys.has(repairKey)) continue;
    ops.push({
      type: "connectLocations",
      from: target,
      to: source,
      bidirectional: false,
      data: edgeData ?? {},
    });
    events.push(`Auto-repaired missing return route from ${targetName} to ${sourceName}.`);
    addedRouteKeys.add(repairKey);
  }

  const containmentEdges = graph.edges().filter((edge) => graph.getEdgeAttribute(edge, "kind") === "in");
  for (const edge of containmentEdges) {
    const child = graph.source(edge);
    const parent = graph.target(edge);
    if (graph.getNodeAttribute(child, "kind") !== "location" || graph.getNodeAttribute(parent, "kind") !== "location") {
      continue;
    }

    const data = (graph.getEdgeAttribute(edge, "data") as Record<string, unknown> | undefined) ?? {};
    const containmentType = String(data.type ?? "").trim().toLowerCase();
    const navigableInterior =
      containmentType === "inside" || containmentType === "building" || child === currentLocationKey;
    if (!navigableInterior) continue;

    const hasRouteEitherWay = graph
      .edges(child, parent)
      .some((candidate) => graph.getEdgeAttribute(candidate, "kind") === "connects_to");
    if (hasRouteEitherWay) continue;

    const repairKey = `${child}<->${parent}`;
    if (addedRouteKeys.has(repairKey)) continue;
    ops.push({
      type: "connectLocations",
      from: child,
      to: parent,
      bidirectional: true,
      data: {
        label: data.label ?? "Interior Route",
        description: data.description ?? `Traversal between ${graph.getNodeAttribute(child, "name")} and ${graph.getNodeAttribute(parent, "name")}.`,
        direction: data.direction ?? "inside",
        type: data.type ?? "interior",
      },
    });
    events.push(
      `Auto-repaired missing interior route between ${graph.getNodeAttribute(child, "name")} and ${graph.getNodeAttribute(parent, "name")}.`,
    );
    addedRouteKeys.add(repairKey);
  }

  return { ops, events };
}

function reviewWorldGraphTopology(graph: WorldGraphRuntime) {
  const issues = new Set<string>();
  const locationKeys = graph.nodes().filter((key) => graph.getNodeAttribute(key, "kind") === "location");
  const connectEdges = graph
    .edges()
    .filter((edge) => graph.getEdgeAttribute(edge, "kind") === "connects_to");
  const containmentEdges = graph
    .edges()
    .filter((edge) => graph.getEdgeAttribute(edge, "kind") === "in");
  const currentLocationKey = findPlayerLocationKey(graph);

  if (currentLocationKey && locationKeys.length > 1) {
    const currentExits = connectEdges.filter((edge) => graph.source(edge) === currentLocationKey);
    if (currentExits.length === 0) {
      issues.add(`Player current location "${graph.getNodeAttribute(currentLocationKey, "name")}" has no outbound routes.`);
    }
  }

  for (const edge of connectEdges) {
    const source = graph.source(edge);
    const target = graph.target(edge);
    const sourceName = graph.getNodeAttribute(source, "name");
    const targetName = graph.getNodeAttribute(target, "name");
    const edgeData = graph.getEdgeAttribute(edge, "data") as Record<string, unknown> | undefined;
    const routeType = String(edgeData?.type ?? "").trim().toLowerCase();
    const reverseExists = graph
      .directedEdges(target, source)
      .some((candidate) => graph.getEdgeAttribute(candidate, "kind") === "connects_to");
    const oneWayRoute = routeType === "portal" || edgeData?.oneWay === true || edgeData?.unidirectional === true;
    if (!reverseExists && !oneWayRoute) {
      issues.add(`Route "${sourceName}" -> "${targetName}" is missing a return path.`);
    }
  }

  for (const edge of containmentEdges) {
    const source = graph.source(edge);
    const target = graph.target(edge);
    const sourceAttrs = graph.getNodeAttributes(source);
    const targetAttrs = graph.getNodeAttributes(target);
    const sourceTags = new Set((sourceAttrs.tags ?? []).map(String).map((tag) => tag.toLowerCase()));
    const targetTags = new Set((targetAttrs.tags ?? []).map(String).map((tag) => tag.toLowerCase()));
    const sourceName = String(sourceAttrs.name ?? "");
    if (
      (sourceTags.has("dimension") || /\brealm\b/i.test(sourceName)) &&
      (targetTags.has("city") || targetTags.has("school") || targetTags.has("building"))
    ) {
      issues.add(`Containment "${sourceAttrs.name}" inside "${targetAttrs.name}" looks semantically wrong.`);
    }
  }

  return {
    issues: [...issues],
    summary: summarizeGraphTopology(graph, currentLocationKey),
  };
}

function summarizeGraphTopology(graph: WorldGraphRuntime, currentLocationKey: string | null) {
  const locationKeys = graph.nodes().filter((key) => graph.getNodeAttribute(key, "kind") === "location");
  const connectEdges = graph
    .edges()
    .filter((edge) => graph.getEdgeAttribute(edge, "kind") === "connects_to")
    .map((edge) => {
      const data = graph.getEdgeAttribute(edge, "data") as Record<string, unknown> | undefined;
      return `${graph.getNodeAttribute(graph.source(edge), "name")} -> ${graph.getNodeAttribute(graph.target(edge), "name")} (${String(data?.type ?? "route")}${data?.label ? `, ${String(data.label)}` : ""})`;
    });
  const containmentEdges = graph
    .edges()
    .filter((edge) => graph.getEdgeAttribute(edge, "kind") === "in")
    .map((edge) => {
      const data = graph.getEdgeAttribute(edge, "data") as Record<string, unknown> | undefined;
      return `${graph.getNodeAttribute(graph.source(edge), "name")} in ${graph.getNodeAttribute(graph.target(edge), "name")} (${String(data?.type ?? "inside")})`;
    });
  const locationDetails = locationKeys.map((key) => {
    const name = graph.getNodeAttribute(key, "name");
    const exits = graph
      .outEdges(key)
      .filter((edge) => graph.getEdgeAttribute(edge, "kind") === "connects_to")
      .map((edge) => graph.getNodeAttribute(graph.target(edge), "name"));
    const parents = graph
      .outEdges(key)
      .filter((edge) => graph.getEdgeAttribute(edge, "kind") === "in")
      .map((edge) => graph.getNodeAttribute(graph.target(edge), "name"));
    return `- ${name}${key === currentLocationKey ? " [CURRENT]" : ""}; exits: ${exits.join(", ") || "(none)"}; containers: ${parents.join(", ") || "(none)"}`;
  });

  return [
    `Current location: ${currentLocationKey ? graph.getNodeAttribute(currentLocationKey, "name") : "(unknown)"}`,
    `Locations:`,
    locationDetails.join("\n") || "(none)",
    `Traversable routes:`,
    connectEdges.join("\n") || "(none)",
    `Containment edges:`,
    containmentEdges.join("\n") || "(none)",
  ].join("\n");
}

function findPlayerLocationKey(graph: WorldGraphRuntime) {
  const playerKey = graph.hasNode("player")
    ? "player"
    : graph.findNode((_, attrs) => attrs.kind === "character" && (attrs.data as Record<string, unknown> | undefined)?.isPlayer === true);
  if (!playerKey) return null;
  const atEdge = graph.outEdges(playerKey).find((edge) => graph.getEdgeAttribute(edge, "kind") === "at");
  return atEdge ? graph.target(atEdge) : null;
}

function summarizePatchHistory(scripts: string[], latestPatch: WorldGraphPatch) {
  const latestOps = latestPatch.ops
    .slice(-80)
    .map((op) => JSON.stringify(op))
    .join("\n");
  return [
    `Draft script count: ${scripts.length}`,
    `Latest operations:`,
    latestOps || "(none)",
    `Recent script tail:`,
    scripts.at(-1)?.slice(-4_000) || "(none)",
  ].join("\n");
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeJsString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}
