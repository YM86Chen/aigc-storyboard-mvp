import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  script: text("script").notNull(),
  storyboardJson: text("storyboard_json").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_projects_owner_updated").on(table.ownerId, table.updatedAt),
]);

export const generationLimits = sqliteTable("generation_limits", {
  ownerId: text("owner_id").primaryKey(),
  requestId: text("request_id").notNull(),
  lastStartedAt: integer("last_started_at").notNull(),
  leaseExpiresAt: integer("lease_expires_at").notNull(),
});
