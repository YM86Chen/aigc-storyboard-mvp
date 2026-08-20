import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SCRIPT_LENGTH,
  generateStoryboardResponse,
  type GenerationLimitRecord,
  type GenerationLimitStore,
} from "../lib/generation-service.ts";
import { createMockStoryboard } from "../lib/storyboard.ts";
import { createSingleFlight } from "../lib/single-flight.ts";

const SCRIPT = "《生成保险测试》这是一段足够长且不含敏感信息的短剧测试脚本，用于确认并发请求、频率限制和输入边界不会意外重复调用模型服务。";

class MemoryGenerationLimitStore implements GenerationLimitStore {
  rows = new Map<string, GenerationLimitRecord>();

  async tryAcquire(ownerId: string, requestId: string, startedAt: number, leaseExpiresAt: number, cooldownCutoff: number) {
    const current = this.rows.get(ownerId);
    if (current && (current.leaseExpiresAt > startedAt || current.lastStartedAt > cooldownCutoff)) return false;
    this.rows.set(ownerId, { requestId, lastStartedAt: startedAt, leaseExpiresAt });
    return true;
  }

  async get(ownerId: string) {
    return this.rows.get(ownerId) ?? null;
  }

  async release(ownerId: string, requestId: string, finishedAt: number) {
    const current = this.rows.get(ownerId);
    if (current?.requestId === requestId) current.leaseExpiresAt = finishedAt;
  }
}

function request(script = SCRIPT) {
  return new Request("https://example.test/api/generate-storyboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ script }),
  });
}

test("client single-flight guard rejects a duplicate click until the active request finishes", () => {
  const guard = createSingleFlight();
  assert.equal(guard.tryStart(), true);
  assert.equal(guard.isActive(), true);
  assert.equal(guard.tryStart(), false);
  guard.finish();
  assert.equal(guard.isActive(), false);
  assert.equal(guard.tryStart(), true);
});

test("overlong scripts are rejected before acquiring a limit or calling the model", async () => {
  const store = new MemoryGenerationLimitStore();
  let calls = 0;
  const response = await generateStoryboardResponse(
    request("字".repeat(MAX_SCRIPT_LENGTH + 1)),
    "user-a",
    store,
    async () => { calls += 1; return createMockStoryboard(SCRIPT); },
  );
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: `脚本过长，请控制在 ${MAX_SCRIPT_LENGTH} 个字以内。` });
  assert.equal(calls, 0);
  assert.equal(store.rows.size, 0);
});

test("concurrent duplicate requests make exactly one model call", async () => {
  const store = new MemoryGenerationLimitStore();
  let calls = 0;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const generate = async () => {
    calls += 1;
    await pending;
    return createMockStoryboard(SCRIPT);
  };
  const options = { now: () => 1_000_000, requestId: () => `request-${calls + 1}` };

  const first = generateStoryboardResponse(request(), "user-a", store, generate, options);
  while (calls === 0) await Promise.resolve();
  const duplicate = await generateStoryboardResponse(request(), "user-a", store, generate, options);
  assert.equal(duplicate.status, 429);
  assert.deepEqual(await duplicate.json(), { error: "已有故事板正在生成，请等待完成后再试。" });
  assert.equal(calls, 1);

  finish();
  assert.equal((await first).status, 200);
  assert.equal(calls, 1);
});

test("cooldown blocks repeated generation until the conservative window expires", async () => {
  const store = new MemoryGenerationLimitStore();
  let now = 2_000_000;
  let calls = 0;
  const generate = async (script: string) => {
    calls += 1;
    return createMockStoryboard(script);
  };
  const options = { now: () => now, requestId: () => `request-${calls + 1}` };

  assert.equal((await generateStoryboardResponse(request(), "user-a", store, generate, options)).status, 200);
  now += 30_000;
  const limited = await generateStoryboardResponse(request(), "user-a", store, generate, options);
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /请等待 30 秒后再试/);
  assert.equal(calls, 1);

  now += 31_000;
  assert.equal((await generateStoryboardResponse(request(), "user-a", store, generate, options)).status, 200);
  assert.equal(calls, 2);
});
