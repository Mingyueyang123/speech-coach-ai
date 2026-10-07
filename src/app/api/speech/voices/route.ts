import { getConfig, isLocalConfigRequest, recordProviderCheck } from "@/lib/server-config";
import { getVoices } from "@/lib/providers/synthesis";
export async function POST(request: Request) {
  if (!isLocalConfigRequest(request)) return Response.json({ error: "仅允许本机同源访问" }, { status: 403 });
  try {
    const voices = await getVoices(await getConfig(), request.signal);
    await recordProviderCheck("minimax", false);
    return Response.json({ voices });
  } catch { return Response.json({ error: "音色列表读取失败，请检查 MiniMax 凭证与网络" }, { status: 502 }); }
}
