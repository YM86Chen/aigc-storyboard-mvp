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
