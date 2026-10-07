import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import Dexie from "dexie";
import { db } from "@/lib/db";
import { calculateDeliveryMetrics } from "@/lib/analysis";
import type { SessionRecord } from "@/lib/types";
afterEach(async () => { db.close(); await Dexie.delete("speech-coach-ai"); });
it("preserves old recordings and documents while accepting optional provider snapshots", async () => {
  const previous = new Dexie("speech-coach-ai");
  previous.version(1).stores({ documents: "id, source, title, createdAt, updatedAt", sessions: "id, scenarioId, startedAt" });
  const record: SessionRecord = { id: "old-round", scenarioId: "investor-pitch", startedAt: "2026-01-01", durationMs: 60000, transcript: "历史发言", turns: [], metricTimeline: [], metrics: calculateDeliveryMetrics("历史发言", 60000, []) };
  await previous.table("sessions").put(record);
  await previous.table("documents").put({ id: "private-document", title: "Original local material", source: "file" });
  previous.close();
  await db.open();
  expect((await db.sessions.get("old-round"))?.transcript).toBe("历史发言");
  expect((await db.sessions.get("old-round"))?.providers).toBeUndefined();
  expect((await db.documents.get("private-document"))?.title).toBe("Original local material");
  await db.sessions.put({ ...record, id: "new-round", providers: { text: "deepseek", recognition: "aliyun", synthesis: "minimax", textModel: "deepseek-flash", recognitionModel: "qwen-audio-3.1-asr-flash-streaming", synthesisModel: "speech-2.8-turbo" } });
  db.close(); await db.open(); expect(await db.sessions.count()).toBe(2);
});

it("upgrades v2 without rewriting private goals and retains frozen scripts and memory on reload", async () => {
  const previous = new Dexie("speech-coach-ai");
  previous.version(2).stores({ documents: "id, source, title, createdAt, updatedAt", sessions: "id, scenarioId, goalId, language, startedAt", profiles: "id, updatedAt", goals: "id, scenarioKind, language, targetDate, updatedAt", humorMaterials: "id, type, language, createdAt, updatedAt", preferences: "id, updatedAt" });
  await previous.table("goals").put({ id: "private-goal", plan: { script: "不要丢失旧台本" } });
  await previous.table("preferences").put({ id: "app-preferences", cameraHeight: 420 });
  previous.close();
  await db.open();
  expect((await db.goals.get("private-goal"))?.plan.script).toBe("不要丢失旧台本");
  expect((await db.preferences.get("app-preferences"))?.cameraHeight).toBe(420);
  await db.scriptVersions.add({ id: "v1", scopeKey: "pitch", script: "这是第一版台本。", cues: ["开场"], sourceDocumentIds: [], memoryIds: [], origin: "manual", createdAt: "2026-01-01" });
  await db.scriptVersions.add({ id: "v2", parentId: "v1", scopeKey: "pitch", script: "这是第二版台本。", cues: ["开场"], sourceDocumentIds: [], memoryIds: ["memory"], origin: "iteration", createdAt: "2026-01-02" });
  await db.coachMemories.put({ id: "memory", rule: "先讲例子", evidence: "一个例子", kind: "keep", language: "zh-CN", scenarioKind: "investor-pitch", sourceSessionIds: ["best"], createdAt: "2026-01-01" });
  db.close(); await db.open();
  expect((await db.scriptVersions.get("v1"))?.script).toBe("这是第一版台本。");
  expect((await db.scriptVersions.get("v2"))?.parentId).toBe("v1");
  expect((await db.coachMemories.get("memory"))?.sourceSessionIds).toEqual(["best"]);
});

it("migrates existing inspiration into the knowledge library without changing its text", async () => {
  const previous = new Dexie("speech-coach-ai");
  previous.version(3).stores({
    documents: "id, source, title, createdAt, updatedAt", sessions: "id, scenarioId, goalId, language, startedAt",
    profiles: "id, updatedAt", goals: "id, scenarioKind, language, targetDate, updatedAt",
    humorMaterials: "id, type, language, createdAt, updatedAt", preferences: "id, updatedAt",
    scriptVersions: "id, scopeKey, createdAt", coachMemories: "id, language, scenarioKind, createdAt",
  });
  await previous.table("humorMaterials").put({
    id: "old-idea", type: "story", title: "旧灵感", content: "这是不能丢失的原始灵感。", language: "zh-CN",
    scenarioKinds: ["live-speaking"], audienceBoundary: "不涉及个人隐私", sensitiveTopics: [], tags: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
  });
  previous.close();
  await db.open();
  const material = await db.humorMaterials.get("old-idea");
  const document = await db.documents.get("inspiration:old-idea");
  expect(material?.content).toBe("这是不能丢失的原始灵感。");
  expect(material?.knowledgeDocumentId).toBe("inspiration:old-idea");
  expect(document?.source).toBe("inspiration");
  expect(document?.chunks[0].text).toContain("这是不能丢失的原始灵感");
});
