import assert from "node:assert/strict";
import test from "node:test";
import { DeepSeekError, generateStoryboardWithDeepSeek } from "../lib/deepseek.ts";

const SCRIPT = "《接口测试》这是一段足够长的短剧脚本，用来验证 DeepSeek 请求会生成符合故事板契约的 JSON，并且测试全程使用 mock fetch，不会产生任何真实模型费用。";

const MODEL_STORYBOARD = {
  title: "接口测试",
  characters: [
    { id: "a", name: "角色甲", role: "主角", description: "测试角色", avatarLabel: "甲", avatarTone: "orange" },
  ],
  scenes: [
    { id: "s01", name: "测试场景", description: "夜晚，室内" },
  ],
  shots: [
    { id: 1, sceneId: "s01", framing: "远景", action: "动作一", emotion: "平静", visual: "画面一" },
    { id: 2, sceneId: "s01", framing: "全景", action: "动作二", emotion: "紧张", visual: "画面二" },
    { id: 3, sceneId: "s01", framing: "中景", action: "动作三", emotion: "惊讶", visual: "画面三" },
    { id: 4, sceneId: "s01", framing: "近景", action: "动作四", emotion: "担忧", visual: "画面四" },
    { id: 5, sceneId: "s01", framing: "特写", action: "动作五", emotion: "坚定", visual: "画面五" },
    { id: 6, sceneId: "s01", framing: "大特写", action: "动作六", emotion: "释然", visual: "画面六" },
  ],
};

function completionResponse(content: string) {
  return Response.json({ choices: [{ message: { content } }] });
}

test("DeepSeek request uses JSON Output and injects the trusted source script", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const result = await generateStoryboardWithDeepSeek(SCRIPT, {
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return completionResponse(JSON.stringify(MODEL_STORYBOARD));
    },
  });

  assert.deepEqual(result, { ...MODEL_STORYBOARD, sourceScript: SCRIPT });
  assert.equal(requestBody?.model, "deepseek-v4-pro");
  assert.deepEqual(requestBody?.response_format, { type: "json_object" });
  assert.deepEqual(requestBody?.thinking, { type: "disabled" });
  assert.equal(requestBody?.stream, false);
  assert.match(JSON.stringify(requestBody?.messages), /JSON/);
  assert.doesNotMatch(JSON.stringify(requestBody?.messages), /sourceScript/);
});

test("DeepSeek generator ignores a model-provided sourceScript", async () => {
  const result = await generateStoryboardWithDeepSeek(SCRIPT, {
    apiKey: "test-key",
    fetchImpl: async () => completionResponse(JSON.stringify({
      ...MODEL_STORYBOARD,
      sourceScript: "模型改写过的脚本",
    })),
  });

  assert.equal(result.sourceScript, SCRIPT);
});

test("DeepSeek generator reports a missing API key without calling the network", async () => {
  let called = false;

  await assert.rejects(
    generateStoryboardWithDeepSeek(SCRIPT, {
      apiKey: "",
      fetchImpl: async () => {
        called = true;
        return completionResponse(JSON.stringify(MODEL_STORYBOARD));
      },
    }),
    (error: unknown) => error instanceof DeepSeekError
      && error.status === 503
      && error.message === "尚未配置 DeepSeek API Key。",
  );

  assert.equal(called, false);
});

test("DeepSeek generator rejects invalid JSON and incomplete storyboard data", async () => {
  for (const content of ["not-json", JSON.stringify({ title: "不完整" })]) {
    await assert.rejects(
      generateStoryboardWithDeepSeek(SCRIPT, {
        apiKey: "test-key",
        fetchImpl: async () => completionResponse(content),
      }),
      (error: unknown) => error instanceof DeepSeekError && error.status === 502,
    );
  }
});

test("DeepSeek generator rejects broken references, duplicate ids, and invalid framing with specific safe errors", async () => {
  const unknownScene = structuredClone(MODEL_STORYBOARD);
  unknownScene.shots[0].sceneId = "missing-scene";

  const duplicateCharacter = structuredClone(MODEL_STORYBOARD);
  duplicateCharacter.characters.push({ ...duplicateCharacter.characters[0] });

  const duplicateScene = structuredClone(MODEL_STORYBOARD);
  duplicateScene.scenes.push({ ...duplicateScene.scenes[0] });

  const duplicateShot = structuredClone(MODEL_STORYBOARD);
  duplicateShot.shots[5].id = duplicateShot.shots[0].id;

  const invalidFraming = structuredClone(MODEL_STORYBOARD);
  invalidFraming.shots[2].framing = "航拍";

  const invalidCases = [
    [unknownScene, "模型返回的第 1 个镜头引用了不存在的场景，请重试。"],
    [duplicateCharacter, "模型返回的角色 ID 存在重复，请重试。"],
    [duplicateScene, "模型返回的场景 ID 存在重复，请重试。"],
    [duplicateShot, "模型返回的镜头 ID 存在重复，请重试。"],
    [invalidFraming, "模型返回的第 3 个镜头景别无效，请重试。"],
  ] as const;

  for (const [invalidStoryboard, expectedMessage] of invalidCases) {
    await assert.rejects(
      generateStoryboardWithDeepSeek(SCRIPT, {
        apiKey: "test-key",
        fetchImpl: async () => completionResponse(JSON.stringify(invalidStoryboard)),
      }),
      (error: unknown) => error instanceof DeepSeekError
        && error.status === 502
        && error.message === expectedMessage,
    );
  }
});
