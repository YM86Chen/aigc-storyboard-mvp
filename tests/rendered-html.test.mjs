import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
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

test("source contains the complete local MVP interactions", async () => {
  const [page, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const SAMPLE_SCRIPT/);
  assert.match(page, /if \(script\.trim\(\)\.length < 50\)/);
  assert.match(page, /脚本太短了，请至少输入 50 个字。/);
  assert.equal((page.match(/\{ id: [1-6], framing:/g) ?? []).length, 6);
  assert.match(page, /updateShot/);
  assert.match(page, /field: keyof Omit<Shot/);
  assert.match(page, /new Blob\(\[markdown\]/);
  assert.match(page, /link\.download = `\$\{title\}-分镜资产包\.md`/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/_sites-preview/preview.css", import.meta.url)));
  await assert.doesNotReject(access(projectRoot));
});
