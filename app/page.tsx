"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createProjectBackup,
  createProjectDraft,
  loadProjectLibrary,
  parseProjectBackup,
  saveProjectLibrary,
  validateProjectDraft,
  type LocalProjectDraft,
  type ProjectLibrary,
} from "@/lib/projects";
import type { CloudProject } from "@/lib/cloud-projects";
import {
  FRAMING_OPTIONS,
  SAMPLE_SCRIPT,
  createAllVideoPromptsText,
  createStoryboardMarkdown,
  markVideoPromptsStale,
  moveStoryboardShot,
  rebuildVideoPrompt,
  rebuildVideoPrompts,
  setManualVideoPrompt,
  validateStoryboard,
  type Character,
  type Scene,
  type Shot,
  type Storyboard,
} from "@/lib/storyboard";
import { MAX_SCRIPT_LENGTH } from "@/lib/generation-service";
import { createSingleFlight } from "@/lib/single-flight";

function errorMessageFrom(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error;
  }
  return "生成失败，请稍后重试。";
}

function safeClientError(error: unknown, fallback: string) {
  return error instanceof Error && error.name !== "TypeError" && error.message.trim()
    ? error.message
    : fallback;
}

function initialLibrary(): ProjectLibrary {
  const project = createProjectDraft("我的第一个故事板");
  return { version: 1, activeProjectId: project.id, projects: [project] };
}

type SessionUser = {
  userId: string;
  displayName: string;
  email: string;
};

type SessionState =
  | { status: "loading"; user: null; signInPath: string; signOutPath: string }
  | { status: "anonymous"; user: null; signInPath: string; signOutPath: string }
  | { status: "authenticated"; user: SessionUser; signInPath: string; signOutPath: string };

type CloudIssue = "failed" | "conflict" | null;

const LOCAL_MIGRATION_KEY_PREFIX = "zhenyu.cloud-migrated.v1.";

function projectPayload(project: LocalProjectDraft) {
  return { name: project.name, script: project.script, storyboard: project.storyboard };
}

function cloudProjectToDraft(project: CloudProject): LocalProjectDraft {
  return {
    id: project.id,
    name: project.name,
    script: project.script,
    storyboard: project.storyboard,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function validatedCloudProject(value: unknown): CloudProject | null {
  if (!value || typeof value !== "object") return null;
  const version = (value as { version?: unknown }).version;
  const validation = validateProjectDraft(value);
  if (!validation.ok || !Number.isInteger(version) || Number(version) < 1) return null;
  return { ...validation.value, version: Number(version) };
}

function migratedLocalIds(storage: Storage, userId: string) {
  try {
    const value: unknown = JSON.parse(storage.getItem(`${LOCAL_MIGRATION_KEY_PREFIX}${userId}`) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function rememberMigratedLocalId(storage: Storage, userId: string, id: string) {
  try {
    const ids = migratedLocalIds(storage, userId);
    ids.add(id);
    storage.setItem(`${LOCAL_MIGRATION_KEY_PREFIX}${userId}`, JSON.stringify([...ids]));
  } catch {
    // The migration itself remains valid even when this optional local marker fails.
  }
}

async function responsePayload(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
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

async function writeClipboardText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    if (!copied) throw new Error("clipboard");
  }
}

function promptState(shot: Shot) {
  if (shot.videoPromptSource === "manual") {
    return shot.videoPromptNeedsRebuild
      ? { label: "待检查 · 手动保护", className: "prompt-manual-stale" }
      : { label: "手动编辑 · 已保护", className: "prompt-manual" };
  }
  return shot.videoPromptNeedsRebuild
    ? { label: "待重建", className: "prompt-stale" }
    : { label: "提示词已同步", className: "prompt-current" };
}

export default function Home() {
  const [library, setLibrary] = useState<ProjectLibrary | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [session, setSession] = useState<SessionState>({
    status: "loading",
    user: null,
    signInPath: "/signin-with-chatgpt?return_to=%2F",
    signOutPath: "/signout-with-chatgpt?return_to=%2F",
  });
  const [localMigrationProjects, setLocalMigrationProjects] = useState<LocalProjectDraft[]>([]);
  const [cloudVersions, setCloudVersions] = useState<Record<string, number>>({});
  const [cloudIssue, setCloudIssue] = useState<CloudIssue>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [isMigrating, setIsMigrating] = useState(false);
  const [notice, setNotice] = useState("");
  const [isError, setIsError] = useState(false);
  const [saveStatus, setSaveStatus] = useState("正在确认登录状态…");
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasExported, setHasExported] = useState(false);
  const [activeShotIndex, setActiveShotIndex] = useState(0);
  const importInputRef = useRef<HTMLInputElement>(null);
  const editRevisionRef = useRef<Record<string, number>>({});
  const saveBlockedRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const generationFlightRef = useRef(createSingleFlight());

  const activeProject = useMemo(() => {
    return library?.projects.find((project) => project.id === library.activeProjectId) ?? null;
  }, [library]);
  const storyboard = activeProject?.storyboard ?? null;
  const script = activeProject?.script ?? "";
  const staleGeneratedPromptCount = storyboard?.shots.filter((shot) => shot.videoPromptNeedsRebuild && shot.videoPromptSource === "generated").length ?? 0;
  const staleManualPromptCount = storyboard?.shots.filter((shot) => shot.videoPromptNeedsRebuild && shot.videoPromptSource === "manual").length ?? 0;
  const isSaving = saveStatus.includes("正在") || saveStatus.includes("等待") || saveStatus.includes("保存到当前浏览器中");
  const workspaceReady = session.status === "authenticated" || Boolean(storyboard);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      let localLibrary: ProjectLibrary | null = null;
      let signedInUser: SessionUser | null = null;
      try {
        const restored = loadProjectLibrary(window.localStorage);
        if (!restored.ok) {
          setNotice(restored.error);
          setIsError(true);
        } else {
          localLibrary = restored.value;
        }

        const sessionResponse = await fetch("/api/session", { signal: controller.signal });
        const sessionPayload = await responsePayload(sessionResponse) as {
          user?: SessionUser | null;
          signInPath?: string;
          signOutPath?: string;
        } | null;
        if (!sessionResponse.ok || !sessionPayload) throw new Error("session");

        const signInPath = typeof sessionPayload.signInPath === "string"
          ? sessionPayload.signInPath
          : "/signin-with-chatgpt?return_to=%2F";
        const signOutPath = typeof sessionPayload.signOutPath === "string"
          ? sessionPayload.signOutPath
          : "/signout-with-chatgpt?return_to=%2F";

        if (!sessionPayload.user) {
          setSession({ status: "anonymous", user: null, signInPath, signOutPath });
          setLibrary(localLibrary ?? initialLibrary());
          setSaveStatus(localLibrary ? "已恢复本地草稿" : "已建立本地项目库");
          return;
        }

        const user = sessionPayload.user;
        signedInUser = user;
        setSession({ status: "authenticated", user, signInPath, signOutPath });
        if (localLibrary) {
          const migrated = migratedLocalIds(window.localStorage, user.userId);
          setLocalMigrationProjects(localLibrary.projects.filter((project) => !migrated.has(project.id)));
        }

        const projectsResponse = await fetch("/api/projects", { signal: controller.signal });
        const projectsPayload = await responsePayload(projectsResponse) as { projects?: unknown[] } | null;
        if (!projectsResponse.ok || !projectsPayload || !Array.isArray(projectsPayload.projects)) {
          throw new Error(errorMessageFrom(projectsPayload));
        }
        const projects = projectsPayload.projects.map(validatedCloudProject);
        if (projects.some((project) => !project)) throw new Error("云端项目数据校验失败。");
        const cloudProjects = projects as CloudProject[];
        setCloudVersions(Object.fromEntries(cloudProjects.map((project) => [project.id, project.version])));
        setLibrary({
          version: 1,
          activeProjectId: cloudProjects[0]?.id ?? "",
          projects: cloudProjects.map(cloudProjectToDraft),
        });
        setSaveStatus(cloudProjects.length ? "已从云端恢复项目" : "云端暂无项目，请新建或迁移本地项目");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (signedInUser) {
          setLibrary({ version: 1, activeProjectId: "", projects: [] });
          setSession((current) => ({
            status: "authenticated",
            user: signedInUser!,
            signInPath: current.signInPath,
            signOutPath: current.signOutPath,
          }));
          setSaveStatus("云端项目加载失败，本地草稿未上传");
        } else {
          setLibrary(localLibrary ?? initialLibrary());
          setSession((current) => ({ ...current, status: "anonymous", user: null }));
          setSaveStatus("云端身份确认失败，正在使用当前浏览器草稿");
        }
        setNotice(error instanceof Error && error.message !== "session"
          ? error.message
          : "无法确认登录状态，暂时使用当前浏览器草稿。");
        setIsError(true);
      } finally {
        if (!controller.signal.aborted) setIsHydrated(true);
      }
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!isHydrated || !library) return;
    if (session.status === "loading") return;

    if (session.status === "authenticated") {
      const dirtyProjectId = Object.keys(editRevisionRef.current)
        .find((id) => library.projects.some((project) => project.id === id));
      const project = library.projects.find((candidate) => candidate.id === dirtyProjectId);
      if (!project || saveBlockedRef.current) return;
      const version = cloudVersions[project.id];
      if (!version) return;
      const revision = editRevisionRef.current[project.id];
      const controller = new AbortController();
      let requestStarted = false;

      const timer = window.setTimeout(async () => {
        if (saveInFlightRef.current) return;
        requestStarted = true;
        saveInFlightRef.current = true;
        setSaveStatus("正在保存到云端…");
        try {
          const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...projectPayload(project), version }),
            signal: controller.signal,
          });
          const payload = await responsePayload(response) as { project?: unknown } | null;
          if (!response.ok) {
            saveBlockedRef.current = true;
            setLibrary((current) => current ? { ...current, activeProjectId: project.id } : current);
            if (response.status === 409) {
              setCloudIssue("conflict");
              setSaveStatus("存在版本冲突，当前编辑内容尚未覆盖云端");
            } else {
              setCloudIssue("failed");
              setSaveStatus("保存失败，当前编辑内容仍保留");
            }
            setNotice(errorMessageFrom(payload));
            setIsError(true);
            return;
          }

          const savedProject = validatedCloudProject(payload?.project);
          if (!savedProject) throw new Error("云端返回的项目数据无效。");
          setCloudVersions((current) => ({ ...current, [project.id]: savedProject.version }));
          if (editRevisionRef.current[project.id] === revision) {
            delete editRevisionRef.current[project.id];
            setLibrary((current) => current ? {
              ...current,
              projects: current.projects.map((candidate) => candidate.id === project.id
                ? cloudProjectToDraft(savedProject)
                : candidate),
            } : current);
            setSaveStatus("已保存到云端");
          }
          setCloudIssue(null);
          setIsError(false);
        } catch (error) {
          if (controller.signal.aborted) return;
          saveBlockedRef.current = true;
          setLibrary((current) => current ? { ...current, activeProjectId: project.id } : current);
          setCloudIssue("failed");
          setSaveStatus("保存失败，当前编辑内容仍保留");
          setNotice(safeClientError(error, "网络连接中断，当前编辑内容仍保留；恢复网络后请重试保存。"));
          setIsError(true);
        } finally {
          saveInFlightRef.current = false;
          if (!saveBlockedRef.current) setRetryNonce((value) => value + 1);
        }
      }, 800);
      return () => {
        if (!requestStarted) controller.abort();
        window.clearTimeout(timer);
      };
    }

    const timer = window.setTimeout(() => {
      const saved = saveProjectLibrary(window.localStorage, library);
      if (saved.ok) {
        setSaveStatus("已自动保存到当前浏览器");
      } else {
        setSaveStatus(`尚未保存：${saved.error}`);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [cloudVersions, isHydrated, library, retryNonce, session.status]);

  function showNotice(message: string, error = false) {
    setNotice(message);
    setIsError(error);
  }

  function updateActiveProject(updater: (project: LocalProjectDraft) => LocalProjectDraft) {
    setSaveStatus(session.status === "authenticated" ? "等待保存到云端…" : "保存到当前浏览器中…");
    setLibrary((current) => {
      if (!current) return current;
      const now = new Date().toISOString();
      if (session.status === "authenticated" && current.activeProjectId) {
        editRevisionRef.current[current.activeProjectId] =
          (editRevisionRef.current[current.activeProjectId] ?? 0) + 1;
      }
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

  async function createCloudProject(project: LocalProjectDraft) {
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projectPayload(project)),
    });
    const payload = await responsePayload(response) as { project?: unknown } | null;
    if (!response.ok) throw new Error(errorMessageFrom(payload));
    const cloudProject = validatedCloudProject(payload?.project);
    if (!cloudProject) throw new Error("云端返回的项目数据无效。");
    return cloudProject;
  }

  async function createProject() {
    const project = createProjectDraft(`未命名项目 ${library ? library.projects.length + 1 : 1}`);
    if (session.status === "authenticated") {
      setSaveStatus("正在创建云端项目…");
      try {
        const cloudProject = await createCloudProject(project);
        setCloudVersions((current) => ({ ...current, [cloudProject.id]: cloudProject.version }));
        setLibrary((current) => ({
          version: 1,
          activeProjectId: cloudProject.id,
          projects: [...(current?.projects ?? []), cloudProjectToDraft(cloudProject)],
        }));
        setSaveStatus("已保存到云端");
        showNotice("已新建云端项目。");
      } catch (error) {
        setSaveStatus("创建失败，未修改现有云端项目");
        showNotice(safeClientError(error, "网络连接失败，未创建云端项目，请稍后手动重试。"), true);
      }
      return;
    }

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

  async function deleteProject() {
    if (!library || !activeProject) return;
    const location = session.status === "authenticated" ? "云端" : "当前浏览器";
    if (!window.confirm(`确定删除“${activeProject.name}”吗？此操作会删除${location}中的项目，无法撤销。`)) return;

    if (session.status === "authenticated") {
      setSaveStatus("正在删除云端项目…");
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}`, { method: "DELETE" });
        if (!response.ok) throw new Error(errorMessageFrom(await responsePayload(response)));
      } catch (error) {
        setSaveStatus("删除失败，项目仍保留");
        showNotice(safeClientError(error, "网络连接失败，云端项目仍保留，请稍后手动重试。"), true);
        return;
      }
    }

    const remaining = library.projects.filter((project) => project.id !== activeProject.id);
    if (remaining.length > 0) {
      setLibrary({ ...library, activeProjectId: remaining[0].id, projects: remaining });
    } else if (session.status === "authenticated") {
      setLibrary({ version: 1, activeProjectId: "", projects: [] });
    } else {
      setLibrary(initialLibrary());
    }
    setCloudVersions((current) => {
      const next = { ...current };
      delete next[activeProject.id];
      return next;
    });
    delete editRevisionRef.current[activeProject.id];
    saveBlockedRef.current = false;
    setCloudIssue(null);
    setSaveStatus(session.status === "authenticated" ? "云端项目已删除" : "本地项目已删除");
    showNotice(session.status === "authenticated" ? "云端项目已删除。" : "本地项目已删除。");
  }

  function retryCloudSave() {
    saveBlockedRef.current = false;
    setCloudIssue(null);
    setSaveStatus("准备重试保存…");
    setRetryNonce((value) => value + 1);
  }

  async function loadLatestCloudProject() {
    if (session.status !== "authenticated" || !activeProject) return;
    if (!window.confirm("加载云端最新版本会替换当前尚未保存的编辑。建议先导出 JSON 备份，确定继续吗？")) return;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}`);
      const payload = await responsePayload(response) as { project?: unknown } | null;
      if (!response.ok) throw new Error(errorMessageFrom(payload));
      const latest = validatedCloudProject(payload?.project);
      if (!latest) throw new Error("云端返回的项目数据无效。");
      delete editRevisionRef.current[activeProject.id];
      saveBlockedRef.current = false;
      setCloudIssue(null);
      setCloudVersions((current) => ({ ...current, [latest.id]: latest.version }));
      setLibrary((current) => current ? {
        ...current,
        projects: current.projects.map((project) => project.id === latest.id
          ? cloudProjectToDraft(latest)
          : project),
      } : current);
      setSaveStatus("已加载云端最新版本");
      showNotice("已加载云端最新版本。");
    } catch (error) {
      showNotice(safeClientError(error, "网络连接失败，当前编辑内容仍保留。"), true);
    }
  }

  async function migrateLocalProjects() {
    if (session.status !== "authenticated" || localMigrationProjects.length === 0) return;
    if (!window.confirm(`将 ${localMigrationProjects.length} 个本地项目复制到你的私有云端吗？本地草稿不会被删除。`)) return;
    setIsMigrating(true);
    setSaveStatus("正在迁移本地项目到云端…");
    let migratedCount = 0;
    try {
      for (const localProject of localMigrationProjects) {
        const cloudProject = await createCloudProject(localProject);
        rememberMigratedLocalId(window.localStorage, session.user.userId, localProject.id);
        setCloudVersions((current) => ({ ...current, [cloudProject.id]: cloudProject.version }));
        setLibrary((current) => ({
          version: 1,
          activeProjectId: cloudProject.id,
          projects: [...(current?.projects ?? []), cloudProjectToDraft(cloudProject)],
        }));
        migratedCount += 1;
        setLocalMigrationProjects((current) => current.filter((project) => project.id !== localProject.id));
      }
      setSaveStatus("本地项目已迁移到云端");
      showNotice(`已将 ${migratedCount} 个本地项目复制到云端，本地草稿仍保留。`);
    } catch (error) {
      setSaveStatus("迁移中断，已成功迁移的项目不会重复处理");
      showNotice(`已迁移 ${migratedCount} 个项目；${safeClientError(error, "网络连接失败，其余项目未迁移。")}`, true);
    } finally {
      setIsMigrating(false);
    }
  }

  function loadSample() {
    updateScript(SAMPLE_SCRIPT);
    showNotice("已载入示例脚本，可继续修改或生成分镜。");
  }

  async function handleGenerate() {
    if (session.status !== "authenticated") {
      showNotice("请先使用 ChatGPT 登录，再生成并保存云端故事板。", true);
      return;
    }
    if (!activeProject || script.trim().length < 50) {
      showNotice("脚本太短了，请至少输入 50 个字。", true);
      return;
    }
    if (script.length > MAX_SCRIPT_LENGTH) {
      showNotice(`脚本过长，请控制在 ${MAX_SCRIPT_LENGTH} 个字以内。`, true);
      return;
    }
    if (!generationFlightRef.current.tryStart()) {
      showNotice("故事板正在生成，请等待本次请求完成。", true);
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
      setActiveShotIndex(0);
      showNotice("分镜已生成并开始自动保存，你可继续编辑全部资产。");
      window.setTimeout(() => document.querySelector("#storyboard")?.scrollIntoView({ behavior: "smooth" }), 80);
    } catch (error) {
      showNotice(safeClientError(error, "网络连接失败，本次生成未完成；确认网络后可手动重试。"), true);
    } finally {
      generationFlightRef.current.finish();
      setIsGenerating(false);
    }
  }

  function updateCharacter(id: string, field: keyof Pick<Character, "name" | "role" | "description">, value: string) {
    updateStoryboard((current) => markVideoPromptsStale({
      ...current,
      characters: current.characters.map((character) => character.id === id
        ? { ...character, [field]: value, ...(field === "name" && value.trim() ? { avatarLabel: value.trim().slice(0, 2) } : {}) }
        : character),
    }));
  }

  function updateScene(id: string, field: keyof Pick<Scene, "name" | "description">, value: string) {
    updateStoryboard((current) => markVideoPromptsStale({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === id ? { ...scene, [field]: value } : scene),
    }, (shot) => shot.sceneId === id));
  }

  function updateShot<K extends keyof Pick<Shot, "sceneId" | "framing" | "action" | "emotion" | "visual" | "videoPrompt">>(id: number, field: K, value: Shot[K]) {
    updateStoryboard((current) => {
      if (field === "videoPrompt") {
        return setManualVideoPrompt(current, id, value as string);
      }
      const updated = {
        ...current,
        shots: current.shots.map((shot) => shot.id === id ? { ...shot, [field]: value } : shot),
      };
      return markVideoPromptsStale(updated, (shot) => shot.id === id);
    });
  }

  function moveShot(index: number, direction: -1 | 1) {
    updateStoryboard((current) => moveStoryboardShot(current, index, direction));
    setActiveShotIndex(index + direction);
    showNotice("镜头顺序已调整，现有提示词保持不变。");
  }

  function focusShot(index: number) {
    if (!storyboard) return;
    const nextIndex = Math.max(0, Math.min(index, storyboard.shots.length - 1));
    setActiveShotIndex(nextIndex);
    window.setTimeout(() => document.querySelector("#shot-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function copyVideoPrompt(prompt: string, shotNumber: number) {
    try {
      await writeClipboardText(prompt);
      showNotice(`镜头 ${shotNumber} 的图生视频提示词已复制。`);
    } catch {
      showNotice("复制失败，请手动选中提示词后复制。", true);
    }
  }

  async function copyAllVideoPrompts() {
    if (!storyboard) return;
    try {
      await writeClipboardText(createAllVideoPromptsText(storyboard));
      showNotice("6 条图生视频提示词已整套复制，并包含场景与角色关联。");
    } catch {
      showNotice("整套复制失败，请使用 Markdown 导出或逐条复制。", true);
    }
  }

  function rebuildPrompts() {
    if (!storyboard) return;
    const validation = validateStoryboard(storyboard);
    if (!validation.ok) {
      showNotice(`无法重建提示词：${validation.error}`, true);
      return;
    }
    if (staleGeneratedPromptCount === 0) {
      showNotice(staleManualPromptCount > 0
        ? `${staleManualPromptCount} 条待检查提示词为手动编辑状态，请在对应镜头中逐条确认重建。`
        : "当前 6 条提示词都已与资产同步，无需重建。");
      return;
    }
    const protectedMessage = staleManualPromptCount > 0
      ? `；另有 ${staleManualPromptCount} 条手动提示词会继续保留，不会被覆盖`
      : "";
    if (!window.confirm(`将按当前资产重建 ${staleGeneratedPromptCount} 条待更新提示词${protectedMessage}。确定继续吗？`)) return;
    updateStoryboard((current) => rebuildVideoPrompts(current));
    showNotice(`已按当前资产重建 ${staleGeneratedPromptCount} 条图生视频提示词，手动提示词未被覆盖。`);
  }

  function rebuildSinglePrompt(shot: Shot, shotNumber: number) {
    if (shot.videoPromptSource === "manual"
      && !window.confirm(`镜头 ${shotNumber} 是手动编辑提示词。确定按当前资产替换这一条吗？`)) return;
    updateStoryboard((current) => rebuildVideoPrompt(current, shot.id));
    showNotice(`镜头 ${shotNumber} 的提示词已按当前资产重建。`);
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
      if (session.status === "authenticated") {
        setSaveStatus("正在导入云端项目…");
        const cloudProject = await createCloudProject(validation.value);
        setCloudVersions((current) => ({ ...current, [cloudProject.id]: cloudProject.version }));
        setLibrary((current) => ({
          version: 1,
          activeProjectId: cloudProject.id,
          projects: [...(current?.projects ?? []), cloudProjectToDraft(cloudProject)],
        }));
        setSaveStatus("导入项目已保存到云端");
        showNotice("JSON 备份已校验、导入云端并切换为当前项目。");
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

  const scriptEditor = (
    <>
      <div className="editor-wrap">
        <textarea aria-label="短剧脚本" value={script} disabled={!activeProject} onChange={(event) => updateScript(event.target.value)} placeholder={isHydrated ? "在这里粘贴你的故事…" : "正在恢复本地项目…"} />
        <span className={`counter ${script.length > MAX_SCRIPT_LENGTH ? "over-limit" : ""}`}>{script.length} / {MAX_SCRIPT_LENGTH} 字</span>
      </div>
      <div className="workspace-foot">
        <div className="notice-stack">
          <p className={isError ? "notice error" : "notice"} aria-live="polite">{notice || "点击生成后，脚本会发送至你配置的 AI 服务，仅用于本次生成。"}</p>
          <p className="local-note">{session.status === "authenticated"
            ? "云端数据库是当前项目的权威来源；本地草稿仅作为迁移来源保留。"
            : "当前使用浏览器本地草稿；登录前不会自动上传任何内容。"}</p>
        </div>
        <button className="generate-button" type="button" onClick={handleGenerate} disabled={isGenerating || !activeProject || session.status !== "authenticated"}>{session.status === "anonymous" ? "登录后生成" : isGenerating ? "生成中…" : <>生成分镜 <span aria-hidden="true">→</span></>}</button>
      </div>
    </>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="帧语首页"><span className="brand-mark">帧</span><span>帧语</span></a>
        <div className="topbar-actions">
          <div className="step-pill"><span />{storyboard ? "2 / 3 资产编辑" : "1 / 3 脚本解析"}</div>
          {session.status === "authenticated" ? (
            <div className="account-pill" title={session.user.email}>
              <span>{session.user.displayName}</span>
              <a href={session.signOutPath}>退出</a>
            </div>
          ) : session.status === "anonymous" ? (
            <a className="login-link" href={session.signInPath}>使用 ChatGPT 登录</a>
          ) : null}
        </div>
      </header>

      <section className="project-shelf" aria-label={session.status === "authenticated" ? "云端项目管理" : "本地项目管理"}>
        <div className="project-primary">
          <div className="project-switcher">
            <label htmlFor="project-select"><span>{session.status === "authenticated" ? "云端项目" : "当前项目"}</span><small>{library?.projects.length ?? 0} 个项目</small></label>
            <select id="project-select" value={library?.activeProjectId ?? ""} disabled={!library || library.projects.length === 0} onChange={(event) => {
              setLibrary((current) => current ? { ...current, activeProjectId: event.target.value } : current);
              setActiveShotIndex(0);
              showNotice(session.status === "authenticated" ? "已切换云端项目。" : "已切换本地项目。");
            }}>
              {library?.projects.length === 0 && <option value="">暂无云端项目</option>}
              {library?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </div>
          <div className="project-actions" aria-label="项目操作">
            <button className="project-create" type="button" onClick={() => void createProject()} disabled={session.status === "loading"}>＋ 新建</button>
            <button type="button" onClick={renameProject} disabled={!activeProject}>重命名</button>
            <button className="danger-text" type="button" onClick={() => void deleteProject()} disabled={!activeProject}>删除</button>
          </div>
        </div>
        <div className="backup-actions">
          <span className={`save-status ${isSaving ? "status-saving" : ""} ${cloudIssue ? `status-${cloudIssue}` : ""}`} aria-live="polite"><i />{saveStatus}</span>
          {cloudIssue === "failed" && <button type="button" onClick={retryCloudSave}>重试保存</button>}
          {cloudIssue === "conflict" && <button type="button" onClick={() => void loadLatestCloudProject()}>加载云端最新版</button>}
          <input ref={importInputRef} className="visually-hidden" type="file" accept="application/json,.json" aria-label="导入 JSON 项目备份" onChange={(event) => void importJson(event.target.files?.[0])} />
          <div className="backup-buttons"><button type="button" onClick={() => importInputRef.current?.click()}>导入 JSON</button><button type="button" onClick={exportJson} disabled={!activeProject}>导出 JSON</button></div>
        </div>
      </section>

      {session.status === "anonymous" && (
        <aside className="cloud-banner" aria-label="云端保存提示">
          <div><strong>登录后保存云端项目</strong><span>使用 ChatGPT 身份登录，即可跨设备恢复自己的私有故事板。</span></div>
          <a href={session.signInPath}>登录并启用云端</a>
        </aside>
      )}
      {session.status === "authenticated" && localMigrationProjects.length > 0 && (
        <aside className="cloud-banner migration-banner" aria-label="迁移本地项目">
          <div><strong>发现 {localMigrationProjects.length} 个本地项目</strong><span>只有你明确确认后才会复制到云端；本地草稿不会被删除。</span></div>
          <button type="button" onClick={() => void migrateLocalProjects()} disabled={isMigrating}>{isMigrating ? "迁移中…" : "迁移到云端"}</button>
        </aside>
      )}
      {session.status === "authenticated" && isHydrated && library?.projects.length === 0 && (
        <aside className="cloud-banner empty-cloud" aria-label="空云端项目库">
          <div><strong>你的云端项目库还是空的</strong><span>新建一个故事板，或迁移上方检测到的本地项目。</span></div>
          <button type="button" onClick={() => void createProject()}>新建云端项目</button>
        </aside>
      )}

      <section className={`hero ${workspaceReady ? "hero-project" : ""}`} id="top">
        {workspaceReady ? (
          <>
            <div className="project-hero-copy">
              <div className="eyebrow">CURRENT PROJECT · 当前创作</div>
              <h1>{storyboard?.title || activeProject?.name || "开始你的第一块故事板"}</h1>
              <p className="intro">{storyboard
                ? `${storyboard.shots.length} 个镜头已进入编辑台，当前停在镜头 ${activeShotIndex + 1}。`
                : "整理脚本、生成故事板，再进入镜头与提示词编辑。"}</p>
              <div className="project-facts" aria-label="当前项目状态">
                <span><i className="fact-dot" />{session.status === "authenticated" ? "云端项目" : "本地安全样例"}</span>
                <span>{script.length} 字脚本</span>
                <span>{storyboard ? `${staleGeneratedPromptCount + staleManualPromptCount} 条提示词待处理` : "等待生成"}</span>
              </div>
            </div>
            <div className="project-hero-action">
              <span className="hero-action-label">NEXT ACTION</span>
              <a className="continue-button" href={storyboard ? "#shot-editor" : "#script-editor"}>{storyboard ? `继续编辑镜头 ${String(activeShotIndex + 1).padStart(2, "0")}` : "继续编辑脚本"}<span aria-hidden="true">↘</span></a>
              <small>{storyboard ? "镜头状态、提示词与导出都在下方编辑台" : "建议先完善人物、对话和场景信息"}</small>
            </div>
          </>
        ) : (
          <>
            <div className="eyebrow">• AI 短剧故事板工作台</div>
            <h1>把脚本，变成<br /><em>可拍的每一帧</em></h1>
            <p className="intro">粘贴短剧脚本，拆解角色、场景和镜头，<br className="desktop-break" />登录后安全保存云端，在不同设备继续创作。</p>
          </>
        )}
      </section>

      <section className={`workspace ${storyboard ? "workspace-compact" : ""}`} id="script-editor" aria-labelledby="script-title">
        <div className="workspace-head">
          <div><span className="step-number">01</span><div><h2 id="script-title">脚本与生成</h2><p>{storyboard ? "脚本已生成故事板；仍可展开修改或重新生成" : "建议 300–1500 字，包含人物、对话和场景信息"}</p></div></div>
          <div className="workspace-head-actions">
            {storyboard && <a href="#shot-editor">前往镜头编辑 <span aria-hidden="true">→</span></a>}
            <button className="sample-button" type="button" onClick={loadSample}><span aria-hidden="true">◇</span> 使用示例脚本</button>
          </div>
        </div>
        {storyboard ? <details className="script-disclosure"><summary><span>查看与编辑当前脚本</span><small>{script.length} 字 · 展开后可重新生成</small></summary>{scriptEditor}</details> : scriptEditor}
      </section>

      {storyboard && (
        <section className="results" id="storyboard" aria-labelledby="result-title">
          <div className="result-heading">
            <div className="result-title-block">
              <span className="result-kicker">02 · AI 生成结果 / STORYBOARD DESK</span>
              <input id="result-title" className="storyboard-title-input" aria-label="故事板标题" value={storyboard.title} onChange={(event) => updateStoryboard((current) => ({ ...current, title: event.target.value }))} />
              <p>资产设定、镜头调度与可交付提示词，在同一条创作节奏中完成。</p>
            </div>
            <div className="result-actions">
              <span className="result-count"><b>{storyboard.shots.length}</b> 镜头 <i /> {storyboard.characters.length} 角色 <i /> {storyboard.scenes.length} 场景</span>
              <button className="secondary-action" type="button" onClick={() => void copyAllVideoPrompts()}>复制整套提示词</button>
              <button className="secondary-action" type="button" onClick={rebuildPrompts} disabled={staleGeneratedPromptCount === 0 && staleManualPromptCount === 0}>
                {staleGeneratedPromptCount > 0 ? `重建 ${staleGeneratedPromptCount} 条待更新提示词` : "按当前资产重建提示词"}
              </button>
              <button className="export-button" type="button" onClick={exportMarkdown}>{hasExported ? "已导出 Markdown ✓" : "导出 Markdown ↓"}</button>
            </div>
          </div>
          <div className="prompt-summary" aria-live="polite">
            <div className="prompt-summary-status"><i /><div><small>PROMPT STATUS</small><strong>{staleGeneratedPromptCount + staleManualPromptCount === 0 ? "提示词已全部同步" : `${staleGeneratedPromptCount + staleManualPromptCount} 条提示词需要处理`}</strong></div></div>
            <span>{staleGeneratedPromptCount > 0 ? `${staleGeneratedPromptCount} 条可批量重建` : "没有待批量重建项"}{staleManualPromptCount > 0 ? ` · ${staleManualPromptCount} 条手动提示词受保护，需逐条确认` : " · 手动提示词不会被静默覆盖"}</span>
          </div>

          <div className="asset-overview-grid">
            <div className="asset-section cast-section">
              <div className="section-label"><span>CAST</span><h3>角色设定</h3><p>角色一致性会影响全部镜头</p></div>
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
            <div className="asset-section scene-section">
              <div className="section-label"><span>SCENE</span><h3>场景设定</h3><p>空间变化只影响关联镜头</p></div>
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
          </div>

          <div className="asset-section storyboard-section">
            <div className="section-label shot-section-label"><span>SHOTS</span><h3>6 镜头故事板</h3><p>选择镜头 → 调整画面 → 确认提示词 → 导出</p></div>
            <div className="shot-navigator" aria-label="镜头导航">
              <div className="shot-tabs" role="group" aria-label="选择镜头">
                {storyboard.shots.map((shot, index) => {
                  const state = promptState(shot);
                  return <button key={shot.id} type="button" aria-pressed={index === activeShotIndex} className={index === activeShotIndex ? "active" : ""} onClick={() => focusShot(index)}>
                    <span><i className={state.className} />{String(index + 1).padStart(2, "0")}</span><small>{shot.framing}</small><em>{shot.videoPromptNeedsRebuild ? "待处理" : "已同步"}</em>
                  </button>;
                })}
              </div>
              <div className="shot-step-actions">
                <button type="button" onClick={() => focusShot(activeShotIndex - 1)} disabled={activeShotIndex === 0}>← 上一个</button>
                <span>当前镜头 {activeShotIndex + 1} / {storyboard.shots.length}</span>
                <button type="button" onClick={() => focusShot(activeShotIndex + 1)} disabled={activeShotIndex === storyboard.shots.length - 1}>下一个 →</button>
              </div>
            </div>
            <div className="shot-grid focused-shot-grid" id="shot-editor">
              {storyboard.shots.filter((_, index) => index === activeShotIndex).map((shot) => {
                const index = activeShotIndex;
                const scene = storyboard.scenes.find((candidate) => candidate.id === shot.sceneId);
                const state = promptState(shot);
                return (
                <article className="shot-card active-shot" key={shot.id} aria-label={`镜头 ${index + 1} 编辑器`}>
                  <div className={`shot-preview preview-${(index % 6) + 1}`}>
                    <div className="shot-toolbar">
                      <span>SHOT {String(index + 1).padStart(2, "0")}</span>
                      <div><button type="button" aria-label={`镜头 ${index + 1} 上移`} disabled={index === 0} onClick={() => moveShot(index, -1)}>↑</button><button type="button" aria-label={`镜头 ${index + 1} 下移`} disabled={index === storyboard.shots.length - 1} onClick={() => moveShot(index, 1)}>↓</button></div>
                    </div>
                    <div className="preview-caption"><span>{scene?.name ?? shot.sceneId} · {shot.framing}</span><p>{shot.visual}</p></div>
                  </div>
                  <div className="shot-fields">
                    <div className="shot-fields-heading"><div><small>ACTIVE SHOT</small><strong>镜头 {String(index + 1).padStart(2, "0")}</strong></div><em className={`prompt-state ${state.className}`}>{state.label}</em></div>
                    <label><span>场景</span><select aria-label={`镜头 ${index + 1} 场景`} value={shot.sceneId} onChange={(event) => updateShot(shot.id, "sceneId", event.target.value)}>{storyboard.scenes.map((sceneOption) => <option key={sceneOption.id} value={sceneOption.id}>{sceneOption.name}</option>)}</select></label>
                    <label><span>景别</span><select aria-label={`镜头 ${index + 1} 景别`} value={shot.framing} onChange={(event) => updateShot(shot.id, "framing", event.target.value as Shot["framing"])}>{FRAMING_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
                    <label><span>动作</span><textarea aria-label={`镜头 ${index + 1} 动作`} value={shot.action} onChange={(event) => updateShot(shot.id, "action", event.target.value)} /></label>
                    <label><span>情绪</span><input aria-label={`镜头 ${index + 1} 情绪`} value={shot.emotion} onChange={(event) => updateShot(shot.id, "emotion", event.target.value)} /></label>
                    <label><span>视觉</span><textarea aria-label={`镜头 ${index + 1} 视觉`} value={shot.visual} onChange={(event) => updateShot(shot.id, "visual", event.target.value)} /></label>
                    <label className="video-prompt-field">
                      <span><span>图生视频提示词</span><span className="prompt-buttons"><button type="button" onClick={() => rebuildSinglePrompt(shot, index + 1)}>重建此条</button><button type="button" onClick={() => void copyVideoPrompt(shot.videoPrompt, index + 1)}>复制</button></span></span>
                      <small className="prompt-context">关联场景：{scene?.name ?? shot.sceneId} · 角色设定：{storyboard.characters.map((character) => character.name).join("、")}</small>
                      <textarea aria-label={`镜头 ${index + 1} 图生视频提示词`} value={shot.videoPrompt} onChange={(event) => updateShot(shot.id, "videoPrompt", event.target.value)} />
                    </label>
                  </div>
                </article>
              );})}
            </div>
          </div>
        </section>
      )}

      <footer><span>从文字到画面，先让故事站稳。</span><span>云端项目 · 私有工作台</span></footer>
    </main>
  );
}
