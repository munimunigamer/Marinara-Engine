// ──────────────────────────────────────────────
// Schema: World Graph Runtime
// ──────────────────────────────────────────────
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { chats } from "./chats.js";

export const worldGraphs = sqliteTable("world_graphs", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").references(() => chats.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Serialized Graphology graph checkpoint. Patch history remains the source of truth. */
  snapshotJson: text("snapshot_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const worldPatches = sqliteTable("world_patches", {
  id: text("id").primaryKey(),
  graphId: text("graph_id")
    .notNull()
    .references(() => worldGraphs.id, { onDelete: "cascade" }),
  chatId: text("chat_id").references(() => chats.id, { onDelete: "cascade" }),
  sourceRole: text("source_role", { enum: ["user", "assistant", "manual", "ingest"] }).notNull(),
  sourcePhase: text("source_phase", {
    enum: ["pre_generation", "tool", "post_generation", "manual", "ingest"],
  }).notNull(),
  messageId: text("message_id"),
  swipeIndex: integer("swipe_index"),
  status: text("status", { enum: ["pending", "committed", "inactive", "orphaned", "rejected"] }).notNull(),
  code: text("code"),
  patchJson: text("patch_json").notNull().default('{"ops":[],"events":[]}'),
  resultJson: text("result_json"),
  createdAt: text("created_at").notNull(),
  committedAt: text("committed_at"),
});
