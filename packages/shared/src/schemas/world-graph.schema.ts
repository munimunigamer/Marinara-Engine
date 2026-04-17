// ──────────────────────────────────────────────
// World Graph Zod Schemas
// ──────────────────────────────────────────────
import { z } from "zod";

export const worldNodeKindSchema = z.enum(["location", "character", "item"]);
export const worldEdgeKindSchema = z.enum(["connects_to", "at", "in", "held_by"]);
export const worldPatchSourceRoleSchema = z.enum(["user", "assistant", "manual", "ingest"]);
export const worldPatchSourcePhaseSchema = z.enum(["pre_generation", "tool", "post_generation", "manual", "ingest"]);
export const worldPatchStatusSchema = z.enum(["pending", "committed", "inactive", "orphaned", "rejected"]);

const attrsSchema = z.record(z.unknown()).default({});
const tagsSchema = z.array(z.string()).default([]);

export const worldPatchOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("createLocation"),
    key: z.string().min(1).optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    tags: tagsSchema.optional(),
    data: attrsSchema.optional(),
    x: z.number().nullable().optional(),
    y: z.number().nullable().optional(),
    floor: z.string().nullable().optional(),
    revealed: z.boolean().optional(),
    visited: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("createCharacter"),
    key: z.string().min(1).optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    data: attrsSchema.optional(),
  }),
  z.object({
    type: z.literal("createItem"),
    key: z.string().min(1).optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    tags: tagsSchema.optional(),
    data: attrsSchema.optional(),
  }),
  z.object({
    type: z.literal("updateLocation"),
    key: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    tags: tagsSchema.optional(),
    data: attrsSchema.optional(),
    x: z.number().nullable().optional(),
    y: z.number().nullable().optional(),
    floor: z.string().nullable().optional(),
    revealed: z.boolean().optional(),
    visited: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("updateCharacter"),
    key: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    data: attrsSchema.optional(),
  }),
  z.object({
    type: z.literal("updateItem"),
    key: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    tags: tagsSchema.optional(),
    data: attrsSchema.optional(),
  }),
  z.object({
    type: z.literal("connectLocations"),
    from: z.string().min(1),
    to: z.string().min(1),
    bidirectional: z.boolean().optional(),
    data: attrsSchema.optional(),
  }),
  z.object({
    type: z.literal("disconnectLocations"),
    from: z.string().min(1),
    to: z.string().min(1),
    bidirectional: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("moveCharacter"),
    character: z.string().min(1),
    to: z.string().min(1),
  }),
  z.object({
    type: z.literal("placeItem"),
    item: z.string().min(1),
    location: z.string().min(1),
  }),
  z.object({
    type: z.literal("takeItem"),
    character: z.string().min(1),
    item: z.string().min(1),
  }),
  z.object({
    type: z.literal("dropItem"),
    character: z.string().min(1),
    item: z.string().min(1),
  }),
  z.object({
    type: z.literal("revealLocation"),
    location: z.string().min(1),
  }),
  z.object({
    type: z.literal("visitLocation"),
    location: z.string().min(1),
  }),
]);

export const worldGraphPatchSchema = z.object({
  ops: z.array(worldPatchOperationSchema).default([]),
  events: z.array(z.string()).default([]),
  result: attrsSchema.optional(),
});

export const worldRunRequestSchema = z.object({
  patch: worldGraphPatchSchema.optional(),
  code: z.string().optional(),
  apply: z.boolean().default(false),
  sourceRole: worldPatchSourceRoleSchema.default("manual"),
  sourcePhase: worldPatchSourcePhaseSchema.default("tool"),
  messageId: z.string().nullable().optional(),
  swipeIndex: z.number().int().nullable().optional(),
});

export type WorldPatchOperation = z.infer<typeof worldPatchOperationSchema>;
export type WorldGraphPatch = z.infer<typeof worldGraphPatchSchema>;
export type WorldRunRequestInput = z.infer<typeof worldRunRequestSchema>;
