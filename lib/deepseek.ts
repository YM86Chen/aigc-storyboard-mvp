import { createStoryboardWithVideoPrompts, validateGeneratedStoryboard, type Storyboard } from "./storyboard.ts";

const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";

const STORYBOARD_SYSTEM_PROMPT = `你是短剧故事板生成器。请把用户提供的短剧脚本拆解为可直接用于图生视频的故事板。

你必须且只能返回一个有效的 JSON object；不要使用 Markdown 代码块，不要解释。

严格使用以下字段：
- title: 非空字符串，短剧标题
- characters: 至少 1 个角色，每项必须有 id、name、role、description、avatarLabel、avatarTone；avatarTone 只能是 "orange" 或 "dark"
- scenes: 至少 1 个场景，每项必须有 id、name、description
- shots: 必须刚好 6 个镜头，每项必须有 id、sceneId、framing、action、emotion、visual；framing 只能是 "远景"、"全景"、"中景"、"近景"、"特写"、"大特写"

JSON 示例：
{
  "title": "最后一班地铁",
  "characters": [{"id":"lin-xia","name":"林夏","role":"主角","description":"短发，浅灰风衣","avatarLabel":"林","avatarTone":"orange"}],
  "scenes": [{"id":"s01","name":"末班地铁车厢","description":"深夜，冷白荧光灯，都市悬疑"}],
  "shots": [{"id":1,"sceneId":"s01","framing":"中景","action":"林夏独自坐在车厢","emotion":"警觉","visual":"深夜地铁，冷白光，电影感"}]
}

现在请根据用户脚本返回完整 JSON。`;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class DeepSeekError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DeepSeekError";
    this.status = status;
  }
}

export type DeepSeekOptions = {
  apiKey?: string;
  fetchImpl?: FetchLike;
};

function contentFromCompletion(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const message = choices[0] && typeof choices[0] === "object"
    ? (choices[0] as { message?: unknown }).message
    : null;
  const content = message && typeof message === "object"
    ? (message as { content?: unknown }).content
    : null;

  return typeof content === "string" && content.trim() ? content : null;
}

export async function generateStoryboardWithDeepSeek(
  script: string,
  options: DeepSeekOptions = {},
): Promise<Storyboard> {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!apiKey?.trim()) {
    throw new DeepSeekError("尚未配置 DeepSeek API Key。", 503);
  }

  let response: Response;
  try {
    response = await fetchImpl(DEEPSEEK_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-v4-pro",
        messages: [
          { role: "system", content: STORYBOARD_SYSTEM_PROMPT },
          { role: "user", content: `请生成故事板 JSON。\n\n短剧脚本：\n${script}` },
        ],
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        max_tokens: 4000,
        stream: false,
      }),
    });
  } catch {
    throw new DeepSeekError("无法连接 DeepSeek 服务，请检查网络后重试。", 502);
  }

  let completion: unknown;
  try {
    completion = await response.json();
  } catch {
    throw new DeepSeekError("DeepSeek 返回了无法读取的响应，请稍后重试。", 502);
  }

  if (!response.ok) {
    throw new DeepSeekError("DeepSeek 服务请求失败，请稍后重试。", 502);
  }

  const content = contentFromCompletion(completion);
  if (!content) {
    throw new DeepSeekError("模型未返回可用的故事板内容，请重试。", 502);
  }

  let storyboard: unknown;
  try {
    storyboard = JSON.parse(content);
  } catch {
    throw new DeepSeekError("模型返回的内容不是有效 JSON，请重试。", 502);
  }

  const validation = validateGeneratedStoryboard(storyboard);
  if (!validation.ok) {
    throw new DeepSeekError(validation.error, 502);
  }

  return createStoryboardWithVideoPrompts(validation.value, script);
}
