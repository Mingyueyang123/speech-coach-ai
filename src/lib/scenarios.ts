import type { PracticeScenario } from "./types";

export const SCENARIOS: PracticeScenario[] = [
  {
    id: "investor-seed-pitch",
    kind: "investor-pitch",
    title: "投资人 Pitch",
    description: "用有限时间讲清市场、产品、壁垒和融资逻辑。",
    goal: "让投资人在三分钟内理解你解决什么问题、为什么现在做、凭什么是你。",
    durationSeconds: 180,
    audiencePersona: "一位理性、时间紧张的早期投资人，会追问市场规模、竞争壁垒、商业模式和数据证据。",
    script: "各位好，我想介绍的是一款帮助专业人士把知识转化为可重复工作流的 AI 产品。\n\n我们观察到，很多团队已经购买了模型能力，但真正阻碍落地的不是模型本身，而是知识分散、流程不稳定，以及结果无法验证。\n\n我们的产品把企业资料、专家经验和业务动作连接起来，让每次任务都有来源、有过程、可复盘。今天我会用三分钟讲清楚市场机会、产品进展、商业模式，以及为什么我们有机会建立长期壁垒。",
    outline: ["一句话定位", "用户痛点与市场时机", "产品如何解决", "证据与进展", "商业模式与融资用途"],
    prompts: ["你和通用大模型相比，真正的壁垒是什么？", "谁会为这个产品付钱，预算来自哪里？", "如果大厂复制，你如何应对？"],
    rubric: ["定位清晰", "有证据而非口号", "商业逻辑完整", "能处理尖锐追问"],
    knowledgeDocumentIds: [],
  },
  {
    id: "client-solution-roadshow",
    kind: "client-roadshow",
    title: "客户方案路演",
    description: "面向企业决策者说明业务收益、落地路径和风险控制。",
    goal: "让客户相信方案能解决真实问题，并清楚下一步如何启动试点。",
    durationSeconds: 300,
    audiencePersona: "一位谨慎的业务负责人，关心 ROI、交付周期、系统集成、数据安全和内部推动成本。",
    script: "今天我不从技术参数开始，而是先从贵司团队每天正在重复发生的一件事讲起：信息散落在文档、会议和个人经验里，真正做决策时仍然需要大量人工重新整理。\n\n我们的方案不会替换现有系统，而是在现有流程上增加一个可控的 AI 协作层。第一阶段从一个高频、可衡量的场景试点，用四周验证节省时间、结果准确率和人员采用率，再决定是否扩展。",
    outline: ["客户现状", "业务损失", "解决方案", "四周试点", "ROI 与风险控制", "明确下一步"],
    prompts: ["四周真的能看到结果吗？", "我们的数据会不会被模型用于训练？", "员工不愿意改变流程怎么办？"],
    rubric: ["以客户语言表达", "价值可量化", "交付路径可信", "风险回答具体"],
    knowledgeDocumentIds: [],
  },
  {
    id: "live-keynote-opening",
    kind: "live-speaking",
    title: "线下活动演讲",
    description: "练习开场、观点展开、观众互动、转场与收束。",
    goal: "在一分钟内建立共同问题，并用清晰节奏让现场愿意继续听。",
    durationSeconds: 240,
    audiencePersona: "一群背景混合的线下观众；有人熟悉主题，也有人只是好奇，需要例子、互动和明确的结构。",
    script: "大家好。开始之前，我想先问一个问题：过去一个月，你有没有把一件原本需要半天的工作交给 AI，然后在十分钟内完成？\n\n如果有，你可能也遇到了第二个问题：速度变快以后，我们真正应该保留在人手里的是什么？\n\n今天我想和大家讨论的，不是 AI 能做多少，而是我们怎样把工具变成自己的独特优势。接下来我会用一个真实案例、三个判断和一次现场互动，把这件事讲清楚。",
    outline: ["用问题开场", "建立共同处境", "给出核心观点", "预告结构", "邀请观众参与"],
    prompts: ["现场反应冷淡，请换一种互动方式。", "你的例子离普通观众太远了。", "请用一句话总结今天的核心观点。"],
    rubric: ["开场有张力", "转场自然", "语言口语化", "行动指令明确"],
    knowledgeDocumentIds: [],
  },
];

export function getScenario(id: string): PracticeScenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
}
