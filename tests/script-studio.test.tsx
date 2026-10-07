import "fake-indexeddb/auto";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScriptStudio } from "@/components/ScriptStudio";
import { db } from "@/lib/db";
import { SCENARIOS } from "@/lib/scenarios";
import { buildLocalReview, calculateDeliveryMetrics } from "@/lib/analysis";
import type { SessionRecord } from "@/lib/types";

const scenario = { ...SCENARIOS[0], script: "各位好，这是同一份原始台本。", cues: ["开场"] };
const metrics = calculateDeliveryMetrics("我想先讲一个例子。", 60000, []);
function session(id: string, score: number): SessionRecord {
  return { id, scenarioId: scenario.id, scenarioSnapshot: structuredClone(scenario), transcript: "我想先讲一个例子。", language: "zh-CN", startedAt: "2026-01-01T12:00:00Z", durationMs: 60000, metrics, turns: [], metricTimeline: [], review: { ...buildLocalReview("我想先讲一个例子。", metrics, scenario), overallScore: score }, reviewSource: "local" };
}
function props() { return { scenario, documents: [], sessions: [session("one", 60), session("best", 88), session("three", 70)], versions: [], memories: [], onSave: vi.fn().mockResolvedValue(undefined), onRefresh: vi.fn().mockResolvedValue(undefined), onClose: vi.fn(), onKnowledge: vi.fn() }; }
beforeEach(async () => { await db.open(); await db.coachMemories.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("edits the script and derives cues without touching the baseline before saving", async () => {
  const p = props(); render(<ScriptStudio {...p} />);
  fireEvent.change(screen.getByLabelText("编辑完整台本"), { target: { value: "新的开场。\n\n新的收尾。" } });
  expect(p.onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "保存并用于练习" }));
  await waitFor(() => expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({ script: "新的开场。\n\n新的收尾。", cues: ["新的开场", "新的收尾"] })));
  expect(scenario.script).toBe("各位好，这是同一份原始台本。");
});
it("imports selected local excerpts without any API call", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const p = props();
  render(<ScriptStudio {...p} initialTab="sources" documents={[{ id: "doc", title: "活动资料", chunks: [{ id: "chunk", order: 0, text: "这里是经过选择的资料原文。" }], source: "local", mimeType: "text/plain", createdAt: "2026", updatedAt: "2026" }]} />);
  fireEvent.click(screen.getByRole("checkbox", { name: /活动资料/ }));
  fireEvent.click(screen.getByRole("button", { name: "直接载入原文片段" }));
  expect(screen.getByLabelText("编辑完整台本")).toHaveValue("这里是经过选择的资料原文。");
  expect(fetch).not.toHaveBeenCalled();
  expect(p.onSave).not.toHaveBeenCalled();
});
it("offers inspiration documents as script sources", () => {
  const p = props();
  render(<ScriptStudio {...p} initialTab="sources" documents={[{ id: "inspiration:idea", sourceMaterialId: "idea", title: "一个真实观察", chunks: [{ id: "chunk", order: 0, text: "这是从语音灵感整理出的表达。" }], source: "inspiration", mimeType: "text/x-speech-coach-inspiration", createdAt: "2026", updatedAt: "2026" }]} />);
  expect(screen.getByText("灵感 · 1 个片段")).toBeVisible();
  fireEvent.click(screen.getByRole("checkbox", { name: /一个真实观察/ }));
  fireEvent.click(screen.getByRole("button", { name: "直接载入原文片段" }));
  expect(screen.getByLabelText("编辑完整台本")).toHaveValue("这是从语音灵感整理出的表达。");
});
it("selects the best of three, confirms memories, and reuses them in the next draft", async () => {
  const p = props();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ source: "ai", analysis: { summary: "这次先举例，再说结论。", changes: [{ original: scenario.script, spoken: "我想先讲一个例子。", observation: "开场更口语化。" }], habits: [{ rule: "先用一个具体例子引入观点。", evidence: "我想先讲一个例子。", kind: "keep" }] } }));
  vi.stubGlobal("fetch", fetch);
  const view = render(<ScriptStudio {...p} initialTab="learn" />);
  expect(screen.getByRole("button", { name: /88 分/ })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "对照并提炼表达习惯" }));
  await screen.findByText("值得记住的习惯，由你确认");
  expect(await db.coachMemories.count()).toBe(0);
  const request = JSON.parse(fetch.mock.calls[0][1].body);
  expect(request.original).toBe(scenario.script);
  expect(request.transcript).toBe("我想先讲一个例子。");
  expect(request).not.toHaveProperty("videoBlob");
  fireEvent.click(screen.getByRole("checkbox", { name: /先用一个具体例子/ }));
  fireEvent.click(screen.getByRole("button", { name: "记住选中的习惯" }));
  await waitFor(() => expect(p.onRefresh).toHaveBeenCalled());
  const memories = await db.coachMemories.toArray();
  expect(memories[0].sourceSessionIds).toEqual(["best"]);
  view.rerender(<ScriptStudio {...p} initialTab="learn" memories={memories} />);
  fetch.mockResolvedValueOnce(Response.json({ source: "ai", draft: { script: "我先讲一个真实的例子，再介绍这个观点。", cues: ["具体例子", "观点"], summary: "延续你确认的开场方式。" } }));
  fireEvent.click(screen.getByRole("button", { name: "用这次表现生成下一版" }));
  await screen.findByLabelText("编辑完整台本");
  expect(JSON.parse(fetch.mock.calls[1][1].body).memories).toEqual([{ rule: memories[0].rule, kind: "keep" }]);
  expect(p.onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "保存并用于练习" }));
  await waitFor(() => expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({ sourceSessionId: "best", memoryIds: [memories[0].id], origin: "iteration" })));
  expect(p.sessions.map(s => s.scenarioSnapshot?.script)).toEqual([scenario.script, scenario.script, scenario.script]);
});
it("keeps the current draft when the provider fails, and can forget an approved memory", async () => {
  const p = props(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "原稿未改动" }, { status: 502 })));
  render(<ScriptStudio {...p} initialTab="learn" />);
  fireEvent.click(screen.getByRole("button", { name: "用这次表现生成下一版" }));
  await screen.findByText("原稿未改动");
  fireEvent.click(screen.getByRole("button", { name: "台本" }));
  expect(screen.getByLabelText("编辑完整台本")).toHaveValue(scenario.script);
  cleanup();
  const memory = { id: "remembered", rule: "先讲例子", evidence: "一个例子", kind: "keep" as const, language: "zh-CN" as const, scenarioKind: scenario.kind, sourceSessionIds: ["best"], createdAt: "2026" };
  await db.coachMemories.put(memory);
  render(<ScriptStudio {...p} initialTab="memory" memories={[memory]} />);
  await act(async () => fireEvent.click(screen.getByTitle("忘记此习惯")));
  expect(await db.coachMemories.count()).toBe(0);
});
