import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function request(path, init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function render() {
  return request("/", { headers: { accept: "text/html" } });
}

test("server-renders the storyboard input experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>帧语 · AI 短剧故事板<\/title>/);
  assert.match(html, /把脚本，变成/);
  assert.match(html, /使用示例脚本/);
  assert.match(html, /生成分镜/);
  assert.match(html, /<textarea/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/);
});

test("POST /api/generate-storyboard rejects malformed and short requests before any model call", async () => {
  const malformedResponse = await request("/api/generate-storyboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });

  assert.equal(malformedResponse.status, 400);
  assert.deepEqual(await malformedResponse.json(), { error: "请求内容必须是 JSON 格式。" });

  const invalidResponse = await request("/api/generate-storyboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ script: "太短" }),
  });

  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), { error: "脚本太短了，请至少输入 50 个字。" });
});

test("source contains the complete request chain, local workspace, and shared storyboard contract", async () => {
  const [page, packageJson, storyboard, projects, route, deepseek, envExample, gitignore] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/storyboard.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/projects.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/generate-storyboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/deepseek.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  ]);

  assert.match(page, /from "@\/lib\/storyboard"/);
  assert.doesNotMatch(page, /const INITIAL_SHOTS|type Shot =/);
  assert.match(page, /script\.trim\(\)\.length < 50/);
  assert.match(page, /脚本太短了，请至少输入 50 个字。/);
  assert.doesNotMatch(page, /createMockStoryboard/);
  assert.match(page, /fetch\("\/api\/generate-storyboard"/);
  assert.match(page, /isGenerating/);
  assert.match(page, /生成中…/);
  assert.match(page, /isError/);
  assert.match(page, /脚本会发送至你配置的 AI 服务，仅用于本次生成。/);
  assert.match(page, /02 · AI 生成结果/);
  assert.match(page, /updateShot/);
  assert.match(page, /图生视频提示词/);
  assert.match(page, /updateShot\(shot\.id, "videoPrompt"/);
  assert.match(page, /updateShot\(shot\.id, "sceneId"/);
  assert.match(page, /updateShot\(shot\.id, "visual"/);
  assert.match(page, /navigator\.clipboard\.writeText/);
  assert.match(page, /moveStoryboardShot/);
  assert.match(page, /按当前资产重建提示词/);
  assert.match(page, /window\.confirm\("按当前角色/);
  assert.match(page, /window\.confirm\(`确定删除/);
  assert.match(page, /window\.localStorage\.setItem/);
  assert.match(page, /window\.localStorage\.getItem/);
  assert.match(page, /新建/);
  assert.match(page, /重命名/);
  assert.match(page, /导入 JSON/);
  assert.match(page, /导出 JSON/);
  assert.match(page, /本地草稿只保存在当前浏览器/);
  assert.match(page, /createStoryboardMarkdown\(storyboard/);
  assert.match(page, /storyboard\.characters\.map/);
  assert.match(page, /storyboard\.scenes\.map/);
  assert.match(page, /storyboard\.shots\.map/);
  assert.match(page, /new Blob\(\[text\]/);
  assert.match(page, /分镜资产包\.md/);

  for (const typeName of ["Storyboard", "Character", "Scene", "Shot"]) {
    assert.match(storyboard, new RegExp(`export interface ${typeName}`));
  }
  assert.match(storyboard, /export function createMockStoryboard/);
  assert.match(storyboard, /export function validateGeneratedStoryboard/);
  assert.match(storyboard, /videoPrompt: string/);
  assert.match(storyboard, /export function createStoryboardWithVideoPrompts/);
  assert.match(storyboard, /export function createStoryboardMarkdown/);
  assert.match(storyboard, /export function validateStoryboard/);
  assert.match(storyboard, /export function rebuildVideoPrompts/);
  assert.match(storyboard, /export function moveStoryboardShot/);
  assert.match(storyboard, /const FRAMING_OPTIONS/);
  assert.equal((storyboard.match(/sceneId: "s0[12]"/g) ?? []).length, 6);
  assert.match(route, /generateStoryboardWithDeepSeek/);
  assert.doesNotMatch(route, /createMockStoryboard/);
  assert.match(deepseek, /https:\/\/api\.deepseek\.com\/chat\/completions/);
  assert.match(deepseek, /model: "deepseek-v4-pro"/);
  assert.match(deepseek, /response_format: \{ type: "json_object" \}/);
  assert.match(deepseek, /thinking: \{ type: "disabled" \}/);
  assert.match(deepseek, /createStoryboardWithVideoPrompts/);
  assert.match(deepseek, /尚未配置 DeepSeek API Key。/);
  assert.match(projects, /PROJECT_LIBRARY_STORAGE_KEY/);
  assert.match(projects, /export function validateProjectLibrary/);
  assert.match(projects, /export function createProjectBackup/);
  assert.match(projects, /export function parseProjectBackup/);
  assert.equal(envExample, "DEEPSEEK_API_KEY=\n");
  assert.match(gitignore, /\.env\*/);
  assert.match(gitignore, /!\.env\.example/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/_sites-preview/preview.css", import.meta.url)));
  await assert.doesNotReject(access(projectRoot));
});
