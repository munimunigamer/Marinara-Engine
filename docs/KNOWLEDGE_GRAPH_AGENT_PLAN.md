# World Graph Runtime Plan

## Goal

Build a small game-like world system the LLM can play inside.

This replaces the broader "knowledge graph" idea with a narrower v1:

- Locations exist in a connected map.
- Characters can be at locations.
- Items can be in locations or held by characters.
- The AI can search, explore, move, take, drop, and observe the world before writing.
- The UI can display the world like a small RPG/manor map.

The feature should feel like a tiny runtime/game engine, not a passive retrieval system. Pre-generation should resolve the user's intended action against the world, then give the main roleplay model the resulting observation.

## Design Principle

Pre-generation is not "generate context."

Pre-generation is:

```txt
user intent -> world agent loop -> world operations -> updated observation -> main narration
```

Example:

```txt
User: "I head to the attic and grab the key if I pass it."

World agent:
1. Searches for Attic.
2. Finds route: Living Room -> Hallway -> Stairs -> Attic.
3. Explores the route.
4. Notices Brass Key in Hallway.
5. Moves Player through the route.
6. Takes Brass Key.
7. Returns the final observation.

Main roleplay model:
Narrates what happened using the resolved world state.
```

## Existing Architecture Notes

Agents are currently DB-backed configs rather than code classes.

- Shared agent types and tool definitions live in `packages/shared/src/types/agent.ts`.
- Default prompts live in `packages/shared/src/constants/agent-prompts.ts`.
- Agent execution is orchestrated from `packages/server/src/routes/generate.routes.ts`.
- The generic pipeline lives in `packages/server/src/services/agents/agent-pipeline.ts`.
- The existing `knowledge-retrieval` agent is excluded from the normal pipeline and run through a dedicated path.
- Game state already uses `messageId + swipeIndex` snapshots and commit semantics.

The world graph should follow the same dedicated-service pattern as `knowledge-retrieval`, not be forced into the generic batched agent executor.

## Recommended Packages

Server:

```bash
pnpm add -F @marinara-engine/server graphology graphology-shortest-path quickjs-emscripten
```

Client:

```bash
pnpm add -F @marinara-engine/client @xyflow/react
```

Possible later additions:

```bash
pnpm add -F @marinara-engine/client elkjs cytoscape react-cytoscapejs
```

Package roles:

- `graphology`: in-memory world graph runtime.
- `graphology-shortest-path`: route finding between locations.
- `quickjs-emscripten`: WASM-based JavaScript sandbox for CodeAct-style world scripts.
- `@xyflow/react`: RPG/manor-style map display with custom room/item/player nodes.
- `elkjs`: optional automatic layout.
- `cytoscape`: optional later full graph explorer.

Keep SQLite + Drizzle as the durable store. Do not introduce Neo4j/Kuzu/etc. for v1.

## V1 Domain Model

Keep the graph intentionally small.

```ts
type WorldNodeType = "location" | "character" | "item";
```

Locations:

```ts
Location {
  key: string;
  name: string;
  description: string;
  tags: string[];
  x?: number;
  y?: number;
  floor?: string;
  revealed: boolean;
  visited: boolean;
}
```

Characters:

```ts
Character {
  key: string;
  name: string;
  description?: string;
}
```

Items:

```ts
Item {
  key: string;
  name: string;
  description?: string;
  tags: string[];
}
```

Allowed relationships:

```txt
Location --connects_to--> Location
Character --at--> Location
Item --in--> Location
Item --held_by--> Character
```

Expose game verbs to the LLM rather than arbitrary graph mutation.

## Files To Add

```txt
packages/shared/src/types/world-graph.ts
packages/shared/src/schemas/world-graph.schema.ts

packages/server/src/db/schema/world-graph.ts
packages/server/src/services/world-graph/
  world-graph.storage.ts
  world-graph-runtime.ts
  world-graph-retrieval.ts
  world-graph-agent-loop.ts
  world-graph-tools.ts
  world-graph-lifecycle.ts
packages/server/src/routes/world-graph.routes.ts

packages/client/src/components/world-graph/
  WorldMapPanel.tsx
  WorldLocationNode.tsx
  WorldItemNode.tsx
  WorldCharacterNode.tsx
```

Also export schema from:

```txt
packages/server/src/db/schema/index.ts
```

Register routes from:

```txt
packages/server/src/routes/index.ts
```

## Database Schema

Suggested v1 schema:

```ts
worldGraphs
- id
- chatId nullable
- name
- createdAt
- updatedAt

worldNodes
- id
- graphId
- key
- type: "location" | "character" | "item"
- name
- description
- tags JSON text
- data JSON text
- x nullable
- y nullable
- floor nullable
- revealed integer
- visited integer
- createdAt
- updatedAt

worldLinks
- id
- graphId
- fromKey
- predicate: "connects_to" | "at" | "in" | "held_by"
- toKey
- data JSON text
- createdAt
- updatedAt

worldPatches
- id
- graphId
- chatId
- sourceRole: "user" | "assistant" | "manual" | "ingest"
- sourcePhase: "pre_generation" | "tool" | "post_generation" | "manual" | "ingest"
- messageId nullable
- swipeIndex nullable
- status: "pending" | "committed" | "inactive" | "orphaned" | "rejected"
- code nullable
- patch JSON text
- result JSON text
- createdAt
- committedAt nullable
```

Use patches as the source of truth for undo/delete/swipe correctness. `worldNodes` and `worldLinks` can be treated as the materialized current graph.

## Patch Format

The sandboxed code should never mutate the database directly. It should produce validated operations.

Example:

```json
{
  "ops": [
    {
      "type": "moveCharacter",
      "character": "Player",
      "to": "Hallway"
    },
    {
      "type": "takeItem",
      "character": "Player",
      "item": "Brass Key"
    }
  ],
  "events": [
    "Player moved to Hallway.",
    "Player picked up Brass Key."
  ],
  "result": {
    "currentLocation": "Hallway",
    "inventory": ["Brass Key"]
  }
}
```

Validate with `zod` in shared schemas.

Suggested operation types:

```ts
createLocation
createCharacter
createItem
updateLocation
updateCharacter
updateItem
connectLocations
disconnectLocations
moveCharacter
placeItem
takeItem
dropItem
revealLocation
visitLocation
```

Storage applies these deterministically:

- `moveCharacter` replaces existing `Character --at--> *`.
- `takeItem` replaces existing `Item --in--> *` and `Item --held_by--> *`.
- `placeItem` replaces existing item location/holder.
- `connectLocations` is additive.

## World Script Runtime

Use a CodeAct-style DSL for LLM actions, but store only validated JSON operations.

The LLM writes:

```js
const route = path(here().name, "Attic");

for (const location of route.locations.slice(1)) {
  move("Player", location);

  const scene = explore(location);
  const key = scene.items.find((item) => item.name === "Brass Key");
  if (key) take("Player", key.name);
}

observe();
```

The runtime returns:

```json
{
  "result": {
    "currentLocation": "Attic",
    "inventory": ["Brass Key"],
    "visibleItems": ["Dusty Trunk"]
  },
  "patch": {
    "ops": [
      { "type": "moveCharacter", "character": "Player", "to": "Hallway" },
      { "type": "takeItem", "character": "Player", "item": "Brass Key" },
      { "type": "moveCharacter", "character": "Player", "to": "Stairs" },
      { "type": "moveCharacter", "character": "Player", "to": "Attic" }
    ]
  }
}
```

Use `quickjs-emscripten`, not Node `vm`, for the LLM-authored world script runtime. Only inject approved world functions. No `fs`, no network, no imports, no Node globals.

Runtime limits:

- Max wall time, e.g. 1000-2000ms.
- Max operations per script.
- Max path length.
- Max returned JSON size.
- Max world agent loop steps.

## World DSL

Start with these functions:

```js
here();                         // current Player location
observe();                      // current scene, inventory, visible items, exits
inventory(characterName);

search(query, options?);
findLocation(name);
findItem(name);
findCharacter(name);

path(fromLocation, toLocation); // route through connects_to links
canMove(characterName, locationName);
move(characterName, locationName);
followPath(characterName, locationNames);

explore(locationName);
explorePath(locationNames);

take(characterName, itemName);
drop(characterName, itemName);
place(itemName, locationName);

createLocation(input);
createItem(input);
createCharacter(input);
connect(fromLocation, toLocation, options?);
```

Avoid exposing generic `setLink()` publicly in v1. Game verbs are safer and easier to prompt.

## Agentic Loop

The world agent should be a loop, not a single extraction call.

Recommended limits:

```ts
maxWorldSteps: 5
maxToolCallsPerStep: 1
```

Loop shape:

```txt
1. LLM receives user message + compact current world observation.
2. LLM emits world code or a final result.
3. Server runs code in QuickJS.
4. Server returns observation/result/error.
5. LLM can correct or continue.
6. Final result is injected for main generation.
```

The loop should support multi-step search/move workflows:

```txt
search target -> find location -> compute path -> explore path -> move -> take/drop -> observe
```

## Pre-Generation Flow

Pre-gen is the main authority for user-declared actions.

Examples:

- "I go to the kitchen."
- "I pick up the knife."
- "I give Mira the key."
- "I search the bedroom."
- "I head to the attic and grab the key if I pass it."

Flow:

```txt
1. User message is saved.
2. Commit previous active assistant world patches.
3. Load current world graph.
4. Run world agent loop against the latest user message.
5. Persist resulting patch with:
   sourceRole = "user"
   sourcePhase = "pre_generation"
   messageId = latest user message
   status = "pending" until assistant response is saved
6. Inject final world observation into the main prompt.
7. If assistant generation succeeds, commit/apply the user pre-gen patch.
8. If assistant generation fails, reject/discard the pending pre-gen patch.
```

Injected block example:

```xml
<world_observation>
Action result:
- Player moved from Living Room to Hallway.
- Player picked up Brass Key.
- Player moved from Hallway to Stairs.
- Player moved from Stairs to Attic.

Current location: Attic

Inventory:
- Brass Key

Visible items:
- Dusty Trunk
- Broken Mirror

Exits:
- Stairs

Recent world events:
- Player picked up Brass Key in Hallway.
</world_observation>
```

The main roleplay model should narrate based on this resolved world state.

## Main Generation Tools

Add read tools first:

```txt
world_here
world_search
world_explore
```

Possible write/code tool:

```txt
world_run
```

For v1, prefer mutations through the pre-generation world agent and post-generation observer. The main roleplay model can be allowed read tools immediately. Allow `world_run` for the main model only after the runtime and patch lifecycle are stable.

Tool definitions:

```ts
world_search({
  query: string;
  types?: ("location" | "character" | "item")[];
  limit?: number;
})

world_explore({
  location?: string;
  depth?: number;
})

world_here({})

world_run({
  code: string;
  apply?: boolean;
})
```

Integration points:

- Add tool definitions in `packages/shared/src/types/agent.ts`.
- Execute world tools from `packages/server/src/services/tools/tool-executor.ts`.
- Pass world tool context from `packages/server/src/routes/generate.routes.ts`.

## Post-Generation Flow

Post-gen is for consequences introduced by the assistant's narration.

Examples:

- "The door slams shut behind you."
- "Mira pockets the coin."
- "A guard steps into the hall."
- "The candle burns out."

Flow:

```txt
1. Assistant response is saved and messageId/swipeIndex are known.
2. Run a conservative post-gen world observer.
3. Observer emits world code or JSON ops.
4. Validate patch.
5. Save patch with:
   sourceRole = "assistant"
   sourcePhase = "post_generation"
   messageId = assistant message
   swipeIndex = active swipe
   status = "pending"
6. Update materialized graph for UI preview.
7. Commit this patch only when the user sends the next message and thereby accepts this swipe.
```

Post-gen should not rewrite broad world history. It should only apply clear, local consequences established in the latest assistant response.

## Undo, Delete, Swipe, Regen

Every mutation must belong to a source message and, for assistant messages, a swipe.

Rules:

```txt
User sends next message:
  Commit patches for previous assistant active swipe.

Assistant regeneration:
  Create a new swipe and new pending patches for that swipe.
  Old swipe patches remain attached to old swipe and inactive unless selected.

Active swipe switch:
  Do not delete patches.
  Effective world follows selected swipe.
  Rebuild/re-materialize graph using the selected swipe's patches.

Delete assistant message:
  Mark patches for that message as orphaned.
  Rebuild materialized graph from remaining canon patches.

Delete user message:
  Mark its pre-gen patches as orphaned.
  Mark later dependent patches as orphaned if deleting a range.
  Rebuild materialized graph.

Delete chat:
  Delete chat-scoped graph data or mark all patches orphaned.
```

Prefer rebuild-from-patches over inverse patches in v1. It is simpler and safer.

## Materialized Graph

Use patch history as truth and `worldNodes/worldLinks` as the fast current view.

Simple rebuild strategy:

```txt
clear materialized graph for chat
apply ingest/static patches
apply committed user patches
apply committed assistant patches
apply active pending assistant swipe patch for preview, if needed
write current nodes/links
```

This should be fast enough for v1 world sizes. Add checkpoints later only if needed.

## UI Plan

The UI should look and feel closer to an RPG/manor map than a generic graph.

Minimum:

- Map panel using `@xyflow/react`.
- Location tiles with `x/y/floor`.
- Player marker on current location.
- Items visible in the selected/current location.
- Exits between locations.
- Unknown/unrevealed rooms as `???`.
- Current location detail panel.

Later:

- Drag locations to edit layout.
- Floors/layers.
- Lock/hidden exits.
- Item icons.
- Character/NPC markers.
- Path preview.
- Manual edit panel.
- Full graph explorer with Cytoscape/Sigma if needed.

## Suggested Routes

```txt
GET    /api/world-graph/:chatId
GET    /api/world-graph/:chatId/observe
GET    /api/world-graph/:chatId/map
POST   /api/world-graph/:chatId/run
POST   /api/world-graph/:chatId/rebuild
POST   /api/world-graph/:chatId/nodes
PATCH  /api/world-graph/:chatId/nodes/:key
DELETE /api/world-graph/:chatId/nodes/:key
```

Manual route `run` is useful for debugging the DSL:

```json
{
  "code": "move('Player', 'Fog Alley'); observe();",
  "apply": false
}
```

## Example End-To-End Turn

Initial world:

```txt
Living Room connects_to Hallway
Hallway connects_to Stairs
Stairs connects_to Attic
Brass Key in Hallway
Player at Living Room
```

User:

```txt
I head to the attic and grab the key if I pass it.
```

World agent code:

```js
const route = path(here().name, "Attic");

for (const loc of route.locations.slice(1)) {
  move("Player", loc);
  const scene = explore(loc);
  const key = scene.items.find((item) => item.name === "Brass Key");
  if (key) take("Player", key.name);
}

observe();
```

World observation:

```json
{
  "currentLocation": "Attic",
  "pathTaken": ["Living Room", "Hallway", "Stairs", "Attic"],
  "inventory": ["Brass Key"],
  "visibleItems": ["Dusty Trunk"],
  "exits": ["Stairs"],
  "events": [
    "Player moved to Hallway.",
    "Player picked up Brass Key.",
    "Player moved to Stairs.",
    "Player moved to Attic."
  ]
}
```

Main model narrates the journey and arrival.

Post-gen observer may add clear consequences, such as:

```js
revealLocation("Attic");
```

## PR Breakdown

### PR 1: World graph foundation

- Add shared world graph types and zod schemas.
- Add Drizzle schema and startup migrations.
- Add storage service.
- Add patch validation and deterministic patch apply.
- Add rebuild/materialization service.
- Add basic route for observe/map/debug-run.

### PR 2: World runtime

- Add `graphology` graph loader.
- Add route/path/explore/observe helpers.
- Add `quickjs-emscripten` sandbox.
- Add DSL functions.
- Convert DSL operations to validated patch ops.
- Add focused unit tests for move/take/drop/path.

### PR 3: Pre-generation world loop

- Add world agent prompt.
- Run loop before main generation.
- Persist pre-gen user patch as pending.
- Inject `<world_observation>`.
- Commit/reject patch based on assistant generation success.

### PR 4: Lifecycle and swipes

- Commit assistant patches when user sends next message.
- Handle active swipe changes.
- Handle regen patches.
- Orphan patches on message delete.
- Rebuild graph after lifecycle changes.

### PR 5: Post-generation observer

- Run conservative observer after assistant response.
- Save assistant/swipe-scoped pending patches.
- Update map/HUD preview.
- Add failure reporting/debug data.

### PR 6: UI map

- Add `@xyflow/react` map panel.
- Show current location, exits, player marker, visible items.
- Add simple manual room/item inspector.

## Open Questions

- Should pre-gen user patches commit immediately after assistant save, or only when the next user message arrives?
- Should non-active swipe patches remain available indefinitely for alternate branches?
- Should locations be global per chat, per character, or importable as reusable maps?
- How much authority should the main roleplay model have to call `world_run` directly?
- Should post-gen observer run every turn, or only when visuals/world-map are enabled?
- How should hidden/locked exits be represented in v1?
