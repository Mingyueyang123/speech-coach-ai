import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ config: vi.fn(), configured: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/server-config", () => ({ getConfig: mocks.config }));
vi.mock("@/lib/providers/text", () => ({ textConfigured: mocks.configured, createTextProvider: () => ({ generate: mocks.generate }) }));
import { POST } from "@/app/api/scripts/coach/route";
const data = { operation: "learn", scenario: { kind: "investor-pitch", language: "zh-CN", title: "Pitch", goal: "争取合作", durationSeconds: 180 }, original: "这是原始台本。", transcript: "这是我的实际发言，其实其实很好。" };
function request(value: unknown) { return new Request("http://localhost/api/scripts/coach", { method: "POST", body: JSON.stringify(value) }); }
afterEach(() => vi.resetAllMocks());
it("has an honest offline comparison and never invents generated material", async () => {
  mocks.configured.mockReturnValue(false);
  expect((await (await POST(request(data))).json()).source).toBe("local");
  const generation = await POST(request({ ...data, operation: "generate" }));
  expect(generation.status).toBe(503);
  expect(mocks.generate).not.toHaveBeenCalled();
});
it("validates generated scripts and does not return keys or internal errors", async () => {
  mocks.config.mockResolvedValue({ key: "private-secret" }); mocks.configured.mockReturnValue(true);
  mocks.generate.mockResolvedValue(JSON.stringify({ script: "这是一份经过整理的新台本，适合现场发言。", cues: ["开场", "价值"], summary: "缩短了句子。" }));
  const response = await POST(request({ ...data, operation: "generate" }));
  expect(response.status).toBe(200); expect(await response.text()).not.toContain("private-secret");
  mocks.generate.mockRejectedValue(new Error("private-secret"));
  const failure = await POST(request({ ...data, operation: "generate" }));
  expect(failure.status).toBe(502); expect(await failure.text()).not.toContain("private-secret");
});
it("rejects uploads and filters ungrounded analysis returned by the provider", async () => {
  expect((await POST(request({ ...data, faceLandmarks: [] }))).status).toBe(400);
  mocks.configured.mockReturnValue(true);
  mocks.generate.mockResolvedValue(JSON.stringify({ summary: "观察", changes: [], habits: [{ kind: "keep", rule: "保留这个说法", evidence: "没有说过的话" }] }));
  const response = await (await POST(request(data))).json();
  expect(response.analysis.habits).toEqual([]);
});
