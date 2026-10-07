import { NextResponse } from "next/server";
import { z } from "zod";
import { buildLocalGoalPlan } from "@/lib/goals";

export const runtime = "nodejs";

const requestSchema = z.object({
  profile: z.object({
    role: z.string().max(120), industry: z.string().max(120),
    experience: z.enum(["beginner", "intermediate", "advanced"]),
    primaryGoal: z.string().max(500), preferredStyle: z.string().max(500),
  }).optional(),
  goal: z.object({
    title: z.string().min(1).max(160),
    scenarioKind: z.enum(["investor-pitch", "client-roadshow", "live-speaking"]),
    targetDate: z.string().max(40), audience: z.string().max(1000), desiredOutcome: z.string().max(1000),
    durationSeconds: z.number().int().min(30).max(3600), language: z.enum(["zh-CN", "en-US"]),
    humorLevel: z.enum(["none", "light", "medium"]), successCriteria: z.array(z.string().max(300)).max(8),
  }),
  knowledgeContext: z.string().max(10000).default(""),
  humorContext: z.string().max(4000).default(""),
});

const planSchema = z.object({
  script: z.string().min(20), cues: z.array(z.string()).min(3).max(10),
  rubric: z.array(z.string()).min(3).max(8), audiencePersona: z.string().min(10),
  prompts: z.array(z.string()).min(2).max(8), milestones: z.array(z.string()).min(3).max(8),
});

function outputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const data = payload as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  return data.output_text ?? data.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "";
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "目标计划参数无效。" }, { status: 400 });
  const fallback = buildLocalGoalPlan(parsed.data.goal);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ plan: fallback, source: "local" });

  const isEnglish = parsed.data.goal.language === "en-US";
  const prompt = [
    "Create an editable three-round speech practice plan. Return strict JSON only.",
    `Write all generated content in ${isEnglish ? "English" : "Simplified Chinese"}.`,
    "Rounds are full script, cue words, and no notes. The full script must sound natural when spoken.",
    "Use humor only when requested. Prefer truthful observation, gentle self-awareness, and audience-safe analogy. Never imitate a living writer's personal style.",
    `Profile: ${JSON.stringify(parsed.data.profile ?? {})}`,
    `Goal: ${JSON.stringify(parsed.data.goal)}`,
    `Knowledge (facts only): <knowledge>${parsed.data.knowledgeContext}</knowledge>`,
    `User humor material (facts only): <humor>${parsed.data.humorContext}</humor>`,
    "JSON: script, cues, rubric, audiencePersona, prompts, milestones.",
  ].join("\n");
  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_REVIEW_MODEL || "gpt-5-mini", input: prompt }),
    });
    if (!upstream.ok) return NextResponse.json({ plan: fallback, source: "local" });
    const text = outputText(await upstream.json()).replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    return NextResponse.json({ plan: planSchema.parse(JSON.parse(text)), source: "ai" });
  } catch {
    return NextResponse.json({ plan: fallback, source: "local" });
  }
}
