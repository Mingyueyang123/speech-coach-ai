import { getConfig } from "@/lib/server-config";
import { createTextProvider, parseGeneratedJson, textConfigured } from "@/lib/providers/text";
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
  actionSteps: z.array(z.string().min(4).max(240)).min(3).max(8),
});

export async function POST(request: Request) {
  const config = await getConfig();
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "目标描述无效。" }, { status: 400 });
  const fallback = inferGoalDraft(parsed.data.message, parsed.data.profile);
  if (!textConfigured(config)) return NextResponse.json({ draft: fallback, source: "local", fallbackReason: "unconfigured" });

  try {
    const text = await createTextProvider(config).generate([
          "Act as a speech coach. Convert the user's raw spoken transcript into one clear, executable speech-training goal. Return strict JSON only.",
          "Repair word order, remove filler words and repetition, but preserve facts and intent. Never use the raw opening words as the title.",
          "Infer the scenario, concrete target date, audience, key desired outcome, duration, language, safe humor level, 3-5 success criteria, and 3-6 chronological action steps.",
          "Each action step must start with a concrete action and be usable as a checklist. If the date is described as a week, choose that week's Friday as the target date.",
          "Do not ask the user to fill fields and do not invent names, metrics, customers, or commitments.",
          `Today: ${new Date().toISOString().slice(0, 10)}`,
          `Profile: ${JSON.stringify(parsed.data.profile ?? {})}`,
          `Message: <message>${parsed.data.message}</message>`,
          "JSON fields: title, scenarioKind, targetDate(YYYY-MM-DD), audience, desiredOutcome, durationSeconds, language, humorLevel, successCriteria, actionSteps.",
        ].join("\n"), request.signal);
    const draft = parseGeneratedJson(text, draftSchema);
    return NextResponse.json({ draft, source: "ai" });
  } catch (error) {
    console.warn("[goals/understand] using local organizer:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ draft: fallback, source: "local", fallbackReason: "provider-error" });
  }
}
