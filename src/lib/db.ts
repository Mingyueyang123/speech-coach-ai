import Dexie, { type EntityTable } from "dexie";
import type { AppPreferences, HumorMaterial, KnowledgeDocument, SessionRecord, TrainingGoal, UserProfile, ScriptVersion, CoachMemory } from "./types";
import { inspirationDocumentId, materialToKnowledgeDocument } from "./knowledge";

class SpeechCoachDatabase extends Dexie {
  documents!: EntityTable<KnowledgeDocument, "id">;
  sessions!: EntityTable<SessionRecord, "id">;
  profiles!: EntityTable<UserProfile, "id">;
  goals!: EntityTable<TrainingGoal, "id">;
  humorMaterials!: EntityTable<HumorMaterial, "id">;
  preferences!: EntityTable<AppPreferences, "id">;
  scriptVersions!: EntityTable<ScriptVersion, "id">;
  coachMemories!: EntityTable<CoachMemory, "id">;

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
    this.version(3).stores({
      scriptVersions: "id, scopeKey, createdAt",
      coachMemories: "id, language, scenarioKind, createdAt",
    });
    this.version(4).stores({}).upgrade(async (transaction) => {
      const materials = await transaction.table<HumorMaterial>("humorMaterials").toArray();
      const documents = transaction.table<KnowledgeDocument>("documents");
      const materialTable = transaction.table<HumorMaterial>("humorMaterials");
      for (const material of materials) {
        const knowledgeDocumentId = material.knowledgeDocumentId ?? inspirationDocumentId(material.id);
        const linked = await documents.get(knowledgeDocumentId);
        const updated = { ...material, knowledgeDocumentId };
        await documents.put(materialToKnowledgeDocument(updated, linked));
        if (!material.knowledgeDocumentId) await materialTable.put(updated);
      }
    });
  }
}

export const db = new SpeechCoachDatabase();
