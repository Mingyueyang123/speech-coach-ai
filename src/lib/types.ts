export type ScenarioKind = "investor-pitch" | "client-roadshow" | "live-speaking";
export type AudienceIntensity = "friendly" | "balanced" | "challenging";
export type TeleprompterMode = "full" | "cues" | "hidden";
export type TrainingLanguage = "zh-CN" | "en-US";
export type ScrollMode = "speech" | "manual";
export type HumorLevel = "none" | "light" | "medium";
export type RoundStatus = "not-started" | "in-progress" | "completed";
export type HumorMaterialType = "observation" | "story" | "analogy" | "contrast" | "self-deprecation" | "callback" | "interaction";

export interface PracticeRound {
  index: 1 | 2 | 3;
  mode: TeleprompterMode;
  status: RoundStatus;
  sessionId?: string;
  completedAt?: string;
  score?: number;
}

export interface GoalPlan {
  script: string;
  cues: string[];
  rubric: string[];
  audiencePersona: string;
  prompts: string[];
  milestones: string[];
}

export interface UserProfile {
  id: "local-profile";
  role: string;
  industry: string;
  experience: "beginner" | "intermediate" | "advanced";
  languages: TrainingLanguage[];
  primaryGoal: string;
  preferredStyle: string;
  onboardingComplete: boolean;
  updatedAt: string;
}

export interface TrainingGoal {
  id: string;
  title: string;
  scenarioKind: ScenarioKind;
  targetDate: string;
  audience: string;
  desiredOutcome: string;
  durationSeconds: number;
  language: TrainingLanguage;
  humorLevel: HumorLevel;
  successCriteria: string[];
  knowledgeDocumentIds: string[];
  humorMaterialIds: string[];
  plan: GoalPlan;
  rounds: PracticeRound[];
  createdAt: string;
  updatedAt: string;
}

export interface HumorMaterial {
  id: string;
  type: HumorMaterialType;
  title: string;
  content: string;
  language: TrainingLanguage;
  scenarioKinds: ScenarioKind[];
  audienceBoundary: string;
  sensitiveTopics: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AppPreferences {
  id: "app-preferences";
  cameraHeight: number;
  cameraCollapsed: boolean;
  scrollMode: ScrollMode;
  activeGoalId?: string;
  onboardingDismissed: boolean;
  updatedAt: string;
}

export interface PracticeScenario {
  id: string;
  baseId: string;
  kind: ScenarioKind;
  language: TrainingLanguage;
  title: string;
  description: string;
  goal: string;
  durationSeconds: number;
  audiencePersona: string;
  script: string;
  cues: string[];
  prompts: string[];
  rubric: string[];
  humorFocus: string;
  roundModes: TeleprompterMode[];
  knowledgeDocumentIds: string[];
}

export interface KnowledgeChunk { id: string; text: string; order: number; }

export interface KnowledgeDocument {
  id: string;
  source: "local" | "feishu";
  title: string;
  mimeType: string;
  chunks: KnowledgeChunk[];
  createdAt: string;
  updatedAt: string;
}

export interface MetricPoint {
  timestampMs: number;
  volume: number;
  cameraFacing: number;
  expression: number;
  smile: number;
  handsVisible: number;
  gestureMovement: number;
  bodySway: number;
}

export interface DeliveryMetrics {
  wordsPerMinute: number;
  fillerCount: number;
  pauseCount: number;
  averageVolume: number;
  volumeVariation: number;
  cameraFacingRatio: number;
  expressionRange: number;
  smileRatio: number;
  handsVisibleRatio: number;
  gestureRate: number;
  bodySway: number;
}

export interface ConversationTurn {
  id: string;
  role: "speaker" | "audience" | "system";
  text: string;
  timestampMs: number;
}

export interface SessionRecord {
  providers?: import("./providers/contracts").ProviderSnapshot;
  sceneEvents?: import("./immersive").SceneEvent[];
  immersiveScenarioId?: string;
  id: string;
  scenarioId: string;
  goalId?: string;
  roundMode?: TeleprompterMode;
  roundIndex?: 1 | 2 | 3;
  language?: TrainingLanguage;
  speechFollowProgress?: number;
  startedAt: string;
  durationMs: number;
  transcript: string;
  turns: ConversationTurn[];
  metricTimeline: MetricPoint[];
  metrics: DeliveryMetrics;
  videoBlob?: Blob;
}

export interface ReviewReport {
  overallScore: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  nextPractice: string[];
  dimensions: {
    content: number;
    structure: number;
    delivery: number;
    interaction: number;
    visualPresence: number;
  };
}
