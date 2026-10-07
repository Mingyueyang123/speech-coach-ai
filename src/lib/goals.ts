import { getScenarioByKind } from "./scenarios";
import type { GoalPlan, PracticeRound, TrainingGoal, UserProfile } from "./types";

export const DEFAULT_PROFILE: UserProfile = {
  id: "local-profile", role: "", industry: "", experience: "beginner",
  languages: ["zh-CN"], primaryGoal: "", preferredStyle: "清晰、自然、有现场感",
  onboardingComplete: false, updatedAt: new Date(0).toISOString(),
};

export function createPracticeRounds(): PracticeRound[] {
  return [
    { index: 1, mode: "full", status: "not-started" },
    { index: 2, mode: "cues", status: "not-started" },
    { index: 3, mode: "hidden", status: "not-started" },
  ];
}

export function buildLocalGoalPlan(goal: Pick<TrainingGoal, "scenarioKind" | "language" | "audience" | "desiredOutcome" | "humorLevel">): GoalPlan {
  const scenario = getScenarioByKind(goal.scenarioKind, goal.language);
  const isEnglish = goal.language === "en-US";
  const humorMilestone = goal.humorLevel === "none"
    ? null
    : isEnglish ? "Test one audience-safe moment of humor" : "试讲一个符合受众边界的幽默点";
  return {
    script: scenario.script,
    cues: scenario.cues,
    rubric: scenario.rubric,
    audiencePersona: goal.audience.trim() || scenario.audiencePersona,
    prompts: scenario.prompts,
    milestones: [
      isEnglish ? "Deliver the full script with stable pacing" : "完整讲完逐字稿并稳定节奏",
      isEnglish ? "Keep the structure using cues only" : "只看关键词仍能保留完整结构",
      isEnglish ? "Deliver without notes and handle one question" : "脱稿表达并处理一个现场追问",
      ...(humorMilestone ? [humorMilestone] : []),
      goal.desiredOutcome,
    ].filter(Boolean),
  };
}

export function nextRoundIndex(goal: TrainingGoal): 1 | 2 | 3 {
  const next = goal.rounds.find((round) => round.status !== "completed");
  return next?.index ?? 3;
}
