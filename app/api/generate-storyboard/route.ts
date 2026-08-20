import { getChatGPTUser } from "@/app/chatgpt-auth";
import { generateStoryboardWithDeepSeek } from "@/lib/deepseek";
import { generateStoryboardResponse, type GenerationLimitStore } from "@/lib/generation-service";

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}

function generationLimitStore(): GenerationLimitStore {
  const load = async () => (await import("@/db/generation-limits")).getGenerationLimitStore();
  return {
    async tryAcquire(...args) { return (await load()).tryAcquire(...args); },
    async get(...args) { return (await load()).get(...args); },
    async release(...args) { return (await load()).release(...args); },
  };
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return errorResponse("请先登录后再生成故事板。", 401);
  }

  return generateStoryboardResponse(
    request,
    user.userId,
    generationLimitStore(),
    generateStoryboardWithDeepSeek,
  );
}
