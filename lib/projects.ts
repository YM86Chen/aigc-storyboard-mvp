import { validateStoryboard, type Storyboard } from "./storyboard.ts";

export const PROJECT_LIBRARY_STORAGE_KEY = "zhenyu.project-library.v1";
export const PROJECT_BACKUP_FORMAT = "zhenyu-storyboard-project";

export interface LocalProjectDraft {
  id: string;
  name: string;
  script: string;
  storyboard: Storyboard | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectLibrary {
  version: 1;
  activeProjectId: string;
  projects: LocalProjectDraft[];
}

export interface ProjectBackup {
  format: typeof PROJECT_BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  project: LocalProjectDraft;
}

export type ProjectValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function defaultId() {
  return globalThis.crypto?.randomUUID?.() ?? `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createProjectDraft(
  name = "未命名项目",
  options: { id?: string; now?: string } = {},
): LocalProjectDraft {
  const now = options.now ?? new Date().toISOString();
  return {
    id: options.id ?? defaultId(),
    name,
    script: "",
    storyboard: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function validateProjectDraft(value: unknown): ProjectValidationResult<LocalProjectDraft> {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.name)
    || typeof value.script !== "string"
    || !isNonEmptyString(value.createdAt)
    || !isNonEmptyString(value.updatedAt)) {
    return { ok: false, error: "项目基本信息不完整。" };
  }

  if (value.storyboard === null) {
    return { ok: true, value: value as unknown as LocalProjectDraft };
  }

  const storyboardValidation = validateStoryboard(value.storyboard);
  if (!storyboardValidation.ok) {
    return { ok: false, error: storyboardValidation.error };
  }
  if (storyboardValidation.value.sourceScript !== value.script) {
    return { ok: false, error: "项目脚本与故事板中的原始脚本不一致。" };
  }

  return { ok: true, value: value as unknown as LocalProjectDraft };
}

export function validateProjectLibrary(value: unknown): ProjectValidationResult<ProjectLibrary> {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.projects) || value.projects.length === 0) {
    return { ok: false, error: "本地项目库格式不正确。" };
  }

  const projects: LocalProjectDraft[] = [];
  for (const project of value.projects) {
    const validation = validateProjectDraft(project);
    if (!validation.ok) {
      return { ok: false, error: `无法恢复本地项目：${validation.error}` };
    }
    projects.push(validation.value);
  }

  if (new Set(projects.map((project) => project.id)).size !== projects.length) {
    return { ok: false, error: "本地项目 ID 存在重复。" };
  }
  if (!isNonEmptyString(value.activeProjectId)
    || !projects.some((project) => project.id === value.activeProjectId)) {
    return { ok: false, error: "本地项目库的当前项目无效。" };
  }

  return {
    ok: true,
    value: {
      version: 1,
      activeProjectId: value.activeProjectId,
      projects,
    },
  };
}

export function createProjectBackup(project: LocalProjectDraft, exportedAt = new Date().toISOString()) {
  const validation = validateProjectDraft(project);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const backup: ProjectBackup = {
    format: PROJECT_BACKUP_FORMAT,
    version: 1,
    exportedAt,
    project: validation.value,
  };
  return JSON.stringify(backup, null, 2);
}

export function parseProjectBackup(
  json: string,
  options: { id?: string; now?: string } = {},
): ProjectValidationResult<LocalProjectDraft> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, error: "JSON 文件无法解析，请确认它是帧语导出的项目备份。" };
  }

  if (!isRecord(value)
    || value.format !== PROJECT_BACKUP_FORMAT
    || value.version !== 1
    || !isNonEmptyString(value.exportedAt)) {
    return { ok: false, error: "JSON 备份格式或版本不受支持。" };
  }

  const projectValidation = validateProjectDraft(value.project);
  if (!projectValidation.ok) {
    return { ok: false, error: `JSON 备份校验失败：${projectValidation.error}` };
  }

  const now = options.now ?? new Date().toISOString();
  return {
    ok: true,
    value: {
      ...projectValidation.value,
      id: options.id ?? defaultId(),
      name: `${projectValidation.value.name}（导入）`,
      createdAt: now,
      updatedAt: now,
    },
  };
}
