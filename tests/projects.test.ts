import assert from "node:assert/strict";
import test from "node:test";
import {
  PROJECT_BACKUP_FORMAT,
  createProjectBackup,
  createProjectDraft,
  parseProjectBackup,
  validateProjectLibrary,
} from "../lib/projects.ts";
import {
  createMockStoryboard,
  moveStoryboardShot,
  rebuildVideoPrompts,
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
  const storyboard = createMockStoryboard(SCRIPT);
  storyboard.characters[0].description = "银色短发，红色风衣";
  storyboard.scenes[0].description = "蓝紫色灯光，窗外暴雨";
  storyboard.shots[0].action = "角色缓慢回头";
  storyboard.shots[0].videoPrompt = "保留的手动提示词";

  assert.equal(storyboard.shots[0].videoPrompt, "保留的手动提示词");
  const rebuilt = rebuildVideoPrompts(storyboard);
  assert.match(rebuilt.shots[0].videoPrompt, /银色短发，红色风衣/);
  assert.match(rebuilt.shots[0].videoPrompt, /蓝紫色灯光，窗外暴雨/);
  assert.match(rebuilt.shots[0].videoPrompt, /角色缓慢回头/);
  assert.equal(storyboard.shots[0].videoPrompt, "保留的手动提示词");
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
