import { createMockStoryboard } from "@/lib/storyboard";

const MIN_SCRIPT_LENGTH = 50;

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
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

  if (script.trim().length < MIN_SCRIPT_LENGTH) {
    return errorResponse("脚本太短了，请至少输入 50 个字。", 400);
  }

  return Response.json(createMockStoryboard(script));
}
