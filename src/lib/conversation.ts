import type { HumorMaterial, ScenarioKind, TrainingLanguage, UserProfile } from "./types";

export interface GoalConversationDraft {
  title: string;
  scenarioKind: ScenarioKind;
  targetDate: string;
  audience: string;
  desiredOutcome: string;
  durationSeconds: number;
  language: TrainingLanguage;
  humorLevel: "none" | "light" | "medium";
  successCriteria: string[];
  actionSteps: string[];
}

export function cleanSpokenText(message: string, language: TrainingLanguage): string {
  let clean = message.trim().replace(/\s+/g, " ");
  if (language === "en-US") {
    clean = clean
      .replace(/^(?:(?:um+|uh+|well|you know|i mean|so)\s*[,.-]?\s*)+/i, "")
      .replace(/\b(?:um+|uh+|you know|i mean)\b\s*[,.-]?\s*/gi, "")
      .replace(/\b(\w{2,})\s+\1\b/gi, "$1")
      .replace(/\s+([,.!?;:])/g, "$1")
      .replace(/([,.!?;:])\1+/g, "$1");
    return clean.trim();
  }

  clean = clean
    .replace(/^(?:(?:嗯+|呃+|额+|啊+|那个|这个|就是说|就是|然后|我想说的是|我的意思是)\s*[，,。.]?\s*)+/, "")
    .replace(/我的(?:这个)?灵感素材(?:是|就是)\s*/g, "")
    .replace(/([，。！？；]|^)(?:嗯+|呃+|额+|就是说|就是|那个|这个)(?=[，。！？；\s])/g, "$1")
    .replace(/([，。！？；])(?:就是说|就是)(?=(?:发现|觉得|认为|想|希望|需要|准备|打算|可能))/g, "$1")
    .replace(/，\s*(?:然后|并且)\s*[，,]?/g, "，")
    .replace(/在生成这个\s*/g, "在开发 ")
    .replace(/的时候/g, "时")
    .replace(/没有对标的这种(?:特别牛逼的)?/g, "缺少真正优秀的")
    .replace(/特别牛逼的/g, "真正优秀的")
    .replace(/并且是适用于\s*[，,]?\s*(?:就是)?服务于/g, "服务于")
    .replace(/我个人的场景/g, "个人场景")
    .replace(/场景化的\s*[，,]\s*个人个性化的去做/g, "进行场景化、个性化")
    .replace(/(想|要|说|讲|做)\1(?=[\u4e00-\u9fff])/g, "$1")
    .replace(/([\u4e00-\u9fff]{2,8})\1/g, "$1")
    .replace(/[，,]{2,}/g, "，")
    .replace(/\s+([，。！？；])/g, "$1")
    .replace(/^[，。！？；\s]+|[，；\s]+$/g, "")
    .trim();
  if (clean && !/[。！？.!?]$/.test(clean)) clean += "。";
  return clean;
}

function dateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(days: number, now: Date): string {
  const next = new Date(now);
  next.setDate(next.getDate() + days);
  return dateString(next);
}

export function inferTargetDate(message: string, now = new Date()): string {
  const iso = message.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (iso) return dateString(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  if (/明天/.test(message)) return addDays(1, now);
  if (/后天/.test(message)) return addDays(2, now);

  const monthWeek = message.match(/(\d{1,2})\s*月(?:的)?第\s*(\d{1,2})\s*周/);
  if (monthWeek) {
    const month = Number(monthWeek[1]) - 1;
    const week = Math.max(1, Math.min(5, Number(monthWeek[2])));
    let year = now.getFullYear();
    const first = new Date(year, month, 1);
    const firstMonday = new Date(year, month, 1 + ((8 - first.getDay()) % 7));
    const candidate = new Date(year, month, firstMonday.getDate() + ((week - 1) * 7) + 4);
    if (candidate < now) {
      year += 1;
      const nextFirst = new Date(year, month, 1);
      const nextMonday = new Date(year, month, 1 + ((8 - nextFirst.getDay()) % 7));
      return dateString(new Date(year, month, nextMonday.getDate() + ((week - 1) * 7) + 4));
    }
    return dateString(candidate);
  }

  const nextMonthDay = message.match(/下个月\s*(\d{1,2})\s*[号日]?/);
  if (nextMonthDay) return dateString(new Date(now.getFullYear(), now.getMonth() + 1, Number(nextMonthDay[1])));

  const monthDay = message.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]?/);
  if (monthDay) {
    const candidate = new Date(now.getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2]));
    if (candidate < now) candidate.setFullYear(candidate.getFullYear() + 1);
    return dateString(candidate);
  }
  return addDays(21, now);
}

function inferLanguage(message: string, profile?: Pick<UserProfile, "languages">): TrainingLanguage {
  if (/英文|英语|english|in english/i.test(message)) return "en-US";
  if (/中文|普通话|chinese/i.test(message)) return "zh-CN";
  return profile?.languages[0] ?? "zh-CN";
}

function inferScenario(message: string): ScenarioKind {
  if (/投资|融资|路演给.*投资|demo day|pitch|股东/i.test(message)) return "investor-pitch";
  if (/客户|采购|方案|销售|roi|招标/i.test(message)) return "client-roadshow";
  return "live-speaking";
}

function inferAudience(message: string, scenario: ScenarioKind): string {
  const explicit = message.match(/(?:面对|面向|讲给|说服|向)([^，。,.；;]{2,28})/);
  if (explicit) return explicit[1].replace(/(?:做|进行|讲|介绍).*$/, "").trim();
  if (scenario === "investor-pitch") return "早期投资人";
  if (scenario === "client-roadshow") return "企业客户决策者";
  return "线下活动观众";
}

function inferDuration(message: string, scenario: ScenarioKind): number {
  const match = message.match(/(\d{1,3})\s*(分钟|min(?:ute)?s?)/i);
  if (match) return Math.max(30, Math.min(3600, Number(match[1]) * 60));
  return scenario === "client-roadshow" ? 300 : scenario === "investor-pitch" ? 180 : 240;
}

function buildActionSteps(scenario: ScenarioKind, targetDate: string, language: TrainingLanguage): string[] {
  if (language === "en-US") {
    const core = scenario === "investor-pitch"
      ? ["Define the one-sentence positioning and investor takeaway", "Prepare evidence for market, traction, moat, and use of funds"]
      : scenario === "client-roadshow"
        ? ["Clarify the customer's problem, business value, and desired next step", "Prepare proof for ROI, delivery, security, and likely objections"]
        : ["Define the core message and the audience response you want", "Build the opening, story, interaction, transition, and close"];
    return [...core, "Draft the full script and reduce it to cue words", `Complete three recorded practice rounds by ${targetDate}`];
  }
  const core = scenario === "investor-pitch"
    ? ["明确一句话定位和希望投资人记住的核心判断", "准备市场、增长、壁垒和融资用途的可信证据"]
    : scenario === "client-roadshow"
      ? ["明确客户问题、业务价值和希望推进的下一步", "准备 ROI、交付、安全与常见异议的证据"]
      : ["明确这次表达的核心观点和希望观众产生的反应", "搭好开场、故事、互动、转场和收尾结构"];
  return [...core, "完成逐字稿，并压缩成关键词提纲", `在 ${targetDate} 前完成三轮录制练习`];
}

export function inferGoalDraft(
  message: string,
  profile?: Pick<UserProfile, "languages">,
  now = new Date(),
): GoalConversationDraft {
  const detectedLanguage = inferLanguage(message.trim(), profile);
  const clean = cleanSpokenText(message, detectedLanguage);
  const scenarioKind = inferScenario(clean);
  const language = detectedLanguage;
  const desired = clean.match(/(?:希望|目标是|想让|需要让|期望)(.+?)(?:[。.!！]|$)/)?.[1]?.trim()
    || (language === "en-US" ? "Deliver the message clearly and achieve the intended next step" : "清晰完成表达，并推动预期的下一步");
  const scenarioTitle = scenarioKind === "investor-pitch" ? "投资人 Pitch" : scenarioKind === "client-roadshow" ? "客户路演" : "线下演讲 / 主持";
  const conciseOutcome = desired.replace(/^(?:让|他们|客户|观众)/, "").replace(/[。.!！]$/, "").slice(0, 24);
  const titleStem = language === "en-US"
    ? `${scenarioKind === "investor-pitch" ? "Investor pitch" : scenarioKind === "client-roadshow" ? "Client presentation" : "Live speaking"}: ${conciseOutcome}`
    : `${scenarioTitle}${conciseOutcome && conciseOutcome !== "清晰完成表达，并推动预期的下一步" ? `：${conciseOutcome}` : "训练"}`;
  const targetDate = inferTargetDate(clean, now);
  const successCriteria = scenarioKind === "investor-pitch"
    ? ["定位清晰", "证据可信", "融资逻辑完整"]
    : scenarioKind === "client-roadshow"
      ? ["客户价值明确", "交付路径可信", "下一步清楚"]
      : ["开场抓住注意", "结构清晰", "互动与收尾自然"];
  return {
    title: titleStem || (language === "en-US" ? "New speech goal" : "新的表达目标"),
    scenarioKind,
    targetDate,
    audience: inferAudience(clean, scenarioKind),
    desiredOutcome: desired,
    durationSeconds: inferDuration(clean, scenarioKind),
    language,
    humorLevel: scenarioKind === "live-speaking" ? "light" : "none",
    successCriteria,
    actionSteps: buildActionSteps(scenarioKind, targetDate, language),
  };
}

export function inferMaterial(
  message: string,
  language: TrainingLanguage,
): Omit<HumorMaterial, "id" | "createdAt" | "updatedAt"> {
  const sourceText = message.trim().replace(/\s+/g, " ");
  const clean = cleanSpokenText(sourceText, language);
  const type: HumorMaterial["type"] = /像|好比|仿佛|like|as if/i.test(clean)
    ? "analogy"
    : /但是|反而|没想到|却|but|unexpected/i.test(clean)
      ? "contrast"
      : /小时候|有一次|那天|曾经|once|story/i.test(clean)
        ? "story"
        : "observation";
  const scenarioKinds: ScenarioKind[] = /客户|采购|roi/i.test(clean)
    ? ["client-roadshow"]
    : /投资|融资|pitch/i.test(clean)
      ? ["investor-pitch"]
      : ["live-speaking"];
  const firstClause = clean.split(/[，。,.；;!！?？]/)[0]
    .replace(/^(?:今天|刚才|有一次|我发现|I found that|Today)\s*/i, "")
    .trim();
  const coreIdea = clean.split(/[。.!！]/)[0].slice(0, language === "en-US" ? 180 : 90);
  const tags = [
    /AI|人工智能/i.test(clean) ? "AI" : "",
    /演讲|表达|speech|speaking/i.test(clean) ? (language === "en-US" ? "speaking" : "表达") : "",
    /口语|陪练|coach/i.test(clean) ? (language === "en-US" ? "coaching" : "口语陪练") : "",
  ].filter(Boolean);
  return {
    type,
    title: firstClause.slice(0, 24) || (language === "en-US" ? "New idea" : "新的灵感"),
    content: clean,
    sourceText,
    coreIdea,
    language,
    scenarioKinds,
    audienceBoundary: language === "en-US" ? "Avoid private details and attacks on individuals or protected groups." : "不涉及个人隐私，不攻击具体个人或受保护群体",
    sensitiveTopics: [],
    tags,
  };
}
