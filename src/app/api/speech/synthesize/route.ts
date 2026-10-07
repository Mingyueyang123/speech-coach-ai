import { z } from "zod";
import { getConfig, isLocalConfigRequest } from "@/lib/server-config";
import { createSynthesizer } from "@/lib/providers/synthesis";
const schema = z.object({ text: z.string().min(1).max(1200), language: z.enum(["zh-CN", "en-US"]) }).strict();
export async function POST(request: Request) {
  if (!isLocalConfigRequest(request)) return Response.json({ error: "仅允许本机同源访问" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "配音只接受短文本与语言" }, { status: 400 });
  try {
    const audio = await createSynthesizer(await getConfig()).synthesize(parsed.data.text, parsed.data.language, request.signal);
    return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "配音未完成，请检查所选配音服务的密钥、音色、额度和网络。问题文本已保留。" }, { status: 502 }); }
}
