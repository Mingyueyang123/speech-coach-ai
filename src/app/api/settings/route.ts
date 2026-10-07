import { configSchema, configStatus, isLocalConfigRequest, saveConfig } from "@/lib/server-config";
export const runtime = "nodejs";
export async function GET(request: Request) {
  if (!isLocalConfigRequest(request)) return Response.json({ error: "配置仅允许本机访问" }, { status: 403 });
  return Response.json(await configStatus(), { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!isLocalConfigRequest(request)) return Response.json({ error: "配置仅允许本机同源访问" }, { status: 403 });
  const parsed = configSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".");
    return Response.json({ error: field ? `${field} 格式不正确` : "配置格式不正确" }, { status: 400 });
  }
  try { await saveConfig(parsed.data); return Response.json(await configStatus()); }
  catch { return Response.json({ error: "无法保存本机配置，请检查目录权限" }, { status: 500 }); }
}
