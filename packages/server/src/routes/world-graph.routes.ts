// ──────────────────────────────────────────────
// Routes: World Graph
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { worldRunRequestSchema, worldGraphPatchSchema } from "@marinara-engine/shared";
import { createWorldGraphStorage } from "../services/world-graph/world-graph.storage.js";
import { createWorldGraphLifecycle } from "../services/world-graph/world-graph-lifecycle.js";
import { createWorldGraphTools } from "../services/world-graph/world-graph-tools.js";
import { buildWorldMap, buildWorldObservation } from "../services/world-graph/world-graph-retrieval.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createLorebooksStorage } from "../services/storage/lorebooks.storage.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createAgentsStorage } from "../services/storage/agents.storage.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import { ensureWorldGraphPlayer } from "../services/world-graph/world-graph-bootstrap.js";
import { buildWorldGraphPatchFromLorebooks } from "../services/world-graph/world-graph-lorebook-sync.js";
import { runWorldGraphScript } from "../services/world-graph/world-graph-script-runtime.js";

const worldGraphSyncLorebooksSchema = z.object({
  connectionId: z.string().optional(),
  replace: z.boolean().default(true),
});

export async function worldGraphRoutes(app: FastifyInstance) {
  const storage = createWorldGraphStorage(app.db);
  const lifecycle = createWorldGraphLifecycle(app.db);
  const tools = createWorldGraphTools(app.db);
  const chats = createChatsStorage(app.db);
  const lorebooks = createLorebooksStorage(app.db);
  const characters = createCharactersStorage(app.db);
  const connections = createConnectionsStorage(app.db);
  const agents = createAgentsStorage(app.db);

  app.get<{ Params: { chatId: string } }>("/:chatId/observe", async (req, reply) => {
    if (!(await chats.getById(req.params.chatId))) return reply.status(404).send({ error: "Chat not found" });
    await ensureWorldGraphPlayer(app.db, req.params.chatId);
    const { graph, runtime, events } = await storage.getCurrentGraphForChat(req.params.chatId);
    return buildWorldObservation(graph.id, runtime, events);
  });

  app.get<{ Params: { chatId: string } }>("/:chatId/map", async (req, reply) => {
    if (!(await chats.getById(req.params.chatId))) return reply.status(404).send({ error: "Chat not found" });
    await ensureWorldGraphPlayer(app.db, req.params.chatId);
    const { graph, runtime } = await storage.getCurrentGraphForChat(req.params.chatId);
    return buildWorldMap(graph.id, runtime);
  });

  app.post<{ Params: { chatId: string } }>("/:chatId/run", async (req, reply) => {
    if (!(await chats.getById(req.params.chatId))) return reply.status(404).send({ error: "Chat not found" });
    await ensureWorldGraphPlayer(app.db, req.params.chatId);
    const input = worldRunRequestSchema.parse(req.body);
    let patchResult:
      | Awaited<ReturnType<typeof resolveScriptInput>>
      | { patch: ReturnType<typeof worldGraphPatchSchema.parse>; scriptResult: undefined };
    try {
      patchResult = input.patch
        ? { patch: worldGraphPatchSchema.parse(input.patch), scriptResult: undefined }
        : await resolveScriptInput(req.params.chatId, input.code);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "World script failed" });
    }
    if (!patchResult) return reply.status(400).send({ error: "Provide a world graph patch or world script code." });

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
      scriptResult: patchResult.scriptResult,
    };
  });

  app.post<{ Params: { chatId: string } }>("/:chatId/rebuild", async (req, reply) => {
    if (!(await chats.getById(req.params.chatId))) return reply.status(404).send({ error: "Chat not found" });
    const { graph, runtime, events } = await lifecycle.rebuildForChat(req.params.chatId);
    await ensureWorldGraphPlayer(app.db, req.params.chatId);
    const rebuilt = await storage.getCurrentGraphForChat(req.params.chatId);
    return {
      graph: rebuilt.graph,
      observation: buildWorldObservation(rebuilt.graph.id, rebuilt.runtime, rebuilt.events.length > 0 ? rebuilt.events : events),
      map: buildWorldMap(rebuilt.graph.id, rebuilt.runtime),
    };
  });

  app.post<{ Params: { chatId: string } }>("/:chatId/sync-lorebooks", async (req, reply) => {
    const chat = await chats.getById(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });

    const input = worldGraphSyncLorebooksSchema.parse(req.body ?? {});
    const connection = await resolveConnection(input.connectionId, chat.connectionId);
    if (!connection) {
      return reply.status(400).send({ error: "No API connection configured for lorebook sync." });
    }

    const relevantLorebooks = await getRelevantLorebooks(chat);
    const scene = await buildSceneContext(chat);
    const provider = createLLMProvider(connection.conn.provider, connection.baseUrl, connection.conn.apiKey);

    let syncResult: Awaited<ReturnType<typeof buildWorldGraphPatchFromLorebooks>>;
    try {
      syncResult = await buildWorldGraphPatchFromLorebooks({
        provider,
        model: connection.conn.model,
        lorebooks: relevantLorebooks,
        scene,
      });
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Lorebook sync failed.",
      });
    }

    const result = input.replace
      ? await storage.replaceForChat({
          chatId: req.params.chatId,
          patch: syncResult.patch,
          apply: true,
          sourceRole: "ingest",
          sourcePhase: "ingest",
          code: null,
        })
      : await tools.runPatch({
          chatId: req.params.chatId,
          patch: syncResult.patch,
          apply: true,
          sourceRole: "ingest",
          sourcePhase: "ingest",
          code: null,
        });

    return {
      synced: true,
      replace: input.replace,
      stats: syncResult.stats,
      graph: result.graph,
      patch: result.patch,
      patchRecord: result.patchRecord,
      observation: buildWorldObservation(result.graph.id, result.runtime, result.events),
      map: buildWorldMap(result.graph.id, result.runtime),
    };
  });

  app.get<{ Params: { chatId: string } }>("/:chatId", async (req, reply) => {
    if (!(await chats.getById(req.params.chatId))) return reply.status(404).send({ error: "Chat not found" });
    await ensureWorldGraphPlayer(app.db, req.params.chatId);
    const { graph, runtime } = await storage.getCurrentGraphForChat(req.params.chatId);
    return {
      graph,
      map: buildWorldMap(graph.id, runtime),
    };
  });

  async function resolveScriptInput(chatId: string, code: string | undefined) {
    if (!code?.trim()) {
      return null;
    }

    const current = await storage.getCurrentGraphForChat(chatId);
    const scriptResult = await runWorldGraphScript(current.graph.id, current.runtime, code);
    return {
      patch: scriptResult.patch,
      scriptResult: scriptResult.scriptResult,
    };
  }

  async function resolveConnection(connectionId: string | undefined, chatConnectionId: string | null | undefined) {
    const worldGraphAgent = await agents.getByType("world-graph");
    const defaultAgentConn = await connections.getDefaultForAgents();
    let requestedId = connectionId ?? worldGraphAgent?.connectionId ?? defaultAgentConn?.id ?? chatConnectionId ?? undefined;
    if (requestedId === "random") {
      const pool = await connections.listRandomPool();
      requestedId = pool.length ? pool[Math.floor(Math.random() * pool.length)]!.id : undefined;
    }
    let conn = requestedId ? await connections.getWithKey(requestedId) : null;
    conn ??= defaultAgentConn;
    const defaultConn = conn ? null : await connections.getDefault();
    conn ??= defaultConn ? await connections.getWithKey(defaultConn.id) : null;
    if (!conn) return null;

    let baseUrl = conn.baseUrl;
    if (!baseUrl) {
      const { PROVIDERS } = await import("@marinara-engine/shared");
      const providerDef = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
      baseUrl = providerDef?.defaultBaseUrl ?? "";
    }
    if (!baseUrl) return null;
    return { conn, baseUrl };
  }

  async function getRelevantLorebooks(chat: Awaited<ReturnType<typeof chats.getById>>) {
    if (!chat) return [];
    const metadata = parseJsonRecord(chat.metadata);
    const activeLorebookIds = Array.isArray(metadata.activeLorebookIds) ? metadata.activeLorebookIds.map(String) : [];
    const characterIds = parseStringArray(chat.characterIds);
    const allBooks = (await lorebooks.list()) as any[];
    const relevantBooks = allBooks.filter((book) => {
      if (!book.enabled) return false;
      if (activeLorebookIds.includes(book.id)) return true;
      if (book.chatId && book.chatId === chat.id) return true;
      if (book.characterId && characterIds.includes(book.characterId)) return true;
      return false;
    });
    const entries = (await lorebooks.listEntriesByLorebooks(relevantBooks.map((book) => book.id))) as any[];
    const entriesByBook = new Map<string, any[]>();
    for (const entry of entries) {
      if (!entry.enabled) continue;
      const bucket = entriesByBook.get(entry.lorebookId) ?? [];
      bucket.push(entry);
      entriesByBook.set(entry.lorebookId, bucket);
    }
    return relevantBooks.map((book) => ({ ...book, entries: entriesByBook.get(book.id) ?? [] }));
  }

  async function buildSceneContext(chat: Awaited<ReturnType<typeof chats.getById>>) {
    const metadata = parseJsonRecord(chat?.metadata);
    const characterIds = parseStringArray(chat?.characterIds);
    const characterNames: string[] = [];
    for (const characterId of characterIds) {
      const row = await characters.getById(characterId);
      if (!row) continue;
      const data = parseJsonRecord(row.data);
      const name = typeof data.name === "string" ? data.name.trim() : "";
      if (name) characterNames.push(name);
    }

    let personaName = "Player";
    let personaDescription: string | null = null;
    if (chat?.personaId) {
      const persona = await characters.getPersona(chat.personaId);
      if (persona?.name) personaName = persona.name;
      personaDescription = buildPersonaSummary(persona);
    }

    const messages = chat ? await chats.listMessages(chat.id) : [];
    const recentMessages = messages.slice(-24).map((message: any) => ({
      role: String(message.role ?? "message"),
      content: String(message.content ?? ""),
    }));

    return {
      characterNames,
      personaName,
      personaDescription,
      recentMessages,
      summary: typeof metadata.summary === "string" ? metadata.summary : null,
    };
  }

  function buildPersonaSummary(
    persona:
      | {
          description?: string | null;
          appearance?: string | null;
          personality?: string | null;
        }
      | null
      | undefined,
  ) {
    if (!persona) return null;
    const parts = [
      persona.description?.trim(),
      persona.appearance?.trim() ? `Appearance: ${persona.appearance.trim()}` : "",
      persona.personality?.trim() ? `Personality: ${persona.personality.trim()}` : "",
    ].filter(Boolean);
    return parts.length ? parts.join("\n") : null;
  }

  function parseJsonRecord(value: unknown): Record<string, any> {
    if (!value) return {};
    if (typeof value === "object") return value as Record<string, any>;
    if (typeof value !== "string") return {};
    try {
      return JSON.parse(value) as Record<string, any>;
    } catch {
      return {};
    }
  }

  function parseStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
}
