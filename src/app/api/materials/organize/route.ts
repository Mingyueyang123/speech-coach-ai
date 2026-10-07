import { getConfig } from "@/lib/server-config";
import { createTextProvider, textConfigured } from "@/lib/providers/text";
import { NextResponse } from "next/server";
import { z } from "zod";
import { inferMaterial } from "@/lib/conversation";

export const runtime = "nodejs";

const requestSchema = z.object({ message: z.string().min(3).max(6000), language: z.enum(["zh-CN", "en-US"]) });
const materialSchema = z.object({
  type: z.enum(["observation", "story", "analogy", "contrast", "self-deprecation", "callback", "interaction"]),
  title: z.string().min(1).max(120), content: z.string().min(1), language: z.enum(["zh-CN", "en-US"]),
  scenarioKinds: z.array(z.enum(["investor-pitch", "client-roadshow", "live-speaking"])).min(1),
  audienceBoundary: z.string(), sensitiveTopics: z.array(z.string()), tags: z.array(z.string()),
});

export async function POST(request: Request) {
  const config = await getConfig();
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "素材内容无效。" }, { status: 400 });
  const fallback = inferMaterial(parsed.data.message, parsed.data.language);
  if (!textConfigured(config)) return NextResponse.json({ material: fallback, source: "local" });

  try {
    const text = await createTextProvider(config).generate([
          "Organize the user's spoken or typed inspiration into a reusable speech material card. Return strict JSON only.",
          "Preserve the user's meaning. Do not imitate a living writer. Do not create attacks on individuals or protected groups.",
          `Language: ${parsed.data.language}`,
          `Material: <material>${parsed.data.message}</material>`,
          "JSON fields: type, title, content, language, scenarioKinds, audienceBoundary, sensitiveTopics, tags.",
        ].join("\n"), request.signal);
    return NextResponse.json({ material: materialSchema.parse(JSON.parse(text)), source: "ai" });
  } catch {
    return NextResponse.json({ material: fallback, source: "local" });
  }
}
