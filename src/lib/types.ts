export type ScenarioKind = "investor-pitch" | "client-roadshow" | "live-speaking";
export type AudienceIntensity = "friendly" | "balanced" | "challenging";
export type TeleprompterMode = "full" | "outline" | "hidden";

export interface PracticeScenario {
  id: string;
  kind: ScenarioKind;
  title: string;
  description: string;
  goal: string;
  durationSeconds: number;
  audiencePersona: string;
  script: string;
  outline: string[];
  prompts: string[];
  rubric: string[];
  knowledgeDocumentIds: string[];
}

export interface KnowledgeChunk {
  id: string;
  text: string;
  order: number;
}

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
  id: string;
  scenarioId: string;
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
