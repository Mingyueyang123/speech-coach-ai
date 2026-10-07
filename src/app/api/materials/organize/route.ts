import { getConfig } from "@/lib/server-config";
import { createTextProvider, parseGeneratedJson, textConfigured } from "@/lib/providers/text";
import { NextResponse } from "next/server";
import { z } from "zod";
import { cleanSpokenText, inferMaterial } from "@/lib/conversation";

export const runtime = "nodejs";

const requestSchema = z.object({ message: z.string().min(3).max(6000), language: z.enum(["zh-CN", "en-US"]) });
const materialSchema = z.object({
  type: z.enum(["observation", "story", "analogy", "contrast", "self-deprecation", "callback", "interaction"]),
  title: z.string().min(1).max(120), content: z.string().min(1), language: z.enum(["zh-CN", "en-US"]),
  coreIdea: z.string().min(1).max(500),
  scenarioKinds: z.array(z.enum(["investor-pitch", "client-roadshow", "live-speaking"])).min(1),
  audienceBoundary: z.string(), sensitiveTopics: z.array(z.string()), tags: z.array(z.string()),
});

export async function POST(request: Request) {
  const config = await getConfig();
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "素材内容无效。" }, { status: 400 });
  const fallback = inferMaterial(parsed.data.message, parsed.data.language);
  if (!textConfigured(config)) return NextResponse.json({ material: fallback, source: "local", fallbackReason: "unconfigured" });

  try {
    const text = await createTextProvider(config).generate([
          "Act as an editor for a personal speech material library. Rewrite the user's raw spoken transcript into a reusable material card. Return strict JSON only.",
          "First repair word order. Remove filler words, false starts, duplicated phrases, self-referential framing such as 'my idea is', and redundant connectors.",
          "Write content as 2-5 concise, natural spoken sentences. Preserve every useful fact and the user's point of view; do not add facts or generic coaching advice.",
          "Write coreIdea as one complete sentence stating the reusable insight. Write a concise title that is not copied from the transcript opening.",
          "Preserve the user's meaning. Do not imitate a living writer. Do not create attacks on individuals or protected groups.",
          `Language: ${parsed.data.language}`,
          `Material: <material>${parsed.data.message}</material>`,
          "JSON fields: type, title, content, coreIdea, language, scenarioKinds, audienceBoundary, sensitiveTopics, tags.",
        ].join("\n"), request.signal);
    const organized = parseGeneratedJson(text, materialSchema);
    const material = {
      ...organized,
      content: cleanSpokenText(organized.content, parsed.data.language),
      coreIdea: cleanSpokenText(organized.coreIdea, parsed.data.language),
      sourceText: parsed.data.message.trim(),
    };
    return NextResponse.json({ material, source: "ai" });
  } catch (error) {
    console.warn("[materials/organize] using local organizer:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ material: fallback, source: "local", fallbackReason: "provider-error" });
  }
}
