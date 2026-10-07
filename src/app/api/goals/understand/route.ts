import { getConfig } from "@/lib/server-config";
import { NextResponse } from "next/server";
import { z } from "zod";
import { inferGoalDraft } from "@/lib/conversation";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().min(3).max(4000),
  profile: z.object({ languages: z.array(z.enum(["zh-CN", "en-US"])).min(1) }).passthrough().optional(),
});

const draftSchema = z.object({
  title: z.string().min(1).max(160),
  scenarioKind: z.enum(["investor-pitch", "client-roadshow", "live-speaking"]),
  targetDate: z.string(), audience: z.string(), desiredOutcome: z.string(),
  durationSeconds: z.number().int().min(30).max(3600), language: z.enum(["zh-CN", "en-US"]),
  humorLevel: z.enum(["none", "light", "medium"]), successCriteria: z.array(z.string()).min(2).max(8),
});

function outputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const data = payload as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  return data.output_text ?? data.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "";
}

export async function POST(request: Request) {
  const config = await getConfig();
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "目标描述无效。" }, { status: 400 });
  const fallback = inferGoalDraft(parsed.data.message, parsed.data.profile);
  const apiKey = config.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ draft: fallback, source: "local" });

  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.OPENAI_REVIEW_MODEL || "gpt-5-mini",
        input: [
          "Extract one speech-training goal from the user's conversational message. Return strict JSON only.",
          "Infer scenario, date, audience, outcome, duration, language, safe humor level, and 3-5 success criteria. Do not ask the user to fill fields.",
          `Today: ${new Date().toISOString().slice(0, 10)}`,
          `Profile: ${JSON.stringify(parsed.data.profile ?? {})}`,
          `Message: <message>${parsed.data.message}</message>`,
          "JSON fields: title, scenarioKind, targetDate(YYYY-MM-DD), audience, desiredOutcome, durationSeconds, language, humorLevel, successCriteria.",
        ].join("\n"),
      }),
    });
    if (!upstream.ok) return NextResponse.json({ draft: fallback, source: "local" });
    const text = outputText(await upstream.json()).replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    return NextResponse.json({ draft: draftSchema.parse(JSON.parse(text)), source: "ai" });
  } catch {
    return NextResponse.json({ draft: fallback, source: "local" });
  }
}
