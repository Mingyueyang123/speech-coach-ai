import type { TrainingLanguage } from "./types";

export interface HumorMethod {
  id: string;
  title: Record<TrainingLanguage, string>;
  summary: Record<TrainingLanguage, string>;
  exercise: Record<TrainingLanguage, string>;
}

export const HUMOR_METHODS: HumorMethod[] = [
  {
    id: "write-verbatim",
    title: { "zh-CN": "先写逐字稿", "en-US": "Write it word for word" },
    summary: { "zh-CN": "把灵感变成可检查、可删改、可重复练习的文本。", "en-US": "Turn inspiration into text that can be tested, cut, and rehearsed." },
    exercise: { "zh-CN": "写完 60 秒逐字稿，再删掉 20% 不影响意思的字。", "en-US": "Write a 60-second script, then remove 20% without losing meaning." },
  },
  {
    id: "truthful-observation",
    title: { "zh-CN": "从真实观察出发", "en-US": "Start from a true observation" },
    summary: { "zh-CN": "先找到你真实经历中的别扭、反差或情绪，再寻找笑点。", "en-US": "Find the tension, contrast, or emotion in lived experience before looking for a joke." },
    exercise: { "zh-CN": "记录今天三个让你停顿一下的细节，各写一个意外类比。", "en-US": "Record three details that made you pause today and write one unexpected comparison for each." },
  },
  {
    id: "story-values",
    title: { "zh-CN": "用故事传递观点", "en-US": "Let the story carry the point" },
    summary: { "zh-CN": "让观众从具体人物和选择中感到你的价值观，而不是直接接受说教。", "en-US": "Use people and choices to reveal your point instead of explaining it abstractly." },
    exercise: { "zh-CN": "把一个观点改写成 30 秒故事，保留人物、阻力、选择和变化。", "en-US": "Turn one claim into a 30-second story with a person, obstacle, choice, and change." },
  },
  {
    id: "rhythm-read-aloud",
    title: { "zh-CN": "朗读打磨节奏", "en-US": "Find rhythm by reading aloud" },
    summary: { "zh-CN": "节奏来自信息、停顿和情绪变化，不只是说得快。", "en-US": "Rhythm comes from information, pauses, and emotional turns, not just speed." },
    exercise: { "zh-CN": "朗读两遍，标记需要停顿、强调和等待观众反应的位置。", "en-US": "Read twice and mark pauses, emphasis, and moments to wait for the room." },
  },
  {
    id: "public-iteration",
    title: { "zh-CN": "在反馈中成长", "en-US": "Grow in public" },
    summary: { "zh-CN": "把现场反应当作可观察数据，记录哪一句有效、哪一句需要重写。", "en-US": "Treat audience response as observable data and record what landed or needs rewriting." },
    exercise: { "zh-CN": "试讲后只改一个变量：措辞、顺序或停顿，然后再讲一次。", "en-US": "After a run, change one variable only: wording, order, or pause, then try again." },
  },
];

export const HUMOR_SOURCES = [
  { label: "豆瓣阅读正版电子书", url: "https://read.douban.com/ebook/639784441/" },
  { label: "豆瓣公开书评", url: "https://book.douban.com/review/13867613/" },
];
