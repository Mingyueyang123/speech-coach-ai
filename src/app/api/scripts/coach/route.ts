import { NextResponse } from "next/server";
import { getConfig } from "@/lib/server-config";
import { createTextProvider, textConfigured } from "@/lib/providers/text";
import { coachingSchema, generatedScriptSchema, groundedCoaching, localCoaching, scriptPrompt, scriptRequestSchema } from "@/lib/script-coach";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const parsed = scriptRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "台本请求无效或内容过长。" }, { status: 400 });
  const input = parsed.data;
  if (input.operation === "learn" && input.transcript.trim().length < 4) return NextResponse.json({ error: "需要有效转写才能对照。" }, { status: 400 });
  const config = await getConfig();
  if (!textConfigured(config)) {
    return input.operation === "learn"
      ? NextResponse.json({ analysis: localCoaching(input), source: "local" })
      : NextResponse.json({ error: "请先在 API 配置中连接文本服务。仍可编辑台本或直接导入选中资料。", source: "local" }, { status: 503 });
  }
  try {
    const text = await createTextProvider(config).generate(scriptPrompt(input), request.signal);
    const value = JSON.parse(text);
    return input.operation === "learn"
      ? NextResponse.json({ analysis: groundedCoaching(coachingSchema.parse(value), input.original, input.transcript), source: "ai" })
      : NextResponse.json({ draft: generatedScriptSchema.parse(value), source: "ai" });
  } catch {
    return input.operation === "learn"
      ? NextResponse.json({ analysis: localCoaching(input), source: "local", warning: "文本服务不可用，已改为本地逐句对照；没有切换服务商。" })
      : NextResponse.json({ error: "文本服务未返回有效台本。原稿未改动，请重试或手动编辑。" }, { status: 502 });
  }
}
