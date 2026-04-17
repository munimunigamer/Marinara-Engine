// ──────────────────────────────────────────────
// Storage: World Graph Patch History
// ──────────────────────────────────────────────
import { and, asc, eq, inArray } from "drizzle-orm";
import { worldGraphs, worldPatches } from "../../db/schema/index.js";
import type { DB } from "../../db/connection.js";
import { newId, now } from "../../utils/id-generator.js";
import {
  applyWorldPatch,
  createWorldGraphRuntime,
  exportWorldGraphRuntime,
  importWorldGraphRuntime,
  type WorldGraphRuntime,
} from "./world-graph-runtime.js";
import { worldGraphPatchSchema } from "@marinara-engine/shared";
import type {
  WorldGraph,
  WorldGraphPatch,
  WorldPatchSourcePhase,
  WorldPatchSourceRole,
  WorldPatchStatus,
} from "@marinara-engine/shared";

type WorldGraphRow = typeof worldGraphs.$inferSelect;
type WorldPatchRow = typeof worldPatches.$inferSelect;

export interface WorldPatchRecord {
  id: string;
  graphId: string;
  chatId: string | null;
  sourceRole: WorldPatchSourceRole;
  sourcePhase: WorldPatchSourcePhase;
  messageId: string | null;
  swipeIndex: number | null;
  status: WorldPatchStatus;
  code: string | null;
  patch: WorldGraphPatch;
  result: Record<string, unknown> | null;
  createdAt: string;
  committedAt: string | null;
}

export interface CurrentWorldGraph {
  graph: WorldGraph;
  runtime: WorldGraphRuntime;
  events: string[];
}

export interface RunWorldPatchResult extends CurrentWorldGraph {
  patch: WorldGraphPatch;
  patchRecord: WorldPatchRecord | null;
  applied: boolean;
}

interface SavePatchInput {
  graphId: string;
  chatId: string | null;
  sourceRole: WorldPatchSourceRole;
  sourcePhase: WorldPatchSourcePhase;
  messageId?: string | null;
  swipeIndex?: number | null;
  status: WorldPatchStatus;
  code?: string | null;
  patch: WorldGraphPatch;
  result?: Record<string, unknown> | null;
}

interface RunPatchInput {
  chatId: string;
  patch: WorldGraphPatch;
  apply: boolean;
  sourceRole?: WorldPatchSourceRole;
  sourcePhase?: WorldPatchSourcePhase;
  messageId?: string | null;
  swipeIndex?: number | null;
  code?: string | null;
}

const MATERIALIZED_PATCH_STATUSES: WorldPatchStatus[] = ["committed"];

export interface WorldGraphStorage {
  getGraphByChatId(chatId: string): Promise<WorldGraph | null>;
  getOrCreateGraphForChat(chatId: string, name?: string): Promise<WorldGraph>;
  getCurrentGraph(graphId: string): Promise<CurrentWorldGraph>;
  getCurrentGraphForChat(chatId: string): Promise<CurrentWorldGraph>;
  savePatch(input: SavePatchInput): Promise<WorldPatchRecord>;
  runPatch(input: RunPatchInput): Promise<RunWorldPatchResult>;
  rebuildGraph(graphId: string): Promise<CurrentWorldGraph>;
  rebuildForChat(chatId: string): Promise<CurrentWorldGraph>;
  saveSnapshot(graphId: string, runtime: WorldGraphRuntime): Promise<void>;
}

export function createWorldGraphStorage(db: DB): WorldGraphStorage {
  return {
    async getGraphByChatId(chatId: string): Promise<WorldGraph | null> {
      const rows = await db.select().from(worldGraphs).where(eq(worldGraphs.chatId, chatId)).limit(1);
      return rows[0] ? rowToGraph(rows[0]) : null;
    },

    async getOrCreateGraphForChat(chatId: string, name?: string): Promise<WorldGraph> {
      const existing = await this.getGraphByChatId(chatId);
      if (existing) return existing;

      const id = newId();
      const timestamp = now();
      await db.insert(worldGraphs).values({
        id,
        chatId,
        name: name ?? "World",
        snapshotJson: exportWorldGraphRuntime(createWorldGraphRuntime()),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const created = await this.getGraphByChatId(chatId);
      if (!created) throw new Error("Failed to create world graph");
      return created;
    },

    async getCurrentGraph(graphId: string): Promise<CurrentWorldGraph> {
      const graphRows = await db.select().from(worldGraphs).where(eq(worldGraphs.id, graphId)).limit(1);
      if (!graphRows[0]) throw new Error("World graph not found");
      const graph = rowToGraph(graphRows[0]);
      const runtime = importWorldGraphRuntime(graph.snapshotJson);
      const patchRows = await listMaterializedPatchRows(db, graph.id);
      return {
        graph,
        runtime,
        events: patchRows.flatMap((row) => rowToPatch(row).patch.events),
      };
    },

    async getCurrentGraphForChat(chatId: string): Promise<CurrentWorldGraph> {
      const graph = await this.getOrCreateGraphForChat(chatId);
      return this.getCurrentGraph(graph.id);
    },

    async savePatch(input: SavePatchInput): Promise<WorldPatchRecord> {
      const id = newId();
      const timestamp = now();
      const parsedPatch = worldGraphPatchSchema.parse(input.patch);
      const committedAt = input.status === "committed" ? timestamp : null;

      await db.insert(worldPatches).values({
        id,
        graphId: input.graphId,
        chatId: input.chatId,
        sourceRole: input.sourceRole,
        sourcePhase: input.sourcePhase,
        messageId: input.messageId ?? null,
        swipeIndex: input.swipeIndex ?? null,
        status: input.status,
        code: input.code ?? null,
        patchJson: JSON.stringify(parsedPatch),
        resultJson: input.result ? JSON.stringify(input.result) : null,
        createdAt: timestamp,
        committedAt,
      });

      const rows = await db.select().from(worldPatches).where(eq(worldPatches.id, id)).limit(1);
      if (!rows[0]) throw new Error("Failed to save world patch");
      return rowToPatch(rows[0]);
    },

    async runPatch(input: RunPatchInput): Promise<RunWorldPatchResult> {
      const current = await this.getCurrentGraphForChat(input.chatId);
      const applied = applyWorldPatch(current.runtime.copy() as WorldGraphRuntime, input.patch);
      const patch: WorldGraphPatch = {
        ...input.patch,
        events: applied.events,
      };

      let patchRecord: WorldPatchRecord | null = null;
      if (input.apply) {
        patchRecord = await this.savePatch({
          graphId: current.graph.id,
          chatId: input.chatId,
          sourceRole: input.sourceRole ?? "manual",
          sourcePhase: input.sourcePhase ?? "tool",
          messageId: input.messageId ?? null,
          swipeIndex: input.swipeIndex ?? null,
          status: "committed",
          code: input.code ?? null,
          patch,
          result: input.patch.result ?? null,
        });
        await this.saveSnapshot(current.graph.id, applied.graph);
      }

      return {
        graph: current.graph,
        runtime: applied.graph,
        events: [...current.events, ...applied.events],
        patch,
        patchRecord,
        applied: input.apply,
      };
    },

    async rebuildGraph(graphId: string): Promise<CurrentWorldGraph> {
      const patchRows = await listMaterializedPatchRows(db, graphId);
      const runtime = createWorldGraphRuntime();
      const events: string[] = [];

      for (const row of patchRows) {
        const patch = rowToPatch(row).patch;
        const applied = applyWorldPatch(runtime, patch);
        events.push(...applied.events);
      }

      await this.saveSnapshot(graphId, runtime);
      const graphRows = await db.select().from(worldGraphs).where(eq(worldGraphs.id, graphId)).limit(1);
      if (!graphRows[0]) throw new Error("World graph not found");
      return { graph: rowToGraph(graphRows[0]), runtime, events };
    },

    async rebuildForChat(chatId: string): Promise<CurrentWorldGraph> {
      const graph = await this.getOrCreateGraphForChat(chatId);
      return this.rebuildGraph(graph.id);
    },

    async saveSnapshot(graphId: string, runtime: WorldGraphRuntime): Promise<void> {
      await db
        .update(worldGraphs)
        .set({
          snapshotJson: exportWorldGraphRuntime(runtime),
          updatedAt: now(),
        })
        .where(eq(worldGraphs.id, graphId));
    },
  };
}

async function listMaterializedPatchRows(db: DB, graphId: string) {
  return db
    .select()
    .from(worldPatches)
    .where(and(eq(worldPatches.graphId, graphId), inArray(worldPatches.status, MATERIALIZED_PATCH_STATUSES)))
    .orderBy(asc(worldPatches.createdAt));
}

function rowToGraph(row: WorldGraphRow): WorldGraph {
  return {
    id: row.id,
    chatId: row.chatId,
    name: row.name,
    snapshotJson: row.snapshotJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToPatch(row: WorldPatchRow): WorldPatchRecord {
  return {
    id: row.id,
    graphId: row.graphId,
    chatId: row.chatId,
    sourceRole: row.sourceRole,
    sourcePhase: row.sourcePhase,
    messageId: row.messageId,
    swipeIndex: row.swipeIndex,
    status: row.status,
    code: row.code,
    patch: worldGraphPatchSchema.parse(parseJson(row.patchJson, { ops: [], events: [] })),
    result: row.resultJson ? parseJson<Record<string, unknown>>(row.resultJson, {}) : null,
    createdAt: row.createdAt,
    committedAt: row.committedAt,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
