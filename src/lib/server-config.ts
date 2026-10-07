import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ProviderId, ProviderCheck, SettingsStatus } from "./providers/contracts";

const model = z.string().min(1).max(120).regex(/^[a-zA-Z0-9._-]+$/);
export const configSchema = z.object({
  version: z.literal(2).optional(),
  OPENAI_API_KEY: z.string().max(512).optional(),
  OPENAI_REALTIME_MODEL: z.string().regex(/^[a-zA-Z0-9._-]+$/).optional(),
  OPENAI_REVIEW_MODEL: z.string().regex(/^[a-zA-Z0-9._-]+$/).optional(),
  FEISHU_APP_ID: z.string().max(200).optional(),
  FEISHU_APP_SECRET: z.string().max(512).optional(),
  DEEPSEEK_API_KEY: z.string().max(512).optional(), DEEPSEEK_MODEL: model.optional(),
  ALIYUN_API_KEY: z.string().max(512).optional(),
  ALIYUN_WORKSPACE_ID: z.string().max(120).regex(/^[a-zA-Z0-9-]*$/).optional(),
  ALIYUN_ASR_MODEL: model.optional(), ALIYUN_REGION: z.enum(["cn-beijing", "ap-southeast-1"]).optional(),
  MINIMAX_API_KEY: z.string().max(512).optional(), MINIMAX_MODEL: model.optional(), MINIMAX_VOICE_ID: z.string().max(200).optional(),
  bindings: z.object({ text: z.enum(["openai", "deepseek"]), recognition: z.enum(["openai", "aliyun", "browser", "off"]), synthesis: z.enum(["minimax", "openai", "off"]) }).strict().optional(),
}).strict();
const checkSchema = z.object({ authenticationAt: z.string().optional(), callAt: z.string().optional(), callCapability: z.enum(["text", "synthesis", "recognition"]).optional(), latencyMs: z.number().optional() });
const storedSchema = configSchema.extend({ checks: z.partialRecord(z.enum(["openai", "deepseek", "aliyun", "minimax"]), checkSchema).optional() });
const file = path.join(process.env.SPEECH_COACH_DATA_DIR ?? path.join(process.cwd(), "local-data"), "api-config.json");
export function resolveConfig(stored: z.infer<typeof storedSchema>, env: Record<string, string | undefined> = process.env) {
  const value = {
    version: 2 as const,
    OPENAI_API_KEY: stored.OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? "",
    OPENAI_REALTIME_MODEL: stored.OPENAI_REALTIME_MODEL ?? env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
    OPENAI_REVIEW_MODEL: stored.OPENAI_REVIEW_MODEL ?? env.OPENAI_REVIEW_MODEL ?? "gpt-5-mini",
    DEEPSEEK_API_KEY: stored.DEEPSEEK_API_KEY ?? env.DEEPSEEK_API_KEY ?? "",
    DEEPSEEK_MODEL: stored.DEEPSEEK_MODEL ?? env.DEEPSEEK_MODEL ?? "deepseek-flash",
    ALIYUN_API_KEY: stored.ALIYUN_API_KEY ?? env.ALIYUN_API_KEY ?? "",
    ALIYUN_WORKSPACE_ID: stored.ALIYUN_WORKSPACE_ID ?? env.ALIYUN_WORKSPACE_ID ?? "",
    ALIYUN_ASR_MODEL: stored.ALIYUN_ASR_MODEL ?? env.ALIYUN_ASR_MODEL ?? "qwen-audio-3.1-asr-flash-streaming",
    ALIYUN_REGION: stored.ALIYUN_REGION ?? "cn-beijing" as const,
    MINIMAX_API_KEY: stored.MINIMAX_API_KEY ?? env.MINIMAX_API_KEY ?? "",
    MINIMAX_MODEL: stored.MINIMAX_MODEL ?? env.MINIMAX_MODEL ?? "speech-2.8-turbo",
    MINIMAX_VOICE_ID: stored.MINIMAX_VOICE_ID ?? env.MINIMAX_VOICE_ID ?? "",
    FEISHU_APP_ID: stored.FEISHU_APP_ID ?? env.FEISHU_APP_ID ?? "",
    FEISHU_APP_SECRET: stored.FEISHU_APP_SECRET ?? env.FEISHU_APP_SECRET ?? "",
    checks: (stored.checks ?? {}) as Partial<Record<ProviderId, ProviderCheck>>,
  };
  // Legacy OpenAI installations keep their routing; adding a key never switches providers.
  return { ...value, bindings: stored.bindings ?? (value.OPENAI_API_KEY
    ? { text: "openai", recognition: "openai", synthesis: "openai" } as const
    : { text: "deepseek", recognition: "aliyun", synthesis: "minimax" } as const) };
}
export async function getConfig() {
  let stored: z.infer<typeof storedSchema> = {};
  try { stored = storedSchema.parse(JSON.parse(await readFile(file, "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return resolveConfig(stored);
}
export type ServerConfig = Awaited<ReturnType<typeof getConfig>>;
export function isLocalConfigRequest(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return false;
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin !== `${url.protocol}//${host}`) return false;
  return !origin || origin === `${url.protocol}//${host}`;
}
// The custom server and Next route bundles share a process but load separate copies of this module.
const writes = globalThis as typeof globalThis & { speechCoachConfigWrite?: Promise<unknown> };
function mutate(change: (config: ServerConfig) => void) {
  const job = (writes.speechCoachConfigWrite ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = await getConfig(); change(next);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await rename(temporary, file);
  });
  writes.speechCoachConfigWrite = job; return job;
}
export async function saveConfig(update: z.infer<typeof configSchema>) {
  return mutate(next => {
    for (const id of ["openai", "deepseek", "aliyun", "minimax"] as const) {
      if (Object.keys(update).some(key => key.startsWith(id.toUpperCase()) && update[key as keyof typeof update] !== next[key as keyof ServerConfig])) delete next.checks[id];
    }
    Object.assign(next, update, { version: 2 });
  });
}
export async function recordProviderCheck(id: ProviderId, actual: boolean, latencyMs?: number, callCapability: ProviderCheck["callCapability"] = "text") {
  return mutate(config => { config.checks[id] = { ...config.checks[id], authenticationAt: new Date().toISOString(), ...(actual ? { callAt: new Date().toISOString(), latencyMs, callCapability } : {}) }; });
}
export async function configStatus(): Promise<SettingsStatus> {
  const v = await getConfig();
  return { version: 2, openai: Boolean(v.OPENAI_API_KEY), feishu: Boolean(v.FEISHU_APP_ID && v.FEISHU_APP_SECRET), realtimeModel: v.OPENAI_REALTIME_MODEL, reviewModel: v.OPENAI_REVIEW_MODEL,
    bindings: v.bindings, models: { deepseek: v.DEEPSEEK_MODEL, aliyun: v.ALIYUN_ASR_MODEL, minimax: v.MINIMAX_MODEL }, region: v.ALIYUN_REGION, voice: v.MINIMAX_VOICE_ID,
    providers: {
      openai: { saved: Boolean(v.OPENAI_API_KEY), checks: v.checks.openai ?? {} },
      deepseek: { saved: Boolean(v.DEEPSEEK_API_KEY), checks: v.checks.deepseek ?? {} },
      aliyun: { saved: Boolean(v.ALIYUN_API_KEY && v.ALIYUN_WORKSPACE_ID), checks: v.checks.aliyun ?? {} },
      minimax: { saved: Boolean(v.MINIMAX_API_KEY), checks: v.checks.minimax ?? {} },
    },
  };
}
