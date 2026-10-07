import type { DeliveryMetrics, MetricPoint, PracticeScenario, ReviewReport, TrainingLanguage } from "./types";

const FILLERS = {
  "zh-CN": /然后|就是|其实|那个|呃|嗯|啊/gi,
  "en-US": /\b(?:um+|uh+|like|you know|basically|actually|so)\b/gi,
};

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]): number {
  if (!values.length) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

export function calculateDeliveryMetrics(
  transcript: string,
  durationMs: number,
  points: MetricPoint[],
  language: TrainingLanguage = "zh-CN",
): DeliveryMetrics {
  const unitCount = language === "en-US"
    ? transcript.trim().split(/\s+/).filter(Boolean).length
    : Array.from(transcript.replace(/\s+/g, "")).length;
  const minutes = Math.max(durationMs / 60000, 1 / 60);
  const volumes = points.map((point) => point.volume);

  return {
    wordsPerMinute: Math.round(unitCount / minutes),
    fillerCount: (transcript.match(FILLERS[language]) ?? []).length,
    pauseCount: Math.max(0, Math.round(durationMs / 10000) - Math.ceil(unitCount / (language === "en-US" ? 25 : 80))),
    averageVolume: Math.round(average(volumes) * 100),
    volumeVariation: Math.round(standardDeviation(volumes) * 100),
    cameraFacingRatio: Math.round(average(points.map((point) => point.cameraFacing)) * 100),
    expressionRange: Math.round(average(points.map((point) => point.expression)) * 100),
    smileRatio: Math.round(average(points.map((point) => point.smile)) * 100),
    handsVisibleRatio: Math.round(average(points.map((point) => point.handsVisible)) * 100),
    gestureRate: Math.round(average(points.map((point) => point.gestureMovement)) * 100),
    bodySway: Math.round(average(points.map((point) => point.bodySway)) * 100),
  };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildLocalReview(
  transcript: string,
  metrics: DeliveryMetrics,
  scenario: PracticeScenario,
): ReviewReport {
  const covered = scenario.cues.filter((item) => transcript.toLocaleLowerCase(scenario.language).includes(item.slice(0, 4).toLocaleLowerCase(scenario.language))).length;
  const questionCount = (transcript.match(/[?？]/g) ?? []).length;
  const content = clampScore(45 + covered * 9 + Math.min(20, transcript.length / 30));
  const structure = clampScore(50 + covered * 10);
  const delivery = clampScore(
    75 - metrics.fillerCount * 4 - Math.max(0, metrics.wordsPerMinute - 260) / 4 + metrics.volumeVariation / 3,
  );
  const interaction = clampScore(45 + questionCount * 14 + (/请|please/i.test(transcript) ? 12 : 0));
  const hasVisual = metrics.visualAvailable !== false;
  const visualPresence = hasVisual ? clampScore(
    metrics.cameraFacingRatio * 0.55 + metrics.handsVisibleRatio * 0.2 + (100 - metrics.bodySway) * 0.25,
  ) : 0;
  const overallScore = clampScore((content + structure + delivery + interaction + (hasVisual ? visualPresence : 0)) / (hasVisual ? 5 : 4));

  if (scenario.language === "en-US") {
    return {
      overallScore,
      summary: `This round scored ${overallScore}. Prioritize “${scenario.rubric[0]}” and a stronger connection with the audience next.`,
      strengths: [
        content >= 70 ? "The central message was clear enough for the audience to follow." : "You completed a full attempt and created useful material to review.",
        !hasVisual ? "This recording provides an audio baseline for the next round; visual delivery was not assessed." : metrics.cameraFacingRatio >= 65 ? "You maintained a steady visual connection with the audience." : "Your delivery included visible changes in pace and emphasis.",
        metrics.fillerCount <= 3 ? "Filler words were controlled and the language stayed clean." : "The key ideas are present and can now be made more concise.",
      ],
      improvements: [
        metrics.wordsPerMinute > 180 ? "Slow down around conclusions and numbers, leaving a short pause before and after them." : "Move the main claim earlier so the opening reaches the point faster.",
        !hasVisual ? "Leave a deliberate pause after each key claim." : metrics.cameraFacingRatio < 65 ? "Reconnect with the camera at the end of each section instead of staying on the script." : "Reduce small body movement before key lines to create a steadier visual center.",
        interaction < 70 ? "Add one question the audience can answer immediately." : "After a question, leave enough silence for the audience to respond.",
      ],
      nextPractice: [
        "Deliver a 30-second version with one problem, one claim, and one action.",
        `Answer “${scenario.prompts[0]}” in no more than 45 seconds.`,
        "Move to the next round with fewer or no notes.",
      ],
      dimensions: { content, structure, delivery, interaction, visualPresence },
    };
  }

  const strengths = [
    content >= 70 ? "内容主线比较清楚，听众能知道你希望他们记住什么。" : "已经完成了一轮完整表达，具备可复盘的素材。",
    !hasVisual ? "这份录音可作为下一轮对比的起点；本轮未评估视觉表现。" : metrics.cameraFacingRatio >= 65 ? "面向镜头的比例较好，建立了稳定的听众连接。" : "表达过程中有明显的节奏变化，不是平铺直叙。",
    metrics.fillerCount <= 3 ? "口头填充词控制得较好，语言显得干净。" : "关键观点已经出现，可以进一步压缩口头填充。",
  ];

  const improvements = [
    metrics.wordsPerMinute > 260 ? "整体语速偏快；在结论和数字前后主动停顿半秒。" : "把核心判断再提前，让开头更快进入主题。",
    !hasVisual ? "每个关键观点后留一次清晰停顿，让听众有时间消化。" : metrics.cameraFacingRatio < 65 ? "看提词卡时容易偏离镜头；每说完一段抬头完成一次听众连接。" : "在关键句前减少小幅晃动，让视觉重心更稳定。",
    interaction < 70 ? "增加一个听众可以立即回答的问题或明确行动指令。" : "追问之后留出真正的等待，不要立刻替听众回答。",
  ];

  return {
    overallScore,
    summary: `本轮完成度 ${overallScore} 分。下一步优先优化“${scenario.rubric[0]}”和现场连接感。`,
    strengths,
    improvements,
    nextPractice: [
      "用 30 秒版本重讲一次，只保留一个问题、一个判断和一个行动。",
      `针对听众问题“${scenario.prompts[0]}”做一次不超过 45 秒的回答。`,
      "进入下一轮，用更少的提示完成表达。",
    ],
    dimensions: { content, structure, delivery, interaction, visualPresence },
  };
}
