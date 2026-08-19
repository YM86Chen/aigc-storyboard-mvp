import { validateProjectDraft, type LocalProjectDraft } from "./projects.ts";
import type { Storyboard } from "./storyboard.ts";

export interface CloudProject extends LocalProjectDraft {
  version: number;
}

export interface ProjectWriteInput {
  name: string;
  script: string;
  storyboard: Storyboard | null;
}

export type ProjectUpdateResult =
  | { status: "updated"; project: CloudProject }
  | { status: "not_found" }
  | { status: "conflict" };

export interface ProjectStore {
  list(ownerId: string): Promise<CloudProject[]>;
  create(ownerId: string, project: CloudProject): Promise<CloudProject>;
  get(ownerId: string, id: string): Promise<CloudProject | null>;
  update(
    ownerId: string,
    id: string,
    expectedVersion: number,
    input: ProjectWriteInput,
    updatedAt: string,
  ): Promise<ProjectUpdateResult>;
  delete(ownerId: string, id: string): Promise<boolean>;
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const MAX_NAME_LENGTH = 120;
const MAX_SCRIPT_LENGTH = 100_000;
const MAX_STORYBOARD_JSON_LENGTH = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateProjectWriteInput(value: unknown): ValidationResult<ProjectWriteInput> {
  if (!isRecord(value) || "ownerId" in value) {
    return { ok: false, error: "项目数据格式不正确。" };
  }
  if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > MAX_NAME_LENGTH) {
    return { ok: false, error: `项目名称不能为空且不能超过 ${MAX_NAME_LENGTH} 个字。` };
  }
  if (typeof value.script !== "string" || value.script.length > MAX_SCRIPT_LENGTH) {
    return { ok: false, error: "项目脚本格式不正确或内容过长。" };
  }
  if (value.storyboard !== null && JSON.stringify(value.storyboard).length > MAX_STORYBOARD_JSON_LENGTH) {
    return { ok: false, error: "故事板数据过大，无法保存。" };
  }

  const now = "2000-01-01T00:00:00.000Z";
  const validation = validateProjectDraft({
    id: "validation-project",
    name: value.name.trim(),
    script: value.script,
    storyboard: value.storyboard,
    createdAt: now,
    updatedAt: now,
  });
  if (!validation.ok) return validation;

  return {
    ok: true,
    value: {
      name: validation.value.name,
      script: validation.value.script,
      storyboard: validation.value.storyboard,
    },
  };
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

function validProjectId(id: string) {
  return id.length > 0 && id.length <= 128;
}

async function readJson(request: Request): Promise<ValidationResult<unknown>> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, error: "请求内容必须是 JSON 格式。" };
  }
}

export async function listProjectsResponse(ownerId: string, store: ProjectStore) {
  return Response.json({ projects: await store.list(ownerId) });
}

export async function createProjectResponse(
  request: Request,
  ownerId: string,
  store: ProjectStore,
  options: { id?: string; now?: string } = {},
) {
  const body = await readJson(request);
  if (!body.ok) return jsonError(body.error, 400);
  const validation = validateProjectWriteInput(body.value);
  if (!validation.ok) return jsonError(validation.error, 400);

  const now = options.now ?? new Date().toISOString();
  const project: CloudProject = {
    id: options.id ?? crypto.randomUUID(),
    ...validation.value,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  return Response.json({ project: await store.create(ownerId, project) }, { status: 201 });
}

export async function getProjectResponse(ownerId: string, id: string, store: ProjectStore) {
  if (!validProjectId(id)) return jsonError("项目不存在。", 404);
  const project = await store.get(ownerId, id);
  return project
    ? Response.json({ project })
    : jsonError("项目不存在。", 404);
}

export async function updateProjectResponse(
  request: Request,
  ownerId: string,
  id: string,
  store: ProjectStore,
  options: { now?: string } = {},
) {
  if (!validProjectId(id)) return jsonError("项目不存在。", 404);
  const body = await readJson(request);
  if (!body.ok) return jsonError(body.error, 400);
  if (!isRecord(body.value) || !Number.isInteger(body.value.version) || Number(body.value.version) < 1) {
    return jsonError("项目版本号无效。", 400);
  }
  const validation = validateProjectWriteInput(body.value);
  if (!validation.ok) return jsonError(validation.error, 400);

  const result = await store.update(
    ownerId,
    id,
    Number(body.value.version),
    validation.value,
    options.now ?? new Date().toISOString(),
  );
  if (result.status === "not_found") return jsonError("项目不存在。", 404);
  if (result.status === "conflict") {
    return jsonError("项目已在其他设备更新，请先加载云端最新版本。", 409);
  }
  return Response.json({ project: result.project });
}

export async function deleteProjectResponse(ownerId: string, id: string, store: ProjectStore) {
  if (!validProjectId(id) || !await store.delete(ownerId, id)) {
    return jsonError("项目不存在。", 404);
  }
  return new Response(null, { status: 204 });
}

export function unauthorizedResponse() {
  return jsonError("请先登录后再管理云端项目。", 401);
}

export function internalErrorResponse() {
  return jsonError("云端项目服务暂时不可用，请稍后重试。", 500);
}
