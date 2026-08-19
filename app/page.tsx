"use client";

import { useState } from "react";
import {
  FRAMING_OPTIONS,
  SAMPLE_SCRIPT,
  type Shot,
  type Storyboard,
} from "@/lib/storyboard";

function errorMessageFrom(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error;
  }

  return "生成失败，请稍后重试。";
}

function isStoryboard(payload: unknown): payload is Storyboard {
  if (!payload || typeof payload !== "object") return false;

  const value = payload as Partial<Storyboard>;
  return typeof value.title === "string"
    && typeof value.sourceScript === "string"
    && Array.isArray(value.characters)
    && Array.isArray(value.scenes)
    && Array.isArray(value.shots);
}

export default function Home() {
  const [script, setScript] = useState("");
  const [notice, setNotice] = useState("");
  const [isError, setIsError] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [hasExported, setHasExported] = useState(false);

  function loadSample() {
    setScript(SAMPLE_SCRIPT);
    setNotice("");
    setIsError(false);
  }

  async function handleGenerate() {
    if (script.trim().length < 50) {
      setNotice("脚本太短了，请至少输入 50 个字。");
      setIsError(true);
      return;
    }

    setIsGenerating(true);
    setIsError(false);
    setNotice("");

    try {
      const response = await fetch("/api/generate-storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(errorMessageFrom(payload));
      }

      if (!isStoryboard(payload)) {
        throw new Error("生成结果格式不正确，请稍后重试。");
      }

      setStoryboard(payload);
      setHasExported(false);
      setNotice("分镜已生成，你可以继续编辑镜头卡。");
      window.setTimeout(() => document.querySelector("#storyboard")?.scrollIntoView({ behavior: "smooth" }), 80);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "生成失败，请稍后重试。");
      setIsError(true);
    } finally {
      setIsGenerating(false);
    }
  }

  function updateShot<K extends "framing" | "action" | "emotion">(id: number, field: K, value: Shot[K]) {
    setStoryboard((current) => current && {
      ...current,
      shots: current.shots.map((shot) => shot.id === id ? { ...shot, [field]: value } : shot),
    });
    setHasExported(false);
  }

  function exportMarkdown() {
    if (!storyboard) return;

    const shotMarkdown = storyboard.shots.map((shot) => `### 镜头 ${String(shot.id).padStart(2, "0")}

- **景别：** ${shot.framing}
- **动作：** ${shot.action}
- **情绪：** ${shot.emotion}
- **画面提示词：** ${shot.visual}
- **图生视频建议：** 保持角色与场景一致，突出“${shot.action}”，情绪为“${shot.emotion}”。`).join("\n\n");

    const characterMarkdown = storyboard.characters.map((character) => `### ${character.name}
- **身份：** ${character.role}
- **设定：** ${character.description}`).join("\n\n");

    const sceneMarkdown = storyboard.scenes.map((scene) => `### ${scene.id.toUpperCase()} · ${scene.name}
${scene.description}`).join("\n\n");

    const markdown = `# ${storyboard.title} · 分镜资产包

> 由帧语本地 MVP 生成，可复制到即梦、可灵或 Seedance 工作流中继续使用。

## 原始脚本

${storyboard.sourceScript.trim()}

## 角色设定

${characterMarkdown}

## 场景设定

${sceneMarkdown}

## 镜头清单

${shotMarkdown}

---

生成时间：${new Date().toLocaleString("zh-CN")}
`;

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${storyboard.title}-分镜资产包.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setHasExported(true);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="帧语首页">
          <span className="brand-mark">帧</span>
          <span>帧语</span>
        </a>
        <div className="step-pill"><span /> 1 / 3 脚本解析</div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow">• AI 短剧故事板工作台</div>
        <h1>把脚本，变成<br /><em>可拍的每一帧</em></h1>
        <p className="intro">粘贴你的短剧脚本，一键拆解角色、场景和镜头，<br className="desktop-break" />
          快速准备可用于即梦、可灵或 Seedance 的分镜资产。</p>
      </section>

      <section className="workspace" aria-labelledby="script-title">
        <div className="workspace-head">
          <div>
            <span className="step-number">01</span>
            <div>
              <h2 id="script-title">输入短剧脚本</h2>
              <p>建议 300–1500 字，包含人物、对话和场景信息</p>
            </div>
          </div>
          <button className="sample-button" type="button" onClick={loadSample}>
            <span aria-hidden="true">◇</span> 使用示例脚本
          </button>
        </div>

        <div className="editor-wrap">
          <textarea
            aria-label="短剧脚本"
            value={script}
            onChange={(event) => {
              setScript(event.target.value);
              setNotice("");
              setIsError(false);
            }}
            placeholder={"在这里粘贴你的故事…\n\n例如：\n夜。天台。\n林夏站在边缘，手里紧握着一封信…"}
          />
          <span className="counter">{script.length} 字</span>
        </div>

        <div className="workspace-foot">
          <p className={isError ? "notice error" : "notice"} aria-live="polite">
            {notice || "点击“生成分镜”后，脚本会发送至你配置的 AI 服务，仅用于本次生成。"}
          </p>
          <button className="generate-button" type="button" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? "生成中…" : <>生成分镜 <span aria-hidden="true">→</span></>}
          </button>
        </div>
      </section>

      {storyboard && (
        <section className="results" id="storyboard" aria-labelledby="result-title">
          <div className="result-heading">
            <div>
              <span className="result-kicker">02 · AI 生成结果</span>
              <h2 id="result-title">故事世界已经拆解完成</h2>
              <p>先检查角色与场景是否一致，再逐镜调整景别、动作和情绪。</p>
            </div>
            <div className="result-actions">
              <span className="result-count">{storyboard.characters.length} 角色 · {storyboard.scenes.length} 场景 · {storyboard.shots.length} 镜头</span>
              <button className="export-button" type="button" onClick={exportMarkdown}>
                {hasExported ? "已导出 Markdown ✓" : "导出 Markdown ↓"}
              </button>
            </div>
          </div>

          <div className="asset-section">
            <div className="section-label"><span>CAST</span><h3>角色卡</h3></div>
            <div className="character-grid">
              {storyboard.characters.map((character) => (
                <article className="character-card" key={character.id}>
                  <div className={`character-avatar ${character.avatarTone}`}>{character.avatarLabel}</div>
                  <div><h4>{character.name}</h4><p>{character.description}</p></div>
                  <span className="tag">{character.role}</span>
                </article>
              ))}
            </div>
          </div>

          <div className="asset-section">
            <div className="section-label"><span>SCENE</span><h3>场景卡</h3></div>
            <div className="scene-grid">
              {storyboard.scenes.map((scene) => (
                <article className="scene-card" key={scene.id}>
                  <span className="scene-index">{scene.id.toUpperCase()}</span>
                  <div><h4>{scene.name}</h4><p>{scene.description}</p></div>
                </article>
              ))}
            </div>
          </div>

          <div className="asset-section storyboard-section">
            <div className="section-label"><span>SHOTS</span><h3>6 镜头故事板</h3><p>点击字段即可编辑</p></div>
            <div className="shot-grid">
              {storyboard.shots.map((shot) => (
                <article className="shot-card" key={shot.id}>
                  <div className={`shot-preview preview-${shot.id}`}>
                    <span>SHOT {String(shot.id).padStart(2, "0")}</span>
                    <p>{shot.visual}</p>
                  </div>
                  <div className="shot-fields">
                    <label>
                      <span>景别</span>
                      <select value={shot.framing} onChange={(event) => updateShot(shot.id, "framing", event.target.value as Shot["framing"])}>
                        {FRAMING_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>动作</span>
                      <textarea value={shot.action} onChange={(event) => updateShot(shot.id, "action", event.target.value)} />
                    </label>
                    <label>
                      <span>情绪</span>
                      <input value={shot.emotion} onChange={(event) => updateShot(shot.id, "emotion", event.target.value)} />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <footer>
        <span>从文字到画面，先让故事站稳。</span>
        <span>MVP · 本地原型</span>
      </footer>
    </main>
  );
}
