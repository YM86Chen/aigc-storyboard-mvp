export const FRAMING_OPTIONS = ["远景", "全景", "中景", "近景", "特写", "大特写"] as const;

export type ShotFraming = (typeof FRAMING_OPTIONS)[number];

export interface Character {
  id: string;
  name: string;
  role: string;
  description: string;
  avatarLabel: string;
  avatarTone: "orange" | "dark";
}

export interface Scene {
  id: string;
  name: string;
  description: string;
}

export interface Shot {
  id: number;
  sceneId: string;
  framing: ShotFraming;
  action: string;
  emotion: string;
  visual: string;
}

export interface Storyboard {
  title: string;
  sourceScript: string;
  characters: Character[];
  scenes: Scene[];
  shots: Shot[];
}

export type GeneratedStoryboard = Omit<Storyboard, "sourceScript">;

export type StoryboardValidationResult =
  | { ok: true; value: GeneratedStoryboard }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCharacter(value: unknown): value is Character {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.role)
    && isNonEmptyString(value.description)
    && isNonEmptyString(value.avatarLabel)
    && (value.avatarTone === "orange" || value.avatarTone === "dark");
}

function isScene(value: unknown): value is Scene {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.description);
}

function hasUniqueIds(items: Array<{ id: string | number }>) {
  return new Set(items.map((item) => item.id)).size === items.length;
}

export function validateGeneratedStoryboard(value: unknown): StoryboardValidationResult {
  if (!isRecord(value) || !isNonEmptyString(value.title)) {
    return { ok: false, error: "模型返回的标题为空，请重试。" };
  }

  const { characters, scenes, shots } = value;
  if (!Array.isArray(characters) || characters.length === 0) {
    return { ok: false, error: "模型未返回角色信息，请重试。" };
  }
  if (!characters.every(isCharacter)) {
    const index = characters.findIndex((character) => !isCharacter(character));
    return { ok: false, error: `模型返回的第 ${index + 1} 个角色字段不完整，请重试。` };
  }
  const validCharacters = characters as Character[];
  if (!hasUniqueIds(validCharacters)) {
    return { ok: false, error: "模型返回的角色 ID 存在重复，请重试。" };
  }

  if (!Array.isArray(scenes) || scenes.length === 0) {
    return { ok: false, error: "模型未返回场景信息，请重试。" };
  }
  if (!scenes.every(isScene)) {
    const index = scenes.findIndex((scene) => !isScene(scene));
    return { ok: false, error: `模型返回的第 ${index + 1} 个场景字段不完整，请重试。` };
  }
  const validScenes = scenes as Scene[];
  if (!hasUniqueIds(validScenes)) {
    return { ok: false, error: "模型返回的场景 ID 存在重复，请重试。" };
  }

  if (!Array.isArray(shots) || shots.length !== 6) {
    return { ok: false, error: "模型必须返回恰好 6 个镜头，请重试。" };
  }

  const sceneIds = new Set(validScenes.map((scene) => scene.id));
  for (const [index, shot] of shots.entries()) {
    const shotNumber = index + 1;
    if (!isRecord(shot)
      || typeof shot.id !== "number"
      || !Number.isInteger(shot.id)
      || !isNonEmptyString(shot.sceneId)
      || !isNonEmptyString(shot.action)
      || !isNonEmptyString(shot.emotion)
      || !isNonEmptyString(shot.visual)) {
      return { ok: false, error: `模型返回的第 ${shotNumber} 个镜头字段不完整，请重试。` };
    }
    if (typeof shot.framing !== "string" || !FRAMING_OPTIONS.includes(shot.framing as ShotFraming)) {
      return { ok: false, error: `模型返回的第 ${shotNumber} 个镜头景别无效，请重试。` };
    }
    if (!sceneIds.has(shot.sceneId)) {
      return { ok: false, error: `模型返回的第 ${shotNumber} 个镜头引用了不存在的场景，请重试。` };
    }
  }

  const validShots = shots as Shot[];
  if (!hasUniqueIds(validShots)) {
    return { ok: false, error: "模型返回的镜头 ID 存在重复，请重试。" };
  }

  return {
    ok: true,
    value: {
      title: value.title,
      characters: validCharacters,
      scenes: validScenes,
      shots: validShots,
    },
  };
}

export function isStoryboard(value: unknown): value is Storyboard {
  return isRecord(value)
    && isNonEmptyString(value.sourceScript)
    && validateGeneratedStoryboard(value).ok;
}

export const SAMPLE_SCRIPT = `《最后一班地铁》

深夜，林夏独自坐在空荡的末班地铁里。车窗外一片漆黑，手机忽然收到一条陌生短信：“不要在下一站下车。”

广播响起：“终点站，到了。”林夏抬头，却发现对面不知何时坐着一个穿旧式制服的女孩。

女孩看着她，轻声说：“你终于回来了。”

车门缓缓打开，站台上站满了沉默的人影。林夏握紧手机，屏幕上又出现一行字：“现在，假装你认识她。”`;

const MOCK_STORYBOARD: Omit<Storyboard, "title" | "sourceScript"> = {
  characters: [
    {
      id: "lin-xia",
      name: "林夏",
      role: "主角",
      description: "25 岁，短发，浅灰风衣；普通上班族，被意外卷入末班地铁的秘密。",
      avatarLabel: "林",
      avatarTone: "orange",
    },
    {
      id: "uniform-girl",
      name: "制服女孩",
      role: "神秘人",
      description: "约 18 岁，旧式深蓝制服，脸色苍白；似乎早已认识林夏。",
      avatarLabel: "影",
      avatarTone: "dark",
    },
  ],
  scenes: [
    { id: "s01", name: "末班地铁车厢", description: "深夜 · 内景 · 冷白荧光灯 · 空旷压抑 · 现代都市悬疑" },
    { id: "s02", name: "废弃终点站台", description: "深夜 · 外景感 · 暗绿色顶灯 · 潮湿雾气 · 密集沉默人影" },
  ],
  shots: [
    { id: 1, sceneId: "s01", framing: "远景", action: "林夏独自坐在空荡的末班地铁里", emotion: "孤独、警觉", visual: "深夜车厢，冷白灯闪烁，窗外漆黑" },
    { id: 2, sceneId: "s01", framing: "特写", action: "手机屏幕亮起，收到陌生短信", emotion: "意外、紧张", visual: "手指握紧手机，短信写着不要下车" },
    { id: 3, sceneId: "s01", framing: "中景", action: "林夏抬头，看见对面的制服女孩", emotion: "错愕、戒备", visual: "两人隔着过道对坐，空间压迫而安静" },
    { id: 4, sceneId: "s01", framing: "近景", action: "女孩注视林夏，轻声开口", emotion: "平静、诡异", visual: "旧式制服女孩半张脸藏在阴影中" },
    { id: 5, sceneId: "s02", framing: "全景", action: "车门打开，站台人影同时望来", emotion: "恐惧、窒息", visual: "昏暗站台挤满沉默人影，车门形成画框" },
    { id: 6, sceneId: "s02", framing: "大特写", action: "林夏再次看向手机，强装镇定", emotion: "惊恐、克制", visual: "眼睛与手机屏幕交叠，屏幕提示假装认识她" },
  ],
};

function titleFromScript(script: string) {
  return script
    .split("\n")
    .find((line) => line.trim())
    ?.replace(/[《》#]/g, "")
    .trim() || "短剧故事板";
}

export function createMockStoryboard(sourceScript: string): Storyboard {
  return {
    title: titleFromScript(sourceScript),
    sourceScript,
    characters: MOCK_STORYBOARD.characters.map((character) => ({ ...character })),
    scenes: MOCK_STORYBOARD.scenes.map((scene) => ({ ...scene })),
    shots: MOCK_STORYBOARD.shots.map((shot) => ({ ...shot })),
  };
}
