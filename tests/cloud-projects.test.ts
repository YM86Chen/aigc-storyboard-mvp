import assert from "node:assert/strict";
import test from "node:test";
import {
  createProjectResponse,
  deleteProjectResponse,
  getProjectResponse,
  listProjectsResponse,
  unauthorizedResponse,
  updateProjectResponse,
  type CloudProject,
  type ProjectStore,
  type ProjectUpdateResult,
} from "../lib/cloud-projects.ts";
import { createMockStoryboard } from "../lib/storyboard.ts";

const SCRIPT = "《云端测试》这是一段足够完整的脚本，用来确认故事板项目可以安全保存、恢复，并且不同登录用户之间不能互相读取、修改或删除数据。";

class MemoryProjectStore implements ProjectStore {
  rows = new Map<string, { ownerId: string; project: CloudProject }>();

  async list(ownerId: string) {
    return [...this.rows.values()]
      .filter((row) => row.ownerId === ownerId)
      .map((row) => structuredClone(row.project));
  }

  async create(ownerId: string, project: CloudProject) {
    this.rows.set(project.id, { ownerId, project: structuredClone(project) });
    return structuredClone(project);
  }

  async get(ownerId: string, id: string) {
    const row = this.rows.get(id);
    return row?.ownerId === ownerId ? structuredClone(row.project) : null;
  }

  async update(
    ownerId: string,
    id: string,
    expectedVersion: number,
    input: Pick<CloudProject, "name" | "script" | "storyboard">,
    updatedAt: string,
  ): Promise<ProjectUpdateResult> {
    const row = this.rows.get(id);
    if (!row || row.ownerId !== ownerId) return { status: "not_found" };
    if (row.project.version !== expectedVersion) return { status: "conflict" };
    row.project = {
      ...row.project,
      ...structuredClone(input),
      version: expectedVersion + 1,
      updatedAt,
    };
    return { status: "updated", project: structuredClone(row.project) };
  }

  async delete(ownerId: string, id: string) {
    const row = this.rows.get(id);
    if (!row || row.ownerId !== ownerId) return false;
    return this.rows.delete(id);
  }
}

function jsonRequest(method: string, body: unknown) {
  return new Request("https://example.test/api/projects", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function projectBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "云端故事板",
    script: SCRIPT,
    storyboard: createMockStoryboard(SCRIPT),
    ...overrides,
  };
}

test("project API helpers reject unauthenticated access with a safe Chinese error", async () => {
  const response = unauthorizedResponse();
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "请先登录后再管理云端项目。" });
});

test("cloud projects save and recover the complete validated storyboard", async () => {
  const store = new MemoryProjectStore();
  const createdResponse = await createProjectResponse(
    jsonRequest("POST", projectBody()),
    "user-a",
    store,
    { id: "project-a", now: "2026-08-19T10:00:00.000Z" },
  );
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).project as CloudProject;
  assert.equal(created.version, 1);
  assert.equal(created.storyboard?.shots.length, 6);
  assert.ok(created.storyboard?.shots.every((shot) => shot.videoPrompt.length > 0));

  const restoredResponse = await listProjectsResponse("user-a", store);
  const restored = (await restoredResponse.json()).projects as CloudProject[];
  assert.equal(restored.length, 1);
  assert.deepEqual(restored[0], created);
});

test("every read, update, and delete is scoped to the authenticated owner", async () => {
  const store = new MemoryProjectStore();
  await createProjectResponse(
    jsonRequest("POST", projectBody()),
    "user-a",
    store,
    { id: "private-project", now: "2026-08-19T10:00:00.000Z" },
  );

  assert.equal((await getProjectResponse("user-b", "private-project", store)).status, 404);
  assert.equal((await listProjectsResponse("user-b", store).then((response) => response.json())).projects.length, 0);
  assert.equal((await updateProjectResponse(
    jsonRequest("PUT", { ...projectBody(), version: 1 }),
    "user-b",
    "private-project",
    store,
  )).status, 404);
  assert.equal((await deleteProjectResponse("user-b", "private-project", store)).status, 404);
  assert.equal((await getProjectResponse("user-a", "private-project", store)).status, 200);
});

test("invalid storyboard data and attempted owner injection are rejected before storage", async () => {
  const store = new MemoryProjectStore();
  const invalidStoryboard = createMockStoryboard(SCRIPT);
  invalidStoryboard.shots.pop();

  const invalidResponse = await createProjectResponse(
    jsonRequest("POST", projectBody({ storyboard: invalidStoryboard })),
    "user-a",
    store,
  );
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), { error: "模型必须返回恰好 6 个镜头，请重试。" });

  const injectionResponse = await createProjectResponse(
    jsonRequest("POST", projectBody({ ownerId: "user-b" })),
    "user-a",
    store,
  );
  assert.equal(injectionResponse.status, 400);
  assert.deepEqual(await injectionResponse.json(), { error: "项目数据格式不正确。" });
  assert.equal(store.rows.size, 0);
});

test("optimistic version checks reject stale writes without overwriting newer data", async () => {
  const store = new MemoryProjectStore();
  await createProjectResponse(
    jsonRequest("POST", projectBody()),
    "user-a",
    store,
    { id: "versioned-project", now: "2026-08-19T10:00:00.000Z" },
  );

  const savedResponse = await updateProjectResponse(
    jsonRequest("PUT", { ...projectBody({ name: "设备 A 的修改" }), version: 1 }),
    "user-a",
    "versioned-project",
    store,
    { now: "2026-08-19T10:05:00.000Z" },
  );
  assert.equal(savedResponse.status, 200);
  assert.equal(((await savedResponse.json()).project as CloudProject).version, 2);

  const staleResponse = await updateProjectResponse(
    jsonRequest("PUT", { ...projectBody({ name: "设备 B 的旧修改" }), version: 1 }),
    "user-a",
    "versioned-project",
    store,
  );
  assert.equal(staleResponse.status, 409);
  assert.deepEqual(await staleResponse.json(), { error: "项目已在其他设备更新，请先加载云端最新版本。" });

  const current = await store.get("user-a", "versioned-project");
  assert.equal(current?.name, "设备 A 的修改");
  assert.equal(current?.version, 2);
});
