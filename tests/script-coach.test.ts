import { describe, expect, it } from "vitest";
import { comparableSessions, groundedCoaching, localCoaching, relevantMemories, scriptCues, scriptPrompt, scriptRequestSchema, selectScriptSources, sentenceDiff } from "@/lib/script-coach";
import { SCENARIOS } from "@/lib/scenarios";
import { calculateDeliveryMetrics, buildLocalReview } from "@/lib/analysis";
import type { CoachMemory, KnowledgeDocument, SessionRecord } from "@/lib/types";

const scenario = SCENARIOS[0];
const input = scriptRequestSchema.parse({ operation: "learn", scenario: { kind: scenario.kind, language: scenario.language, title: scenario.title, goal: scenario.goal, durationSeconds: 180 }, original: "你好。我们做产品。", transcript: "你好。其实我们做产品，其实很好用。" });
function record(id: string, score: number, original = input.original): SessionRecord {
  const metrics = calculateDeliveryMetrics(input.transcript, 60000, []);
  return { id, scenarioId: scenario.id, scenarioSnapshot: { ...scenario, script: original }, transcript: input.transcript, metrics, turns: [], metricTimeline: [], startedAt: "2026-01-01", durationMs: 60000, review: { ...buildLocalReview(input.transcript, metrics, scenario), overallScore: score } };
}
describe("versioned script coaching", () => {
  it("aligns repeated Chinese sentences and English punctuation without going out of bounds", () => {
    expect(sentenceDiff("你好。谢谢。你好。", "你好。你好。").changes.map(c => c.kind)).toEqual(["same", "removed", "same"]);
    expect(sentenceDiff("Hello world!", "hello world.").changes.map(c => c.kind)).toEqual(["same"]);
    expect(sentenceDiff("One. ".repeat(300), "Two. ".repeat(300)).truncated).toBe(true);
  });
  it("excludes old records without a snapshot and ranks saved scores", () => {
    const old = { ...record("old", 100), scenarioSnapshot: undefined };
    const other = { ...record("other", 100), scenarioSnapshot: SCENARIOS[1] };
    expect(comparableSessions([record("a", 50), record("b", 85), old, other], scenario.id).map(s => s.id)).toEqual(["b", "a"]);
  });
  it("only uses explicitly selected document chunks, not the whole library", () => {
    const docs = ["chosen", "private"].map(id => ({ id, title: id, chunks: [{ id: `${id}-chunk`, order: 0, text: `${id} product information` }] })) as KnowledgeDocument[];
    const sources = selectScriptSources(docs, ["chosen"], "product");
    expect(sources).toHaveLength(1);
    expect(sources[0].documentId).toBe("chosen");
    expect(selectScriptSources(docs, [], "product")).toEqual([]);
  });
  it("keeps personal memory within the matching language and scenario", () => {
    const memory = { language: "zh-CN", scenarioKind: "investor-pitch", rule: "先讲问题", kind: "keep" } as CoachMemory;
    expect(relevantMemories([memory, { ...memory, language: "en-US" }, { ...memory, scenarioKind: "client-roadshow" }], scenario)).toEqual([memory]);
  });
  it("drops fabricated quotations and only proposes grounded habits", () => {
    const result = groundedCoaching({ summary: "待验证", changes: [{ original: "伪造引用", spoken: "", observation: "不可用" }], habits: [{ rule: "减少其实", evidence: "其实", kind: "avoid" }, { rule: "保留故事", evidence: "不存在的故事", kind: "keep" }] }, input.original, input.transcript);
    expect(result.changes).toHaveLength(0);
    expect(result.habits).toHaveLength(1);
    expect(localCoaching(input).habits[0].evidence).toBe("其实");
    expect(localCoaching(input).summary).toContain("不能证明");
  });
  it("validates request limits, rejects video and separates instructions from source data", () => {
    expect(scriptRequestSchema.safeParse({ ...input, videoBlob: "private" }).success).toBe(false);
    expect(scriptRequestSchema.safeParse({ ...input, original: "a".repeat(30001) }).success).toBe(false);
    expect(scriptPrompt(input)).toContain("never claim that a change caused a higher score");
    expect(scriptPrompt(input)).toContain("DATA=");
    expect(scriptCues("第一段。例子。\n\n第二段。行动。")).toEqual(["第一段", "第二段"]);
  });
});
