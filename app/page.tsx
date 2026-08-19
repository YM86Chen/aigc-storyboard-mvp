"use client";

import { useState } from "react";

type Shot = {
  id: number;
  framing: string;
  action: string;
  emotion: string;
  visual: string;
};

const SAMPLE_SCRIPT = `《最后一班地铁》

深夜，林夏独自坐在空荡的末班地铁里。车窗外一片漆黑，手机忽然收到一条陌生短信：“不要在下一站下车。”

广播响起：“终点站，到了。”林夏抬头，却发现对面不知何时坐着一个穿旧式制服的女孩。

女孩看着她，轻声说：“你终于回来了。”

车门缓缓打开，站台上站满了沉默的人影。林夏握紧手机，屏幕上又出现一行字：“现在，假装你认识她。”`;

const INITIAL_SHOTS: Shot[] = [
  { id: 1, framing: "远景", action: "林夏独自坐在空荡的末班地铁里", emotion: "孤独、警觉", visual: "深夜车厢，冷白灯闪烁，窗外漆黑" },
  { id: 2, framing: "特写", action: "手机屏幕亮起，收到陌生短信", emotion: "意外、紧张", visual: "手指握紧手机，短信写着不要下车" },
  { id: 3, framing: "中景", action: "林夏抬头，看见对面的制服女孩", emotion: "错愕、戒备", visual: "两人隔着过道对坐，空间压迫而安静" },
  { id: 4, framing: "近景", action: "女孩注视林夏，轻声开口", emotion: "平静、诡异", visual: "旧式制服女孩半张脸藏在阴影中" },
  { id: 5, framing: "全景", action: "车门打开，站台人影同时望来", emotion: "恐惧、窒息", visual: "昏暗站台挤满沉默人影，车门形成画框" },
  { id: 6, framing: "大特写", action: "林夏再次看向手机，强装镇定", emotion: "惊恐、克制", visual: "眼睛与手机屏幕交叠，屏幕提示假装认识她" },
];

export default function Home() {
  const [script, setScript] = useState("");
  const [notice, setNotice] = useState("");
  const [hasGenerated, setHasGenerated] = useState(false);
  const [shots, setShots] = useState(INITIAL_SHOTS);
  const [hasExported, setHasExported] = useState(false);

  function loadSample() {
    setScript(SAMPLE_SCRIPT);
    setNotice("");
  }

  function handleGenerate() {
    if (script.trim().length < 50) {
      setNotice("脚本太短了，请至少输入 50 个字。");
      return;
    }

    setHasGenerated(true);
    setNotice("已用本地模拟规则生成分镜，你可以继续编辑镜头卡。");
    window.setTimeout(() => document.querySelector("#storyboard")?.scrollIntoView({ behavior: "smooth" }), 80);
  }

  function updateShot(id: number, field: keyof Omit<Shot, "id" | "visual">, value: string) {
    setShots((current) => current.map((shot) => shot.id === id ? { ...shot, [field]: value } : shot));
    setHasExported(false);
  }

  function exportMarkdown() {
    const title = script.split("\n").find((line) => line.trim())?.replace(/[《》#]/g, "").trim() || "短剧故事板";
    const shotMarkdown = shots.map((shot) => `### 镜头 ${String(shot.id).padStart(2, "0")}

- **景别：** ${shot.framing}
- **动作：** ${shot.action}
- **情绪：** ${shot.emotion}
- **画面提示词：** ${shot.visual}
- **图生视频建议：** 保持角色与场景一致，突出“${shot.action}”，情绪为“${shot.emotion}”。`).join("\n\n");

    const markdown = `# ${title} · 分镜资产包

> 由帧语本地 MVP 生成，可复制到即梦、可灵或 Seedance 工作流中继续使用。

## 原始脚本

${script.trim()}

## 角色设定

### 林夏
- **身份：** 主角，25 岁的普通上班族
- **外观：** 短发、浅灰风衣
- **人物状态：** 被意外卷入末班地铁的秘密

### 制服女孩
- **身份：** 神秘人，约 18 岁
- **外观：** 旧式深蓝制服、脸色苍白
- **人物状态：** 似乎早已认识林夏

## 场景设定

### S01 · 末班地铁车厢
深夜，内景，冷白荧光灯，空旷压抑，现代都市悬疑。

### S02 · 废弃终点站台
深夜，暗绿色顶灯，潮湿雾气，密集沉默人影。

## 镜头清单

${shotMarkdown}

---

生成时间：${new Date().toLocaleString("zh-CN")}
`;

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title}-分镜资产包.md`;
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
            }}
            placeholder={"在这里粘贴你的故事…\n\n例如：\n夜。天台。\n林夏站在边缘，手里紧握着一封信…"}
          />
          <span className="counter">{script.length} 字</span>
        </div>

        <div className="workspace-foot">
          <p className={notice.includes("请先") ? "notice error" : "notice"} aria-live="polite">
            {notice || "内容仅在本地浏览器中处理，不会上传。"}
          </p>
          <button className="generate-button" type="button" onClick={handleGenerate}>
            生成分镜 <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>

      {hasGenerated && (
        <section className="results" id="storyboard" aria-labelledby="result-title">
          <div className="result-heading">
            <div>
              <span className="result-kicker">02 · 本地模拟生成</span>
              <h2 id="result-title">故事世界已经拆解完成</h2>
              <p>先检查角色与场景是否一致，再逐镜调整景别、动作和情绪。</p>
            </div>
            <div className="result-actions">
              <span className="result-count">2 角色 · 2 场景 · 6 镜头</span>
              <button className="export-button" type="button" onClick={exportMarkdown}>
                {hasExported ? "已导出 Markdown ✓" : "导出 Markdown ↓"}
              </button>
            </div>
          </div>

          <div className="asset-section">
            <div className="section-label"><span>CAST</span><h3>角色卡</h3></div>
            <div className="character-grid">
              <article className="character-card">
                <div className="character-avatar orange">林</div>
                <div><h4>林夏</h4><p>25 岁，短发，浅灰风衣；普通上班族，被意外卷入末班地铁的秘密。</p></div>
                <span className="tag">主角</span>
              </article>
              <article className="character-card">
                <div className="character-avatar dark">影</div>
                <div><h4>制服女孩</h4><p>约 18 岁，旧式深蓝制服，脸色苍白；似乎早已认识林夏。</p></div>
                <span className="tag">神秘人</span>
              </article>
            </div>
          </div>

          <div className="asset-section">
            <div className="section-label"><span>SCENE</span><h3>场景卡</h3></div>
            <div className="scene-grid">
              <article className="scene-card">
                <span className="scene-index">S01</span>
                <div><h4>末班地铁车厢</h4><p>深夜 · 内景 · 冷白荧光灯 · 空旷压抑 · 现代都市悬疑</p></div>
              </article>
              <article className="scene-card">
                <span className="scene-index">S02</span>
                <div><h4>废弃终点站台</h4><p>深夜 · 外景感 · 暗绿色顶灯 · 潮湿雾气 · 密集沉默人影</p></div>
              </article>
            </div>
          </div>

          <div className="asset-section storyboard-section">
            <div className="section-label"><span>SHOTS</span><h3>6 镜头故事板</h3><p>点击字段即可编辑</p></div>
            <div className="shot-grid">
              {shots.map((shot) => (
                <article className="shot-card" key={shot.id}>
                  <div className={`shot-preview preview-${shot.id}`}>
                    <span>SHOT {String(shot.id).padStart(2, "0")}</span>
                    <p>{shot.visual}</p>
                  </div>
                  <div className="shot-fields">
                    <label>
                      <span>景别</span>
                      <select value={shot.framing} onChange={(event) => updateShot(shot.id, "framing", event.target.value)}>
                        {['远景', '全景', '中景', '近景', '特写', '大特写'].map((option) => <option key={option}>{option}</option>)}
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
