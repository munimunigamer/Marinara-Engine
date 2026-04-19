# World Graph Lorebook Sync Rework

## Core Direction

Use one structured graph-update output per chunk.

Do not use a multi-round tool loop for lorebook ingest.
Do not rely on freeform script text as the main interchange format.
The cleaner design is:

1. chunk lorebooks by whole entries only
2. feed one chunk at a time
3. carry forward a minified current world state
4. have the model return one structured JSON payload each round with a `code` string
5. validate and apply that code in TypeScript via the world script runtime
6. feed the updated minified state into the next chunk

So the loop becomes:

`next_graph = apply(validated_code(minified_graph, lorebook_chunk))`

not:

`draft_scripts -> giant final reconciliation`

## Why Change the Current Flow

The current sync path in `packages/server/src/services/world-graph/world-graph-lorebook-sync.ts` does this:

1. build a global manifest
2. split by raw char size
3. generate one draft script per batch
4. carry forward a digest of prior scripts and patch history
5. reconcile everything in one final script

That has three problems:

- chunk boundaries are based on size, not whole-entry meaning
- the carry-forward artifact is script history instead of state
- the final reconciliation is doing too much work
- freeform script generation is less consistent than schema-bound output

## Non-Goals

These should not be part of the new design:

- no local heuristic entity extraction pre-pass as a required step
- no paragraph splitting
- no partial-entry chunking
- no per-batch draft-script pileup that later needs heavy merging
- no multi-round per-chunk tool loop unless we discover a concrete failure mode that requires it

## Chunking Rules

### Whole Entry Only

An entry must be atomic for sync.

- if adding the next entry would exceed `syncChunkCharLimit`, stop the chunk there
- put the whole entry into the next chunk
- never split one entry across requests

That matters because a single lorebook entry may describe:

- multiple locations
- multiple characters
- relationships between them
- containment and travel rules in the same prose block

Splitting that entry is almost guaranteed to break meaning.

### Oversized Single Entry

If a single entry exceeds the limit by itself, still send the whole entry.

That means the effective rule is:

- `syncChunkCharLimit` is a target for normal packing
- one oversized entry is allowed to exceed it if needed

Cutting or splitting the entry is worse than temporarily exceeding the target.

### Ordering

Default ordering should stay simple and deterministic:

- preserve current lorebook/entry order
- optionally keep adjacent entries from the same explicit group together when possible

Do not introduce a heuristic semantic clustering pass that tries to infer entities locally before the model sees the text.

## Carry Forward State, Not Scripts

The next call should receive a minified current world state, not:

- prior script tails
- a long patch log
- a giant global manifest

Suggested state payload:

```ts
type WorldStateDigest = {
  nodes: Array<[
    id,
    kind,
    name,
    aliasesCsv,
    shortDescription,
    tagsCsv,
    flags
  ]>;
  edges: Array<[
    fromId,
    relation,
    toId,
    typeOrLabel
  ]>;
  currentScene?: {
    playerLocationId?: string;
    visibleLocationIds?: string[];
    presentCharacterIds?: string[];
  };
};
```

Keep it short and canonical:

- stable ids
- canonical names
- aliases
- one-line descriptions
- essential edges only

This gives the model continuity without replaying the entire ingest history.

## Recommended Sync Loop

### Sequential Structured Fold

For each chunk:

1. send the chunk plus current scene context plus minified graph state
2. require exactly one structured graph update output
3. validate it with a Zod schema
4. apply the resulting patch locally in TypeScript
5. rebuild the minified state digest
6. move to the next chunk

This is the important shift:

- the world graph itself becomes the memory
- the prompt only carries the compact state snapshot
- each chunk updates the living graph instead of producing an isolated draft
- the server owns graph mutation semantics, not generated JavaScript

### Output Form

Use strict JSON for every provider.

The model returns one JSON object in the response body, which is then:

- extracted
- repaired if needed
- parsed
- validated

This keeps the behavior the same across OpenAI-compatible providers, Anthropic, and Gemini.

Required shape:

```json
{
  "code": "createLocation({ key: \"...\", name: \"...\" });"
}
```

## Patch Shape

The best first version is to keep the existing world DSL and wrap it in strict JSON.

That means the output should align closely with:

- `runWorldGraphScript(...)`
- the existing world DSL
- `applyWorldPatch(...)`

in the current codebase.

At minimum, the code string should use:

- `createLocation`
- `createCharacter`
- `createItem`
- `connectLocations`
- `placeLocation`
- `move`
- `place`
- `reveal`
- `visit`

That keeps the ingest output directly compatible with the current graph runtime while still staying structured at the transport layer.

## Why This Fits the Repo

The repo already has the right primitives:

- `runWorldGraphScript(...)` in `packages/server/src/services/world-graph/world-graph-script-runtime.ts`
- TypeScript patch application in `packages/server/src/services/world-graph/world-graph-runtime.ts`
- provider-agnostic non-streaming completions in `packages/server/src/services/llm/base-provider.ts`

So the server already knows how to:

- validate generated world code
- convert it into a graph patch
- apply it deterministically
- persist it

The missing piece is just the per-chunk orchestration and strict JSON validation.

## Prompt Shape

The chunk prompt should be narrower than today.

Instead of:

- full lorebook manifest
- full graph digest
- draft scripts
- freeform code requirements

Use:

- current scene context
- minified current world state
- whole-entry chunk
- clear mutation rules
- explicit output contract for one structured JSON object with a `code` string

The model should be told:

- do not recreate nodes when an existing node clearly matches
- prefer updating canonical nodes over creating near-duplicates
- only create travel edges for actual navigable movement
- use containment for parent/inside/region relationships
- preserve prior graph state unless the new chunk clearly contradicts it

## Validation

Validate the structured code before application.

Recommended order:

1. parse structured output
2. ensure it has the shape `{ "code": "..." }`
3. execute it through `runWorldGraphScript(...)`
4. apply the resulting patch
5. if needed, run a small repair retry by asking for corrected structured code

The important change is that validation happens on structured data, not generated script text.

Validate one chunk update at a time, not a giant final reconciliation assembled from many drafts.

## Config Surface

Keep config small.

Recommended settings:

- `syncChunkCharLimit`
- `syncEntryDetail: "preview" | "full"`
- `syncOutputMode: "json_code"`

Behavior:

- `syncChunkCharLimit` controls how many whole entries fit in a chunk
- `syncEntryDetail` controls preview vs full entry content
- `syncOutputMode` stays on strict JSON for every provider

If we want a default:

- keep `preview` for normal sync
- keep whole-entry chunking mandatory
- use `json_code`

## Recommended Implementation Order

### PR 1: Whole-Entry Chunking

- remove any design that allows entry splitting
- change chunk assembly to whole-entry packing only
- if one entry is oversized, still send it whole

This is the first correctness fix.

### PR 2: Replace Script-History Carry Forward

- stop sending prior script tails
- build and send a compact `WorldStateDigest` instead

This is the main token-efficiency fix.

### PR 3: Sequential Structured Fold

- process chunks one at a time
- require one structured JSON code output per chunk
- validate and apply each chunk result immediately
- feed the updated compact state into the next chunk
- reduce or remove the need for global final reconciliation

This is the main architecture change.

### PR 4: JSON Code Repair / Validation Loop

- keep one strict JSON code output per chunk
- run the code through the world script runtime
- retry with validation errors when the output is malformed

This is the main consistency improvement.

## Recommended Direction

The best rework is not a multi-step agent loop.
It is:

- whole-entry chunking
- minified world-state carry-forward
- one structured JSON code output per chunk
- immediate TypeScript/runtime application after each chunk

That directly solves the concerns you raised:

- entries describing multiple locations or characters stay intact
- description detail remains configurable
- the next call gets a compact current world state
- each new chunk builds on the actual graph instead of on a pile of draft scripts
- graph mutation becomes much more consistent because the output is schema-bound
