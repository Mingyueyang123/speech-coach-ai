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

export function inferGoalDraft(
  message: string,
  profile?: Pick<UserProfile, "languages">,
  now = new Date(),
): GoalConversationDraft {
  const clean = message.trim().replace(/\s+/g, " ");
  const scenarioKind = inferScenario(clean);
  const language = inferLanguage(clean, profile);
  const desired = clean.match(/(?:希望|目标是|想让|需要让)(.+?)(?:[。.!！]|$)/)?.[1]?.trim() || clean;
  const titleStem = clean.split(/[，。,.；;!！?？]/)[0].slice(0, 28);
  const successCriteria = scenarioKind === "investor-pitch"
    ? ["定位清晰", "证据可信", "融资逻辑完整"]
    : scenarioKind === "client-roadshow"
      ? ["客户价值明确", "交付路径可信", "下一步清楚"]
      : ["开场抓住注意", "结构清晰", "互动与收尾自然"];
  return {
    title: titleStem || (language === "en-US" ? "New speech goal" : "新的表达目标"),
    scenarioKind,
    targetDate: inferTargetDate(clean, now),
    audience: inferAudience(clean, scenarioKind),
    desiredOutcome: desired,
    durationSeconds: inferDuration(clean, scenarioKind),
    language,
    humorLevel: scenarioKind === "live-speaking" ? "light" : "none",
    successCriteria,
  };
}

export function inferMaterial(
  message: string,
  language: TrainingLanguage,
): Omit<HumorMaterial, "id" | "createdAt" | "updatedAt"> {
  const clean = message.trim().replace(/\s+/g, " ");
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
  const firstClause = clean.split(/[，。,.；;!！?？]/)[0];
  return {
    type,
    title: firstClause.slice(0, 24) || (language === "en-US" ? "New idea" : "新的灵感"),
    content: clean,
    language,
    scenarioKinds,
    audienceBoundary: language === "en-US" ? "Avoid private details and attacks on individuals or protected groups." : "不涉及个人隐私，不攻击具体个人或受保护群体",
    sensitiveTopics: [],
    tags: [],
  };
}
