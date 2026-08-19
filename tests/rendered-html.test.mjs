import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

const VALID_SCRIPT = `《接口测试》

这是一段足够长的测试短剧脚本，用来验证页面提交 JSON 后，服务端能够接收脚本文本、生成符合故事板契约的结果，并将它安全地返回给前端页面。`;

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

test("POST /api/generate-storyboard returns a Storyboard and validates input", async () => {
  const response = await request("/api/generate-storyboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ script: VALID_SCRIPT }),
  });

  assert.equal(response.status, 200);
  const storyboard = await response.json();
  assert.equal(storyboard.title, "接口测试");
  assert.equal(storyboard.sourceScript, VALID_SCRIPT);
  assert.equal(storyboard.characters.length, 2);
  assert.equal(storyboard.scenes.length, 2);
  assert.equal(storyboard.shots.length, 6);

  const invalidResponse = await request("/api/generate-storyboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ script: "太短" }),
  });

  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), { error: "脚本太短了，请至少输入 50 个字。" });
});

test("source contains the complete local MVP interactions and shared storyboard contract", async () => {
  const [page, packageJson, storyboard] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/storyboard.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /from "@\/lib\/storyboard"/);
  assert.doesNotMatch(page, /const INITIAL_SHOTS|type Shot =/);
  assert.match(page, /if \(script\.trim\(\)\.length < 50\)/);
  assert.match(page, /脚本太短了，请至少输入 50 个字。/);
  assert.doesNotMatch(page, /createMockStoryboard/);
  assert.match(page, /fetch\("\/api\/generate-storyboard"/);
  assert.match(page, /isGenerating/);
  assert.match(page, /生成中…/);
  assert.match(page, /isError/);
  assert.match(page, /updateShot/);
  assert.match(page, /storyboard\.characters\.map/);
  assert.match(page, /storyboard\.scenes\.map/);
  assert.match(page, /storyboard\.shots\.map/);
  assert.match(page, /new Blob\(\[markdown\]/);
  assert.match(page, /link\.download = `\$\{storyboard\.title\}-分镜资产包\.md`/);

  for (const typeName of ["Storyboard", "Character", "Scene", "Shot"]) {
    assert.match(storyboard, new RegExp(`export interface ${typeName}`));
  }
  assert.match(storyboard, /export function createMockStoryboard/);
  assert.match(storyboard, /const FRAMING_OPTIONS/);
  assert.equal((storyboard.match(/sceneId: "s0[12]"/g) ?? []).length, 6);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/_sites-preview/preview.css", import.meta.url)));
  await assert.doesNotReject(access(projectRoot));
});
