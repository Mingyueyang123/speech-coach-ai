import { getConfig, isLocalConfigRequest, recordProviderCheck } from "@/lib/server-config";
import { createTextProvider } from "@/lib/providers/text";
import { createSynthesizer, getVoices } from "@/lib/providers/synthesis";
import { z } from "zod";
const schema = z.object({ provider: z.enum(["openai", "deepseek", "minimax"]), capability: z.enum(["authentication", "text", "synthesis"]), language: z.enum(["zh-CN", "en-US"]).default("zh-CN") }).strict();
export async function POST(request: Request) {
  if (!isLocalConfigRequest(request)) return Response.json({ error: "仅允许本机同源访问" }, { status: 403 });
  const config = await getConfig();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "请选择测试服务和能力" }, { status: 400 });
  const { provider, capability, language } = parsed.data;
  if ((provider === "minimax" && capability === "text") || (provider === "deepseek" && capability === "synthesis")) return Response.json({ error: "该服务不支持此能力" }, { status: 400 });
  const start = Date.now();
  try {
    if (capability === "synthesis") {
      const audio = await createSynthesizer({ ...config, bindings: { ...config.bindings, synthesis: provider as "openai" | "minimax" } }).synthesize(language === "en-US" ? "Hello. Could you give an example?" : "你好，可以举一个具体例子吗？", language, request.signal);
      await recordProviderCheck(provider, true, Date.now() - start, "synthesis");
      return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Latency-Ms": String(Date.now() - start) } });
    }
    if (capability === "text") {
      await createTextProvider({ ...config, bindings: { ...config.bindings, text: provider as "openai" | "deepseek" } }).generate(`Return JSON {"message":"${language === "en-US" ? "Connection ready" : "连接成功"}"}`, request.signal);
    } else if (provider === "minimax") await getVoices(config, request.signal);
    else {
      const key = provider === "openai" ? config.OPENAI_API_KEY : config.DEEPSEEK_API_KEY;
      if (!key) throw new Error("missing");
      const response = await fetch(provider === "openai" ? "https://api.openai.com/v1/models" : "https://api.deepseek.com/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]) });
      if (!response.ok) throw new Error("authentication");
      z.object({ data: z.array(z.object({ id: z.string() })) }).parse(await response.json());
    }
    await recordProviderCheck(provider, capability !== "authentication", Date.now() - start);
    return Response.json({ message: `${capability === "authentication" ? "认证通过（尚未验证实际生成）" : "实际文本调用通过"} · ${Date.now() - start} ms`, latencyMs: Date.now() - start });
  } catch { return Response.json({ error: "测试未通过，请检查该服务的凭证、模型权限、额度和网络" }, { status: 502 }); }
}
