import { z } from "zod";
import type { ServerConfig } from "../server-config";
import type { SpeechSynthesizer, VoiceOption } from "./contracts";
const minimaxBase = "https://api.minimaxi.com/v1";
const baseResponse = z.object({ base_resp: z.object({ status_code: z.number(), status_msg: z.string().optional() }) });
async function minimax(config: ServerConfig, path: string, body: object, signal?: AbortSignal) {
  if (!config.MINIMAX_API_KEY) throw new Error("请先保存 MiniMax Key");
  const response = await fetch(`${minimaxBase}/${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${config.MINIMAX_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => null);
  const envelope = baseResponse.safeParse(data);
  if (!response.ok) throw new Error(envelope.success && envelope.data.base_resp.status_msg ? envelope.data.base_resp.status_msg : `MiniMax 调用失败 (${response.status})`);
  if (!envelope.success) throw new Error("MiniMax 返回格式无法识别");
  if (envelope.data.base_resp.status_code !== 0) throw new Error(envelope.data.base_resp.status_msg || "MiniMax 未通过：请检查密钥、额度和音色权限");
  return data;
}
export async function getVoices(config: ServerConfig, signal?: AbortSignal): Promise<VoiceOption[]> {
  const data = await minimax(config, "get_voice", { voice_type: "system" }, signal);
  return z.object({ system_voice: z.array(z.object({ voice_id: z.string(), voice_name: z.string() })) }).parse(data).system_voice.map(v => ({ id: v.voice_id, name: v.voice_name }));
}
export function createSynthesizer(config: ServerConfig): SpeechSynthesizer {
  return { async synthesize(text, language, signal) {
    if (config.bindings.synthesis === "off") throw new Error("配音已关闭");
    if (config.bindings.synthesis === "openai") {
      if (!config.OPENAI_API_KEY) throw new Error("请先保存 OpenAI Key");
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST", headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "marin", input: text, response_format: "mp3" }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`OpenAI 配音失败 (${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    }
    if (!config.MINIMAX_VOICE_ID) throw new Error("请在 API 配置里选择并保存音色");
    const data = await minimax(config, "t2a_v2", {
      model: config.MINIMAX_MODEL, text, stream: false, output_format: "hex", language_boost: language === "en-US" ? "English" : "Chinese",
      voice_setting: { voice_id: config.MINIMAX_VOICE_ID, speed: 1, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
    }, signal);
    const hex = z.object({ data: z.object({ audio: z.string().min(2).max(16000000).regex(/^(?:[a-fA-F0-9]{2})+$/) }) }).parse(data).data.audio;
    return new Uint8Array(Buffer.from(hex, "hex"));
  } };
}
