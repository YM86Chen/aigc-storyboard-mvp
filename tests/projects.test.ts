import assert from "node:assert/strict";
import test from "node:test";
import {
  PROJECT_BACKUP_FORMAT,
  PROJECT_LIBRARY_STORAGE_KEY,
  createProjectBackup,
  createProjectDraft,
  loadProjectLibrary,
  parseProjectBackup,
  saveProjectLibrary,
  validateProjectLibrary,
} from "../lib/projects.ts";
import {
  createAllVideoPromptsText,
  createMockStoryboard,
  markVideoPromptsStale,
  moveStoryboardShot,
  rebuildVideoPrompt,
  rebuildVideoPrompts,
  setManualVideoPrompt,
  validateStoryboard,
} from "../lib/storyboard.ts";

const SCRIPT = "《本地项目测试》这是一段足够长的短剧脚本，用于验证项目草稿的保存、恢复、JSON 导入导出、镜头排序和提示词重建能力。";

function completeProject() {
  return {
    ...createProjectDraft("测试项目", { id: "project-1", now: "2026-08-19T00:00:00.000Z" }),
    script: SCRIPT,
    storyboard: createMockStoryboard(SCRIPT),
  };
}

test("browser-local project library saves and restores validated drafts", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
  assert.deepEqual(loadProjectLibrary(storage), { ok: true, value: null });

  const project = completeProject();
  const library = { version: 1 as const, activeProjectId: project.id, projects: [project] };
  assert.equal(saveProjectLibrary(storage, library).ok, true);
  assert.ok(values.get(PROJECT_LIBRARY_STORAGE_KEY)?.includes("测试项目"));

  const restored = loadProjectLibrary(storage);
  assert.equal(restored.ok, true);
  if (!restored.ok || !restored.value) return;
  assert.equal(restored.value.activeProjectId, project.id);
  assert.equal(restored.value.projects[0].storyboard?.shots.length, 6);
});

test("browser-local project library reports corrupted or unwritable storage", () => {
  const corrupted = {
    getItem() { return "not-json"; },
    setItem() {},
  };
  assert.deepEqual(loadProjectLibrary(corrupted), {
    ok: false,
    error: "本地草稿数据已损坏，无法恢复。",
  });

  const project = completeProject();
  const unwritable = {
    getItem() { return null; },
    setItem() { throw new Error("quota"); },
  };
  const result = saveProjectLibrary(unwritable, {
    version: 1,
    activeProjectId: project.id,
    projects: [project],
  });
  assert.deepEqual(result, {
    ok: false,
    error: "浏览器本地存储写入失败，请导出 JSON 备份。",
  });
});

test("project JSON backup round-trips all current editable assets", () => {
  const project = completeProject();
  project.storyboard!.title = "用户编辑后的标题";
  project.storyboard!.characters[0].description = "用户编辑后的角色设定";
  project.storyboard!.shots[0].videoPrompt = "用户编辑后的最终提示词";

  const json = createProjectBackup(project, "2026-08-19T01:00:00.000Z");
  const raw = JSON.parse(json);
  assert.equal(raw.format, PROJECT_BACKUP_FORMAT);
  assert.equal(raw.project.storyboard.shots[0].videoPrompt, "用户编辑后的最终提示词");

  const imported = parseProjectBackup(json, { id: "imported-1", now: "2026-08-19T02:00:00.000Z" });
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  assert.equal(imported.value.id, "imported-1");
  assert.equal(imported.value.name, "测试项目（导入）");
  assert.equal(imported.value.storyboard?.title, "用户编辑后的标题");
  assert.equal(imported.value.storyboard?.characters[0].description, "用户编辑后的角色设定");
});

test("project import rejects malformed JSON and invalid storyboard relationships", () => {
  assert.deepEqual(parseProjectBackup("not-json"), {
    ok: false,
    error: "JSON 文件无法解析，请确认它是帧语导出的项目备份。",
  });

  const project = completeProject();
  project.storyboard!.shots[0].sceneId = "missing-scene";
  const invalidBackup = JSON.stringify({
    format: PROJECT_BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-08-19T01:00:00.000Z",
    project,
  });
  const validation = parseProjectBackup(invalidBackup);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.match(validation.error, /不存在的场景/);
});

test("saved storyboard validation requires six valid prompts and matching source script", () => {
  const storyboard = createMockStoryboard(SCRIPT);
  assert.equal(validateStoryboard(storyboard).ok, true);

  const missingPrompt = structuredClone(storyboard);
  missingPrompt.shots[2].videoPrompt = "";
  const promptValidation = validateStoryboard(missingPrompt);
  assert.deepEqual(promptValidation, { ok: false, error: "第 3 个镜头缺少图生视频提示词。" });

  const project = completeProject();
  project.script = "与故事板不一致的脚本";
  const libraryValidation = validateProjectLibrary({
    version: 1,
    activeProjectId: project.id,
    projects: [project],
  });
  assert.equal(libraryValidation.ok, false);
  if (!libraryValidation.ok) assert.match(libraryValidation.error, /原始脚本不一致/);
});

test("rebuilding prompts uses current assets only when explicitly requested", () => {
  let storyboard = createMockStoryboard(SCRIPT);
  storyboard.characters[0].description = "银色短发，红色风衣";
  storyboard.scenes[0].description = "蓝紫色灯光，窗外暴雨";
  storyboard.shots[0].action = "角色缓慢回头";
  storyboard = markVideoPromptsStale(storyboard);
  storyboard = setManualVideoPrompt(storyboard, storyboard.shots[0].id, "保留的手动提示词");
  storyboard = markVideoPromptsStale(storyboard, (shot) => shot.id === storyboard.shots[0].id);

  assert.equal(storyboard.shots[0].videoPrompt, "保留的手动提示词");
  const rebuilt = rebuildVideoPrompts(storyboard);
  assert.equal(rebuilt.shots[0].videoPrompt, "保留的手动提示词");
  assert.equal(rebuilt.shots[0].videoPromptSource, "manual");
  assert.equal(rebuilt.shots[0].videoPromptNeedsRebuild, true);
  assert.ok(rebuilt.shots.slice(1).every((shot) => shot.videoPromptNeedsRebuild === false));
  assert.equal(storyboard.shots[0].videoPrompt, "保留的手动提示词");

  const explicitlyRebuilt = rebuildVideoPrompt(rebuilt, rebuilt.shots[0].id);
  assert.match(explicitlyRebuilt.shots[0].videoPrompt, /银色短发，红色风衣/);
  assert.match(explicitlyRebuilt.shots[0].videoPrompt, /蓝紫色灯光，窗外暴雨/);
  assert.match(explicitlyRebuilt.shots[0].videoPrompt, /角色缓慢回头/);
  assert.equal(explicitlyRebuilt.shots[0].videoPromptSource, "generated");
  assert.equal(explicitlyRebuilt.shots[0].videoPromptNeedsRebuild, false);
});

test("prompt state survives validation and legacy projects receive safe defaults", () => {
  const storyboard = markVideoPromptsStale(createMockStoryboard(SCRIPT), (shot) => shot.id === 2);
  const validated = validateStoryboard(storyboard);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(validated.value.shots[1].videoPromptNeedsRebuild, true);

  const legacy = structuredClone(storyboard) as unknown as { shots: Array<Record<string, unknown>> };
  for (const shot of legacy.shots) {
    delete shot.videoPromptSource;
    delete shot.videoPromptNeedsRebuild;
  }
  const legacyValidation = validateStoryboard(legacy);
  assert.equal(legacyValidation.ok, true);
  if (!legacyValidation.ok) return;
  assert.ok(legacyValidation.value.shots.every((shot) => shot.videoPromptSource === "generated"));
  assert.ok(legacyValidation.value.shots.every((shot) => shot.videoPromptNeedsRebuild === false));
});

test("whole prompt delivery includes every shot with its scene and character context", () => {
  const storyboard = createMockStoryboard(SCRIPT);
  const text = createAllVideoPromptsText(storyboard);
  assert.equal((text.match(/镜头 0[1-6]｜/g) ?? []).length, 6);
  assert.match(text, /末班地铁车厢/);
  assert.match(text, /关联角色：林夏：/);
  assert.match(text, /制服女孩：/);
});

test("shot reordering preserves six shots and each edited prompt", () => {
  const storyboard = createMockStoryboard(SCRIPT);
  const firstPrompt = storyboard.shots[0].videoPrompt;
  const secondPrompt = storyboard.shots[1].videoPrompt;

  const reordered = moveStoryboardShot(storyboard, 0, 1);
  assert.equal(reordered.shots.length, 6);
  assert.deepEqual(reordered.shots.map((shot) => shot.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(reordered.shots[0].videoPrompt, secondPrompt);
  assert.equal(reordered.shots[1].videoPrompt, firstPrompt);
  assert.equal(storyboard.shots[0].videoPrompt, firstPrompt);
});
