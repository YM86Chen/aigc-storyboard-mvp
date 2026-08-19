import { env } from "cloudflare:workers";
import {
  validateProjectDraft,
  type LocalProjectDraft,
} from "../lib/projects.ts";
import type {
  CloudProject,
  ProjectStore,
  ProjectUpdateResult,
} from "../lib/cloud-projects.ts";

interface ProjectRow {
  id: string;
  ownerId: string;
  name: string;
  script: string;
  storyboardJson: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

function database() {
  if (!env.DB) throw new Error("D1 binding unavailable");
  return env.DB;
}

function projectFromRow(row: ProjectRow): CloudProject {
  const draft: unknown = {
    id: row.id,
    name: row.name,
    script: row.script,
    storyboard: JSON.parse(row.storyboardJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  const validation = validateProjectDraft(draft);
  if (!validation.ok || !Number.isInteger(row.version) || row.version < 1) {
    throw new Error("Invalid project row");
  }
  return { ...validation.value, version: row.version };
}

function writeValues(project: LocalProjectDraft) {
  return [project.name, project.script, JSON.stringify(project.storyboard)] as const;
}

export function getProjectStore(): ProjectStore {
  return {
    async list(ownerId) {
      const result = await database().prepare(`
        SELECT id, owner_id AS ownerId, name, script,
               storyboard_json AS storyboardJson, version,
               created_at AS createdAt, updated_at AS updatedAt
        FROM projects
        WHERE owner_id = ?
        ORDER BY updated_at DESC, id ASC
      `).bind(ownerId).all<ProjectRow>();
      return result.results.map(projectFromRow);
    },

    async create(ownerId, project) {
      const [name, script, storyboardJson] = writeValues(project);
      await database().prepare(`
        INSERT INTO projects
          (id, owner_id, name, script, storyboard_json, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        project.id,
        ownerId,
        name,
        script,
        storyboardJson,
        project.version,
        project.createdAt,
        project.updatedAt,
      ).run();
      return project;
    },

    async get(ownerId, id) {
      const row = await database().prepare(`
        SELECT id, owner_id AS ownerId, name, script,
               storyboard_json AS storyboardJson, version,
               created_at AS createdAt, updated_at AS updatedAt
        FROM projects
        WHERE id = ? AND owner_id = ?
        LIMIT 1
      `).bind(id, ownerId).first<ProjectRow>();
      return row ? projectFromRow(row) : null;
    },

    async update(ownerId, id, expectedVersion, input, updatedAt): Promise<ProjectUpdateResult> {
      const [name, script, storyboardJson] = writeValues({
        ...input,
        id,
        createdAt: updatedAt,
        updatedAt,
      });
      const row = await database().prepare(`
        UPDATE projects
        SET name = ?, script = ?, storyboard_json = ?,
            version = version + 1, updated_at = ?
        WHERE id = ? AND owner_id = ? AND version = ?
        RETURNING id, owner_id AS ownerId, name, script,
                  storyboard_json AS storyboardJson, version,
                  created_at AS createdAt, updated_at AS updatedAt
      `).bind(
        name,
        script,
        storyboardJson,
        updatedAt,
        id,
        ownerId,
        expectedVersion,
      ).first<ProjectRow>();
      if (row) return { status: "updated", project: projectFromRow(row) };

      const existing = await this.get(ownerId, id);
      return existing ? { status: "conflict" } : { status: "not_found" };
    },

    async delete(ownerId, id) {
      const result = await database().prepare(
        "DELETE FROM projects WHERE id = ? AND owner_id = ?",
      ).bind(id, ownerId).run();
      return (result.meta.changes ?? 0) > 0;
    },
  };
}
