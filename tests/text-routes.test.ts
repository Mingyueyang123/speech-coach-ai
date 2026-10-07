import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/server-config", async original => {
  const configModule = await original<typeof import("@/lib/server-config")>();
  return { ...configModule, getConfig: vi.fn().mockResolvedValue(configModule.resolveConfig({ DEEPSEEK_API_KEY: "dummy-text-key" }, {})) };
});
import { POST as understand } from "@/app/api/goals/understand/route";
import { POST as plan } from "@/app/api/goals/plan/route";
import { POST as organize } from "@/app/api/materials/organize/route";
import { POST as review } from "@/app/api/review/route";
import { inferGoalDraft, inferMaterial } from "@/lib/conversation";
import { buildLocalGoalPlan } from "@/lib/goals";
import { buildLocalReview, calculateDeliveryMetrics } from "@/lib/analysis";
import { SCENARIOS } from "@/lib/scenarios";
afterEach(() => vi.unstubAllGlobals());
const message = "明天我要做三分钟英文投资人 Pitch";
const draft = inferGoalDraft(message);
const metrics = calculateDeliveryMetrics("Hello, this is a test.", 10000, [], "en-US");
it.each([
  { name: "goal understanding", route: understand, body: { message }, output: draft, source: true },
  { name: "goal planning", route: plan, body: { goal: draft }, output: { ...buildLocalGoalPlan(draft), audiencePersona: "An early-stage investor evaluating the business model." }, source: true },
  { name: "material organization", route: organize, body: { message, language: "en-US" }, output: inferMaterial(message, "en-US"), source: true },
  { name: "review", route: review, body: { transcript: "Hello, this is a test.", metrics, scenario: SCENARIOS[3] }, output: buildLocalReview("Hello, this is a test.", metrics, SCENARIOS[3]), source: false },
])("routes $name through the selected text service", async ({ route, body, output, source }) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] })); vi.stubGlobal("fetch", fetch);
  const response = await route(new Request("http://localhost/api/test", { method: "POST", body: JSON.stringify(body) }));
  expect(response.status).toBe(200);
  const data = await response.json(); if (source) expect(data.source).toBe("ai"); else expect(data.overallScore).toBeTypeOf("number");
  expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
});
