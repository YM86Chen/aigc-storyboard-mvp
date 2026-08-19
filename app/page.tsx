"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createProjectBackup,
  createProjectDraft,
  loadProjectLibrary,
  parseProjectBackup,
  saveProjectLibrary,
  type LocalProjectDraft,
  type ProjectLibrary,
} from "@/lib/projects";
import {
  FRAMING_OPTIONS,
  SAMPLE_SCRIPT,
  createStoryboardMarkdown,
  moveStoryboardShot,
  rebuildVideoPrompts,
  validateStoryboard,
  type Character,
  type Scene,
  type Shot,
  type Storyboard,
} from "@/lib/storyboard";

function errorMessageFrom(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error;
  }
  return "生成失败，请稍后重试。";
}

function initialLibrary(): ProjectLibrary {
  const project = createProjectDraft("我的第一个故事板");
  return { version: 1, activeProjectId: project.id, projects: [project] };
}

function safeFilename(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]/g, "-") || "帧语项目";
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [library, setLibrary] = useState<ProjectLibrary | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [notice, setNotice] = useState("");
  const [isError, setIsError] = useState(false);
  const [saveStatus, setSaveStatus] = useState("正在读取本地项目…");
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasExported, setHasExported] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const activeProject = useMemo(() => {
    return library?.projects.find((project) => project.id === library.activeProjectId) ?? null;
  }, [library]);
  const storyboard = activeProject?.storyboard ?? null;
  const script = activeProject?.script ?? "";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const restored = loadProjectLibrary(window.localStorage);
        if (!restored.ok) {
          setLibrary(initialLibrary());
          setSaveStatus("本地草稿无法恢复，已新建空白项目");
          setNotice(restored.error);
          setIsError(true);
        } else if (!restored.value) {
          setLibrary(initialLibrary());
          setSaveStatus("已建立本地项目库");
        } else {
          setLibrary(restored.value);
          setSaveStatus("已恢复本地草稿");
        }
      } catch {
        setLibrary(initialLibrary());
        setSaveStatus("本地草稿无法读取，已新建空白项目");
        setNotice("读取本地草稿失败，请检查浏览器存储权限。");
        setIsError(true);
      } finally {
        setIsHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isHydrated || !library) return;
    const timer = window.setTimeout(() => {
      const saved = saveProjectLibrary(window.localStorage, library);
      if (saved.ok) {
        setSaveStatus("已自动保存到当前浏览器");
      } else {
        setSaveStatus(`尚未保存：${saved.error}`);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [isHydrated, library]);

  function showNotice(message: string, error = false) {
    setNotice(message);
    setIsError(error);
  }

  function updateActiveProject(updater: (project: LocalProjectDraft) => LocalProjectDraft) {
    setSaveStatus("保存中…");
    setLibrary((current) => {
      if (!current) return current;
      const now = new Date().toISOString();
      return {
        ...current,
        projects: current.projects.map((project) => {
          return project.id === current.activeProjectId
            ? { ...updater(project), updatedAt: now }
            : project;
        }),
      };
    });
    setHasExported(false);
  }

  function updateStoryboard(updater: (value: Storyboard) => Storyboard) {
    updateActiveProject((project) => {
      return project.storyboard ? { ...project, storyboard: updater(project.storyboard) } : project;
    });
  }

  function updateScript(value: string) {
    updateActiveProject((project) => ({
      ...project,
      script: value,
      storyboard: project.storyboard ? { ...project.storyboard, sourceScript: value } : null,
    }));
    showNotice("");
  }

  function createProject() {
    const project = createProjectDraft(`未命名项目 ${library ? library.projects.length + 1 : 1}`);
    setLibrary((current) => current
      ? { ...current, activeProjectId: project.id, projects: [...current.projects, project] }
      : { version: 1, activeProjectId: project.id, projects: [project] });
    showNotice("已新建空白项目。");
  }

  function renameProject() {
    if (!activeProject) return;
    const nextName = window.prompt("输入项目名称", activeProject.name)?.trim();
    if (!nextName) return;
    updateActiveProject((project) => ({ ...project, name: nextName }));
    showNotice("项目已重命名。");
  }

  function deleteProject() {
    if (!library || !activeProject) return;
    if (!window.confirm(`确定删除“${activeProject.name}”吗？此操作仅删除当前浏览器中的草稿，无法撤销。`)) return;

    const remaining = library.projects.filter((project) => project.id !== activeProject.id);
    if (remaining.length > 0) {
      setLibrary({ ...library, activeProjectId: remaining[0].id, projects: remaining });
    } else {
      setLibrary(initialLibrary());
    }
    showNotice("本地项目已删除。");
  }

  function loadSample() {
    updateScript(SAMPLE_SCRIPT);
    showNotice("已载入示例脚本，可继续修改或生成分镜。");
  }

  async function handleGenerate() {
    if (!activeProject || script.trim().length < 50) {
      showNotice("脚本太短了，请至少输入 50 个字。", true);
      return;
    }

    setIsGenerating(true);
    showNotice("");
    try {
      const response = await fetch("/api/generate-storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessageFrom(payload));

      const validation = validateStoryboard(payload);
      if (!validation.ok) throw new Error(validation.error);

      updateActiveProject((project) => ({
        ...project,
        name: project.name.startsWith("未命名项目") ? validation.value.title : project.name,
        script: validation.value.sourceScript,
        storyboard: validation.value,
      }));
      showNotice("分镜已生成并开始自动保存，你可继续编辑全部资产。");
      window.setTimeout(() => document.querySelector("#storyboard")?.scrollIntoView({ behavior: "smooth" }), 80);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "生成失败，请稍后重试。", true);
    } finally {
      setIsGenerating(false);
    }
  }

  function updateCharacter(id: string, field: keyof Pick<Character, "name" | "role" | "description">, value: string) {
    updateStoryboard((current) => ({
      ...current,
      characters: current.characters.map((character) => character.id === id
        ? { ...character, [field]: value, ...(field === "name" && value.trim() ? { avatarLabel: value.trim().slice(0, 2) } : {}) }
        : character),
    }));
  }

  function updateScene(id: string, field: keyof Pick<Scene, "name" | "description">, value: string) {
    updateStoryboard((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === id ? { ...scene, [field]: value } : scene),
    }));
  }

  function updateShot<K extends keyof Pick<Shot, "sceneId" | "framing" | "action" | "emotion" | "visual" | "videoPrompt">>(id: number, field: K, value: Shot[K]) {
    updateStoryboard((current) => ({
      ...current,
      shots: current.shots.map((shot) => shot.id === id ? { ...shot, [field]: value } : shot),
    }));
  }

  function moveShot(index: number, direction: -1 | 1) {
    updateStoryboard((current) => moveStoryboardShot(current, index, direction));
    showNotice("镜头顺序已调整，现有提示词保持不变。");
  }

  async function copyVideoPrompt(prompt: string, shotNumber: number) {
    try {
      await navigator.clipboard.writeText(prompt);
      showNotice(`镜头 ${shotNumber} 的图生视频提示词已复制。`);
    } catch {
      showNotice("复制失败，请手动选中提示词后复制。", true);
    }
  }

  function rebuildPrompts() {
    if (!storyboard) return;
    const validation = validateStoryboard(storyboard);
    if (!validation.ok) {
      showNotice(`无法重建提示词：${validation.error}`, true);
      return;
    }
    if (!window.confirm("按当前角色、场景和镜头重建 6 条提示词吗？这会覆盖你手动编辑过的全部提示词。")) return;
    updateStoryboard((current) => rebuildVideoPrompts(current));
    showNotice("已按当前资产重建 6 条图生视频提示词。");
  }

  function exportMarkdown() {
    if (!storyboard) return;
    const validation = validateStoryboard(storyboard);
    if (!validation.ok) {
      showNotice(`导出失败：${validation.error}`, true);
      return;
    }
    downloadText(`${safeFilename(storyboard.title)}-分镜资产包.md`, createStoryboardMarkdown(storyboard, new Date().toLocaleString("zh-CN")), "text/markdown;charset=utf-8");
    setHasExported(true);
    showNotice("已导出当前编辑状态的 Markdown 资产包。");
  }

  function exportJson() {
    if (!activeProject) return;
    try {
      downloadText(`${safeFilename(activeProject.name)}-帧语备份.json`, createProjectBackup(activeProject), "application/json;charset=utf-8");
      showNotice("已导出 JSON 项目备份。");
    } catch (error) {
      showNotice(`JSON 导出失败：${error instanceof Error ? error.message : "项目数据无效。"}`, true);
    }
  }

  async function importJson(file: File | undefined) {
    if (!file) return;
    try {
      const validation = parseProjectBackup(await file.text());
      if (!validation.ok) {
        showNotice(validation.error, true);
        return;
      }
      setLibrary((current) => current
        ? { ...current, activeProjectId: validation.value.id, projects: [...current.projects, validation.value] }
        : { version: 1, activeProjectId: validation.value.id, projects: [validation.value] });
      showNotice("项目备份已导入并切换为当前项目。");
    } catch {
      showNotice("读取 JSON 文件失败，请重新选择。", true);
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="帧语首页"><span className="brand-mark">帧</span><span>帧语</span></a>
        <div className="step-pill"><span />{storyboard ? "2 / 3 资产编辑" : "1 / 3 脚本解析"}</div>
      </header>

      <section className="project-shelf" aria-label="本地项目管理">
        <div className="project-switcher">
          <label htmlFor="project-select">当前项目</label>
          <select id="project-select" value={library?.activeProjectId ?? ""} disabled={!library} onChange={(event) => {
            setLibrary((current) => current ? { ...current, activeProjectId: event.target.value } : current);
            showNotice("已切换本地项目。");
          }}>
            {library?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <button type="button" onClick={createProject}>+新建</button>
          <button type="button" onClick={renameProject} disabled={!activeProject}>重命名</button>
          <button className="danger-text" type="button" onClick={deleteProject} disabled={!activeProject}>删除</button>
        </div>
        <div className="backup-actions">
          <span className="save-status" aria-live="polite"><i />{saveStatus}</span>
          <input ref={importInputRef} className="visually-hidden" type="file" accept="application/json,.json" aria-label="导入 JSON 项目备份" onChange={(event) => void importJson(event.target.files?.[0])} />
          <button type="button" onClick={() => importInputRef.current?.click()}>导入 JSON</button>
          <button type="button" onClick={exportJson} disabled={!activeProject}>导出 JSON</button>
        </div>
      </section>

      <section className="hero" id="top">
        <div className="eyebrow">• AI 短剧故事板工作台</div>
        <h1>把脚本，变成<br /><em>可拍的每一帧</em></h1>
        <p className="intro">粘贴短剧脚本，拆解角色、场景和镜头，<br className="desktop-break" />在当前浏览器持续编辑并导出可用的分镜资产。</p>
      </section>

      <section className="workspace" aria-labelledby="script-title">
        <div className="workspace-head">
          <div><span className="step-number">01</span><div><h2 id="script-title">编辑短剧脚本</h2><p>建议 300–1500 字，包含人物、对话和场景信息</p></div></div>
          <button className="sample-button" type="button" onClick={loadSample}><span aria-hidden="true">◇</span> 使用示例脚本</button>
        </div>
        <div className="editor-wrap">
          <textarea aria-label="短剧脚本" value={script} disabled={!activeProject} onChange={(event) => updateScript(event.target.value)} placeholder={isHydrated ? "在这里粘贴你的故事…" : "正在恢复本地项目…"} />
          <span className="counter">{script.length} 字</span>
        </div>
        <div className="workspace-foot">
          <div className="notice-stack">
            <p className={isError ? "notice error" : "notice"} aria-live="polite">{notice || "点击生成后，脚本会发送至你配置的 AI 服务，仅用于本次生成。"}</p>
            <p className="local-note">本地草稿只保存在当前浏览器；更换设备前请导出 JSON 备份。</p>
          </div>
          <button className="generate-button" type="button" onClick={handleGenerate} disabled={isGenerating || !activeProject}>{isGenerating ? "生成中…" : <>生成分镜 <span aria-hidden="true">→</span></>}</button>
        </div>
      </section>

      {storyboard && (
        <section className="results" id="storyboard" aria-labelledby="result-title">
          <div className="result-heading">
            <div className="result-title-block">
              <span className="result-kicker">02 · AI 生成结果</span>
              <input id="result-title" className="storyboard-title-input" aria-label="故事板标题" value={storyboard.title} onChange={(event) => updateStoryboard((current) => ({ ...current, title: event.target.value }))} />
              <p>角色、场景和镜头的修改不会静默覆盖你已编辑的提示词。</p>
            </div>
            <div className="result-actions">
              <span className="result-count">{storyboard.characters.length} 角色 · {storyboard.scenes.length} 场景 · {storyboard.shots.length} 镜头</span>
              <button className="secondary-action" type="button" onClick={rebuildPrompts}>按当前资产重建提示词</button>
              <button className="export-button" type="button" onClick={exportMarkdown}>{hasExported ? "已导出 Markdown ✓" : "导出 Markdown ↓"}</button>
            </div>
          </div>

          <div className="asset-section">
            <div className="section-label"><span>CAST</span><h3>角色卡</h3><p>名称、身份和外观设定均可编辑</p></div>
            <div className="character-grid">
              {storyboard.characters.map((character) => (
                <article className="character-card editable-card" key={character.id}>
                  <div className={`character-avatar ${character.avatarTone}`}>{character.avatarLabel}</div>
                  <div className="card-edit-fields">
                    <input aria-label={`${character.name}名称`} value={character.name} onChange={(event) => updateCharacter(character.id, "name", event.target.value)} />
                    <input aria-label={`${character.name}身份`} value={character.role} onChange={(event) => updateCharacter(character.id, "role", event.target.value)} />
                    <textarea aria-label={`${character.name}角色设定`} value={character.description} onChange={(event) => updateCharacter(character.id, "description", event.target.value)} />
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="asset-section">
            <div className="section-label"><span>SCENE</span><h3>场景卡</h3><p>镜头所属场景可在下方切换</p></div>
            <div className="scene-grid">
              {storyboard.scenes.map((scene) => (
                <article className="scene-card editable-card" key={scene.id}>
                  <span className="scene-index">{scene.id.toUpperCase()}</span>
                  <div className="card-edit-fields">
                    <input aria-label={`${scene.id}场景名称`} value={scene.name} onChange={(event) => updateScene(scene.id, "name", event.target.value)} />
                    <textarea aria-label={`${scene.id}场景设定`} value={scene.description} onChange={(event) => updateScene(scene.id, "description", event.target.value)} />
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="asset-section storyboard-section">
            <div className="section-label"><span>SHOTS</span><h3>6 镜头故事板</h3><p>可调整顺序、编辑资产并复制单条提示词</p></div>
            <div className="shot-grid">
              {storyboard.shots.map((shot, index) => (
                <article className="shot-card" key={shot.id}>
                  <div className={`shot-preview preview-${(index % 6) + 1}`}>
                    <div className="shot-toolbar">
                      <span>SHOT {String(index + 1).padStart(2, "0")}</span>
                      <div><button type="button" aria-label={`镜头 ${index + 1} 上移`} disabled={index === 0} onClick={() => moveShot(index, -1)}>↑</button><button type="button" aria-label={`镜头 ${index + 1} 下移`} disabled={index === storyboard.shots.length - 1} onClick={() => moveShot(index, 1)}>↓</button></div>
                    </div>
                    <p>{shot.visual}</p>
                  </div>
                  <div className="shot-fields">
                    <label><span>场景</span><select value={shot.sceneId} onChange={(event) => updateShot(shot.id, "sceneId", event.target.value)}>{storyboard.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select></label>
                    <label><span>景别</span><select value={shot.framing} onChange={(event) => updateShot(shot.id, "framing", event.target.value as Shot["framing"])}>{FRAMING_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
                    <label><span>动作</span><textarea value={shot.action} onChange={(event) => updateShot(shot.id, "action", event.target.value)} /></label>
                    <label><span>情绪</span><input value={shot.emotion} onChange={(event) => updateShot(shot.id, "emotion", event.target.value)} /></label>
                    <label><span>视觉</span><textarea value={shot.visual} onChange={(event) => updateShot(shot.id, "visual", event.target.value)} /></label>
                    <label className="video-prompt-field"><span>图生视频提示词 <button type="button" onClick={() => void copyVideoPrompt(shot.videoPrompt, index + 1)}>复制</button></span><textarea value={shot.videoPrompt} onChange={(event) => updateShot(shot.id, "videoPrompt", event.target.value)} /></label>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <footer><span>从文字到画面，先让故事站稳。</span><span>MVP+ · 本地优先工作台</span></footer>
    </main>
  );
}
