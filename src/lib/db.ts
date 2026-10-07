import Dexie, { type EntityTable } from "dexie";
import type { KnowledgeDocument, SessionRecord } from "./types";

class SpeechCoachDatabase extends Dexie {
  documents!: EntityTable<KnowledgeDocument, "id">;
  sessions!: EntityTable<SessionRecord, "id">;

  constructor() {
    super("speech-coach-ai");
    this.version(1).stores({
      documents: "id, source, title, createdAt, updatedAt",
      sessions: "id, scenarioId, startedAt",
    });
  }
}

export const db = new SpeechCoachDatabase();
