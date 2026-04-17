// ──────────────────────────────────────────────
// Routes: World Graph
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { worldRunRequestSchema, worldGraphPatchSchema } from "@marinara-engine/shared";
import { createWorldGraphStorage } from "../services/world-graph/world-graph.storage.js";
import { createWorldGraphLifecycle } from "../services/world-graph/world-graph-lifecycle.js";
import { createWorldGraphTools } from "../services/world-graph/world-graph-tools.js";
import { buildWorldMap, buildWorldObservation } from "../services/world-graph/world-graph-retrieval.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";

export async function worldGraphRoutes(app: FastifyInstance) {
  const storage = createWorldGraphStorage(app.db);
  const lifecycle = createWorldGraphLifecycle(app.db);
  const tools = createWorldGraphTools(app.db);
  const chats = createChatsStorage(app.db);

  app.get<{ Params: { chatId: string } }>("/:chatId/observe", async (req, reply) => {
    if (!(await chats.getById(req.params.chatId))) return reply.status(404).send({ error: "Chat not found" });
    const { graph, runtime, events } = await storage.getCurrentGraphForChat(req.params.chatId);
    return buildWorldObservation(graph.id, runtime, events);
  });

  app.get<{ Params: { chatId: string } }>("/:chatId/map", async (req, reply) => {
    if (!(await chats.getById(req.params.chatId))) return reply.status(404).send({ error: "Chat not found" });
    const { graph, runtime } = await storage.getCurrentGraphForChat(req.params.chatId);
    return buildWorldMap(graph.id, runtime);
  });

  app.post<{ Params: { chatId: string } }>("/:chatId/run", async (req, reply) => {
    if (!(await chats.getById(req.params.chatId))) return reply.status(404).send({ error: "Chat not found" });
    const input = worldRunRequestSchema.parse(req.body);
    const patchResult = resolvePatchInput(input.patch, input.code);
    if (!patchResult.ok) {
      return reply.status(400).send({ error: patchResult.error });
    }

    const result = await tools.runPatch({
      chatId: req.params.chatId,
      patch: patchResult.patch,
      apply: input.apply,
      sourceRole: input.sourceRole,
      sourcePhase: input.sourcePhase,
      messageId: input.messageId ?? null,
      swipeIndex: input.swipeIndex ?? null,
      code: input.code ?? null,
    });

    return {
      applied: result.applied,
      graph: result.graph,
      patch: result.patch,
      patchRecord: result.patchRecord,
      observation: buildWorldObservation(result.graph.id, result.runtime, result.events),
      map: buildWorldMap(result.graph.id, result.runtime),
    };
  });

  app.post<{ Params: { chatId: string } }>("/:chatId/rebuild", async (req, reply) => {
    if (!(await chats.getById(req.params.chatId))) return reply.status(404).send({ error: "Chat not found" });
    const { graph, runtime, events } = await lifecycle.rebuildForChat(req.params.chatId);
    return {
      graph,
      observation: buildWorldObservation(graph.id, runtime, events),
      map: buildWorldMap(graph.id, runtime),
    };
  });

  app.get<{ Params: { chatId: string } }>("/:chatId", async (req, reply) => {
    if (!(await chats.getById(req.params.chatId))) return reply.status(404).send({ error: "Chat not found" });
    const { graph, runtime } = await storage.getCurrentGraphForChat(req.params.chatId);
    return {
      graph,
      map: buildWorldMap(graph.id, runtime),
    };
  });
}

function resolvePatchInput(
  patch: unknown,
  code: string | undefined,
):
  | { ok: true; patch: ReturnType<typeof worldGraphPatchSchema.parse> }
  | {
      ok: false;
      error: string;
    } {
  if (patch) {
    return { ok: true, patch: worldGraphPatchSchema.parse(patch) };
  }

  if (!code?.trim()) {
    return { ok: false, error: "Provide a world graph patch. JavaScript DSL execution is planned for phase 2." };
  }

  try {
    const parsed = JSON.parse(code);
    const candidate = parsed.patch ?? parsed;
    return { ok: true, patch: worldGraphPatchSchema.parse(candidate) };
  } catch {
    return {
      ok: false,
      error:
        "Phase 1 only accepts JSON patch input in code. JavaScript DSL execution will be added with the QuickJS runtime in phase 2.",
    };
  }
}
