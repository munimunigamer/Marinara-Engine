// ──────────────────────────────────────────────
// Hooks: World Graph
// ──────────────────────────────────────────────
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorldGraph, WorldGraphPatch, WorldMap, WorldObservation } from "@marinara-engine/shared";
import { api } from "../lib/api-client";

const worldGraphKeys = {
  all: ["world-graph"] as const,
  map: (chatId: string | null) => [...worldGraphKeys.all, chatId, "map"] as const,
  observe: (chatId: string | null) => [...worldGraphKeys.all, chatId, "observe"] as const,
};

export interface WorldGraphRunResponse {
  applied: boolean;
  graph: WorldGraph;
  patch: WorldGraphPatch;
  patchRecord: unknown;
  observation: WorldObservation;
  map: WorldMap;
  scriptResult?: unknown;
}

export interface WorldGraphSyncLorebooksResponse {
  synced: boolean;
  replace: boolean;
  stats: {
    lorebookCount: number;
    entryCount: number;
    batchCount: number;
    operationCount: number;
  };
  graph: WorldGraph;
  patch: WorldGraphPatch;
  patchRecord: unknown;
  observation: WorldObservation;
  map: WorldMap;
}

export function useWorldGraphMap(chatId: string | null) {
  return useQuery({
    queryKey: worldGraphKeys.map(chatId),
    queryFn: () => api.get<WorldMap>(`/world-graph/${chatId}/map`),
    enabled: !!chatId,
    staleTime: 15_000,
  });
}

export function useWorldGraphObservation(chatId: string | null) {
  return useQuery({
    queryKey: worldGraphKeys.observe(chatId),
    queryFn: () => api.get<WorldObservation>(`/world-graph/${chatId}/observe`),
    enabled: !!chatId,
    staleTime: 15_000,
  });
}

export function useRunWorldGraph(chatId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { code?: string; patch?: WorldGraphPatch; apply?: boolean }) => {
      if (!chatId) throw new Error("No active chat");
      return api.post<WorldGraphRunResponse>(`/world-graph/${chatId}/run`, {
        ...input,
        apply: input.apply ?? true,
        sourceRole: "ingest",
        sourcePhase: "ingest",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: worldGraphKeys.all });
    },
  });
}

export function useRebuildWorldGraph(chatId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!chatId) throw new Error("No active chat");
      return api.post<{ graph: WorldGraph; observation: WorldObservation; map: WorldMap }>(
        `/world-graph/${chatId}/rebuild`,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: worldGraphKeys.all });
    },
  });
}

export function useSyncWorldGraphLorebooks(chatId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!chatId) throw new Error("No active chat");
      return api.post<WorldGraphSyncLorebooksResponse>(`/world-graph/${chatId}/sync-lorebooks`, {
        replace: true,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: worldGraphKeys.all });
    },
  });
}
