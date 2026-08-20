import { DeepSeekError } from "./deepseek.ts";
import type { Storyboard } from "./storyboard.ts";

export const MIN_SCRIPT_LENGTH = 50;
export const MAX_SCRIPT_LENGTH = 6_000;
export const GENERATION_COOLDOWN_MS = 60_000;
export const GENERATION_LEASE_MS = 180_000;

export interface GenerationLimitRecord {
  requestId: string;
  lastStartedAt: number;
  leaseExpiresAt: number;
}

export interface GenerationLimitStore {
  tryAcquire(
    ownerId: string,
    requestId: string,
    startedAt: number,
    leaseExpiresAt: number,
    cooldownCutoff: number,
  ): Promise<boolean>;
  get(ownerId: string): Promise<GenerationLimitRecord | null>;
  release(ownerId: string, requestId: string, finishedAt: number): Promise<void>;
}

export type StoryboardGenerator = (script: string) => Promise<Storyboard>;

type GenerateOptions = {
  now?: () => number;
  requestId?: () => string;
  cooldownMs?: number;
  leaseMs?: number;
};

function errorResponse(error: string, status: number, retryAfterSeconds?: number) {
  const headers = retryAfterSeconds
    ? { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) }
    : undefined;
  return Response.json({ error }, { status, headers });
}

function defaultRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `generation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function generateStoryboardResponse(
  request: Request,
  ownerId: string,
  store: GenerationLimitStore,
  generate: StoryboardGenerator,
  options: GenerateOptions = {},
) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("请求内容必须是 JSON 格式。", 400);
  }

  if (!payload || typeof payload !== "object" || typeof (payload as { script?: unknown }).script !== "string") {
    return errorResponse("请提供 script 文本。", 400);
  }

  const script = (payload as { script: string }).script;
  const trimmedLength = script.trim().length;
  if (trimmedLength < MIN_SCRIPT_LENGTH) {
    return errorResponse(`脚本太短了，请至少输入 ${MIN_SCRIPT_LENGTH} 个字。`, 400);
  }
  if (script.length > MAX_SCRIPT_LENGTH) {
    return errorResponse(`脚本过长，请控制在 ${MAX_SCRIPT_LENGTH} 个字以内。`, 413);
  }

  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? GENERATION_COOLDOWN_MS;
  const leaseMs = options.leaseMs ?? GENERATION_LEASE_MS;
  const startedAt = now();
  const requestId = (options.requestId ?? defaultRequestId)();

  let acquired = false;
  try {
    acquired = await store.tryAcquire(
      ownerId,
      requestId,
      startedAt,
      startedAt + leaseMs,
      startedAt - cooldownMs,
    );
  } catch {
    return errorResponse("暂时无法确认生成状态，请稍后手动重试。", 503);
  }

  if (!acquired) {
    let current: GenerationLimitRecord | null = null;
    try {
      current = await store.get(ownerId);
    } catch {
      // A safe generic limit response is preferable to risking another model call.
    }
    if (current && current.leaseExpiresAt > startedAt) {
      return errorResponse(
        "已有故事板正在生成，请等待完成后再试。",
        429,
        (current.leaseExpiresAt - startedAt) / 1000,
      );
    }
    const retryAfter = current
      ? Math.max(1, (current.lastStartedAt + cooldownMs - startedAt) / 1000)
      : Math.ceil(cooldownMs / 1000);
    return errorResponse(`生成操作过于频繁，请等待 ${Math.ceil(retryAfter)} 秒后再试。`, 429, retryAfter);
  }

  try {
    return Response.json(await generate(script));
  } catch (error) {
    if (error instanceof DeepSeekError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("生成故事板时发生意外错误，请稍后手动重试。", 500);
  } finally {
    try {
      await store.release(ownerId, requestId, now());
    } catch {
      // The lease expires automatically; never turn a completed model call into a client retry.
    }
  }
}
