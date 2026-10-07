import { getConfig, isLocalConfigRequest } from "@/lib/server-config";
export async function POST(request: Request) {
  if (!isLocalConfigRequest(request)) return Response.json({ error: "仅允许本机同源访问" }, { status: 403 });
  const config = await getConfig();
  if (!config.OPENAI_API_KEY) return Response.json({ error: "请先保存 OpenAI Key" }, { status: 400 });
  try {
    const result = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(10000) });
    if (!result.ok) return Response.json({ error: `验证失败 (${result.status})，请检查密钥权限或网络` }, { status: 502 });
    const data = await result.json() as { data: { id: string }[] };
    const models = data.data.map(item => item.id);
    return Response.json({ message: `密钥认证成功。实时模型${models.includes(config.OPENAI_REALTIME_MODEL) ? "可见" : "未在列表中找到"}，文本模型${models.includes(config.OPENAI_REVIEW_MODEL) ? "可见" : "未在列表中找到"}。实际调用仍受额度与权限限制。` });
  } catch { return Response.json({ error: "连接超时或网络不可用" }, { status: 502 }); }
}
