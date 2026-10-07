import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const configSchema = z.object({
  OPENAI_API_KEY: z.string().max(512).optional(),
  OPENAI_REALTIME_MODEL: z.string().regex(/^[a-zA-Z0-9._-]+$/).optional(),
  OPENAI_REVIEW_MODEL: z.string().regex(/^[a-zA-Z0-9._-]+$/).optional(),
  FEISHU_APP_ID: z.string().max(200).optional(),
  FEISHU_APP_SECRET: z.string().max(512).optional(),
}).strict();
const file = path.join(process.cwd(), "local-data", "api-config.json");
export async function getConfig() {
  let stored: z.infer<typeof configSchema> = {};
  try { stored = configSchema.parse(JSON.parse(await readFile(file, "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return {
    OPENAI_API_KEY: stored.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    OPENAI_REALTIME_MODEL: stored.OPENAI_REALTIME_MODEL ?? process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
    OPENAI_REVIEW_MODEL: stored.OPENAI_REVIEW_MODEL ?? process.env.OPENAI_REVIEW_MODEL ?? "gpt-5-mini",
    FEISHU_APP_ID: stored.FEISHU_APP_ID ?? process.env.FEISHU_APP_ID ?? "",
    FEISHU_APP_SECRET: stored.FEISHU_APP_SECRET ?? process.env.FEISHU_APP_SECRET ?? "",
  };
}
export function isLocalConfigRequest(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return false;
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin !== `${url.protocol}//${host}`) return false;
  return !origin || origin === `${url.protocol}//${host}`;
}
export async function saveConfig(update: z.infer<typeof configSchema>) {
  const next = { ...await getConfig(), ...update };
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
  await rename(temporary, file);
}
export async function configStatus() {
  const value = await getConfig();
  return { openai: Boolean(value.OPENAI_API_KEY), feishu: Boolean(value.FEISHU_APP_ID && value.FEISHU_APP_SECRET), realtimeModel: value.OPENAI_REALTIME_MODEL, reviewModel: value.OPENAI_REVIEW_MODEL };
}
