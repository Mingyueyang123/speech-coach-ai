import { getConfig } from "@/lib/server-config";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const requestSchema = z.object({ url: z.string().url().max(2000) });

type FeishuBlock = {
  block_type?: number;
  text?: { elements?: Array<{ text_run?: { content?: string } }> };
  heading1?: { elements?: Array<{ text_run?: { content?: string } }> };
  heading2?: { elements?: Array<{ text_run?: { content?: string } }> };
  heading3?: { elements?: Array<{ text_run?: { content?: string } }> };
  bullet?: { elements?: Array<{ text_run?: { content?: string } }> };
  ordered?: { elements?: Array<{ text_run?: { content?: string } }> };
  quote?: { elements?: Array<{ text_run?: { content?: string } }> };
};

function extractToken(url: string): { token: string; kind: "wiki" | "docx" } | null {
  const match = url.match(/\/(wiki|docx)\/([a-zA-Z0-9_-]+)/);
  return match ? { kind: match[1] as "wiki" | "docx", token: match[2] } : null;
}

async function getTenantToken(appId: string, appSecret: string): Promise<string> {
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const payload = await response.json() as { tenant_access_token?: string; msg?: string };
  if (!response.ok || !payload.tenant_access_token) throw new Error(payload.msg || "无法获取飞书访问令牌。");
  return payload.tenant_access_token;
}

async function resolveWikiToken(wikiToken: string, accessToken: string): Promise<string> {
  const response = await fetch(
    `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(wikiToken)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const payload = await response.json() as { data?: { node?: { obj_token?: string; obj_type?: string } }; msg?: string };
  if (!response.ok || !payload.data?.node?.obj_token) throw new Error(payload.msg || "无法解析飞书知识库节点。");
  if (payload.data.node.obj_type !== "docx") throw new Error("第一版仅支持飞书新版文档节点。");
  return payload.data.node.obj_token;
}

function blockText(block: FeishuBlock): string {
  const richText = block.text ?? block.heading1 ?? block.heading2 ?? block.heading3 ?? block.bullet ?? block.ordered ?? block.quote;
  return richText?.elements?.map((element) => element.text_run?.content ?? "").join("") ?? "";
}

async function fetchDocument(documentId: string, accessToken: string): Promise<string> {
  const lines: string[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ page_size: "500" });
    if (pageToken) params.set("page_token", pageToken);
    const response = await fetch(
      `https://open.feishu.cn/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const payload = await response.json() as {
      data?: { items?: FeishuBlock[]; page_token?: string; has_more?: boolean };
      msg?: string;
    };
    if (!response.ok || !payload.data) throw new Error(payload.msg || "无法读取飞书文档。");
    lines.push(...(payload.data.items ?? []).map(blockText).filter(Boolean));
    pageToken = payload.data.has_more ? payload.data.page_token ?? "" : "";
  } while (pageToken);
  return lines.join("\n");
}

export async function POST(request: Request) {
  const config = await getConfig();
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请输入有效的飞书文档或 Wiki 链接。" }, { status: 400 });
  const source = extractToken(parsed.data.url);
  if (!source) return NextResponse.json({ error: "链接中未找到飞书 docx/wiki 标识。" }, { status: 400 });
  const appId = config.FEISHU_APP_ID;
  const appSecret = config.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json({ error: "未配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET。" }, { status: 503 });
  }

  try {
    const accessToken = await getTenantToken(appId, appSecret);
    const documentId = source.kind === "wiki" ? await resolveWikiToken(source.token, accessToken) : source.token;
    const text = await fetchDocument(documentId, accessToken);
    return NextResponse.json({ title: `飞书文档 ${source.token.slice(0, 8)}`, text });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "飞书文档读取失败。";
    return NextResponse.json({ error }, { status: 502 });
  }
}
