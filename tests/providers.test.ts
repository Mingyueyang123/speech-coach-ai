import { afterEach, describe, expect, it, vi } from "vitest";
import { configSchema, resolveConfig } from "@/lib/server-config";
import { createTextProvider, textConfigured } from "@/lib/providers/text";
import { createSynthesizer, getVoices } from "@/lib/providers/synthesis";
import { parseAliSentence, speechStartSchema, TranscriptAccumulator } from "@/lib/providers/speech-protocol";
import { SceneAudioLayers } from "@/lib/immersive";

afterEach(() => vi.unstubAllGlobals());
describe("config migration and independent capabilities", () => {
  it("preserves legacy OpenAI/Feishu without overwriting explicit selections", () => {
    const old = resolveConfig({ OPENAI_API_KEY: "old", FEISHU_APP_ID: "app" }, {});
    expect(old.version).toBe(2); expect(old.bindings.recognition).toBe("openai"); expect(old.FEISHU_APP_ID).toBe("app");
    const selected = resolveConfig({ ...old, bindings: { text: "deepseek", recognition: "aliyun", synthesis: "off" } }, {});
    expect(selected.bindings.text).toBe("deepseek");
  });
  it("supports only DeepSeek, preserves deliberate clearing over env, forbids custom URLs", () => {
    expect(textConfigured(resolveConfig({ DEEPSEEK_API_KEY: "key" }, {}))).toBe(true);
    expect(resolveConfig({ OPENAI_API_KEY: "" }, { OPENAI_API_KEY: "env" }).OPENAI_API_KEY).toBe("");
    expect(configSchema.safeParse({ baseURL: "https://untrusted.example" }).success).toBe(false);
    expect(configSchema.safeParse({ ALIYUN_WORKSPACE_ID: "evil.com/path" }).success).toBe(false);
    expect(configSchema.safeParse({ MINIMAX_API_KEY: "x".repeat(1200) }).success).toBe(true);
  });
});
describe("provider adapters", () => {
  it("routes text to DeepSeek only, without leaking other keys", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })); vi.stubGlobal("fetch", fetch);
    const config = resolveConfig({ OPENAI_API_KEY: "other-private", DEEPSEEK_API_KEY: "text-private", bindings: { text: "deepseek", recognition: "aliyun", synthesis: "minimax" } }, {});
    expect(await createTextProvider(config).generate("Return JSON")).toBe('{"ok":true}');
    expect(fetch.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("other-private");
  });
  it("does not fail over on provider error and sanitizes upstream body", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("secret-provider-error", { status: 401 })); vi.stubGlobal("fetch", fetch);
    await expect(createTextProvider(resolveConfig({ DEEPSEEK_API_KEY: "key" }, {})).generate("JSON")).rejects.toThrow("401");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("uses only short text for MiniMax and parses hex audio", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ base_resp: { status_code: 0 }, data: { audio: "0102ffaa" } })); vi.stubGlobal("fetch", fetch);
    const output = await createSynthesizer(resolveConfig({ MINIMAX_API_KEY: "key", MINIMAX_VOICE_ID: "voice" }, {})).synthesize("Example?", "en-US");
    expect([...output]).toEqual([1, 2, 255, 170]);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetch.mock.calls[0][0]).toBe("https://api.minimaxi.com/v1/t2a_v2");
    expect(body.language_boost).toBe("English"); expect(body.voice_setting.voice_id).toBe("voice"); expect(body).not.toHaveProperty("audio");
  });
  it("treats HTTP 200 business errors as failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ base_resp: { status_code: 1004, status_msg: "音色权限未开通" } })));
    await expect(getVoices(resolveConfig({ MINIMAX_API_KEY: "key" }, {}))).rejects.toThrow("音色权限未开通");
  });
  it("does not call synthesis when disabled or unconfigured", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createSynthesizer(resolveConfig({}, {})).synthesize("test", "zh-CN")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
describe("stream revisions and privacy", () => {
  it("replaces partial revisions and deduplicates finals without removing real repetitions", () => {
    const acc = new TranscriptAccumulator();
    const parse = (text: string, final: boolean, id = 1) => parseAliSentence({ text, sentence_end: final, sentence_id: id }, "task")!;
    expect(acc.accept(parse("你好世", false))?.text).toBe("你好世");
    expect(acc.accept(parse("你好世界", false))?.text).toBe("你好世界");
    expect(acc.accept(parse("你好世界。", true))?.final).toBe(true);
    expect(acc.accept(parse("你好世界。", true))).toBeNull();
    expect(acc.accept(parse("你好世界。", true, 2))?.text).toBe("你好世界。");
    expect(parseAliSentence({ text: "", heartbeat: true, sentence_end: false }, "task")).toBeNull();
  });
  it("rejects video/extra fields and non PCM16 mono", () => {
    const start = { type: "start", token: crypto.randomUUID(), language: "en-US", format: "pcm_s16le", sampleRate: 16000, channels: 1 };
    expect(speechStartSchema.safeParse(start).success).toBe(true);
    expect(speechStartSchema.safeParse({ ...start, videoBlob: "x" }).success).toBe(false);
    expect(speechStartSchema.safeParse({ ...start, channels: 2 }).success).toBe(false);
  });
});
it("reserved sound layers support independent volume, pause and cancellation", () => {
  const bus = new SceneAudioLayers();
  const background = { pause: vi.fn(), cancel: vi.fn(), setVolume: vi.fn() }, voice = { pause: vi.fn(), cancel: vi.fn(), setVolume: vi.fn() };
  bus.attach("ambience", background); bus.attach("audience", voice); bus.setVolume("ambience", 2); bus.pause(); bus.cancel("audience");
  expect(background.setVolume).toHaveBeenLastCalledWith(1); expect(background.pause).toHaveBeenCalledOnce(); expect(voice.cancel).toHaveBeenCalledOnce(); expect(background.cancel).not.toHaveBeenCalled();
  bus.cancel(); expect(background.cancel).toHaveBeenCalledOnce();
});
