import Dexie, { type EntityTable } from "dexie";
import type { AppPreferences, HumorMaterial, KnowledgeDocument, SessionRecord, TrainingGoal, UserProfile } from "./types";

class SpeechCoachDatabase extends Dexie {
  documents!: EntityTable<KnowledgeDocument, "id">;
  sessions!: EntityTable<SessionRecord, "id">;
  profiles!: EntityTable<UserProfile, "id">;
  goals!: EntityTable<TrainingGoal, "id">;
  humorMaterials!: EntityTable<HumorMaterial, "id">;
  preferences!: EntityTable<AppPreferences, "id">;

  constructor() {
    super("speech-coach-ai");
    this.version(1).stores({
      documents: "id, source, title, createdAt, updatedAt",
      sessions: "id, scenarioId, startedAt",
    });
    this.version(2).stores({
      documents: "id, source, title, createdAt, updatedAt",
      sessions: "id, scenarioId, goalId, language, startedAt",
      profiles: "id, updatedAt",
      goals: "id, scenarioKind, language, targetDate, updatedAt",
      humorMaterials: "id, type, language, createdAt, updatedAt",
      preferences: "id, updatedAt",
    });
  }
}

export const db = new SpeechCoachDatabase();
