import { connectRealtime } from "./realtime-client";
import { getScenarioByKind } from "./scenarios";
import { TranscriptAccumulator } from "./providers/speech-protocol";
import type { ProviderBindings, SpeechRecognizer, SpeechUpdate } from "./providers/contracts";
import type { TrainingLanguage } from "./types";

export interface RecognitionOptions {
  provider: ProviderBindings["recognition"]; stream: MediaStream; language: TrainingLanguage;
  signal: AbortSignal; onUpdate(update: SpeechUpdate): void; onStatus(message: string): void; onError(message: string): void;
}
interface BrowserRecognition {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
  start(): void; stop(): void;
}
let activeOwner: symbol | null = null;
export async function startRecognizer(options: RecognitionOptions): Promise<SpeechRecognizer> {
  if (activeOwner) throw new Error("已有语音识别进行中，请先停止当前练习或语音输入");
  const owner = Symbol(); activeOwner = owner;
  const release = () => { if (activeOwner === owner) activeOwner = null; options.signal.removeEventListener("abort", release); };
  options.signal.addEventListener("abort", release, { once: true });
  try {
    const connection = await startSelectedRecognizer({ ...options, onError: message => { release(); options.onError(message); } });
    return { stop: async () => { try { await connection.stop(); } finally { release(); } } };
  } catch (error) { release(); throw error; }
}
async function startSelectedRecognizer(options: RecognitionOptions): Promise<SpeechRecognizer> {
  options.signal.throwIfAborted();
  const sessionId = crypto.randomUUID();
  if (options.provider === "off") throw new Error("语音识别已关闭，可在 API 配置中选择服务");
  if (options.provider === "browser") {
    const w = window as typeof window & { SpeechRecognition?: new () => BrowserRecognition; webkitSpeechRecognition?: new () => BrowserRecognition };
    const Constructor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Constructor) throw new Error("当前浏览器不支持语音识别，请主动选择其他识别服务");
    const recognition = new Constructor(); let stopped = false, epoch = 0;
    const finals = new Set<string>();
    recognition.lang = options.language; recognition.interimResults = true; recognition.continuous = true;
    recognition.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], id = `${sessionId}:browser:${epoch}:${i}`;
        if (finals.has(id)) continue;
        if (r.isFinal) finals.add(id);
        options.onUpdate({ id, text: r[0].transcript, final: r.isFinal });
      }
    };
    recognition.onerror = () => { stopped = true; options.onError("浏览器识别中断，请主动重连"); };
    recognition.onend = () => { if (!stopped) { epoch++; try { recognition.start(); } catch { options.onError("浏览器识别已断开"); } } };
    const stop = async () => { stopped = true; recognition.onend = null; recognition.onresult = null; recognition.stop(); options.signal.removeEventListener("abort", abort); };
    const abort = () => { void stop(); };
    options.signal.addEventListener("abort", abort, { once: true });
    recognition.start(); options.onStatus("浏览器识别已连接");
    return { stop };
  }
  if (options.provider === "openai") {
    let index = 0;
    const connection = await connectRealtime({ stream: options.stream, scenario: getScenarioByKind("live-speaking", options.language), intensity: "balanced", knowledgeContext: "", signal: options.signal,
      onTurn: () => {}, onStatus: options.onStatus, onError: () => options.onError("OpenAI 识别中断，请主动重连"),
      onTranscript: (text, final) => { options.onUpdate({ id: `${sessionId}:openai:${index}`, text, final }); if (final) index++; },
    });
    const abort = () => connection.disconnect(); options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) { connection.disconnect(); options.signal.throwIfAborted(); }
    return { stop: async () => { options.signal.removeEventListener("abort", abort); connection.disconnect(); } };
  }
  return startAliyun(options);
}

async function startAliyun(options: RecognitionOptions): Promise<SpeechRecognizer> {
  const response = await fetch("/api/speech/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "aliyun" }), signal: options.signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "语音网关无法连接");
  options.signal.throwIfAborted();
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/speech/stream`);
  let context: AudioContext | undefined, source: MediaStreamAudioSourceNode | undefined, worklet: AudioWorkletNode | undefined;
  let stopping = false, connected = false, settled = false;
  const accumulator = new TranscriptAccumulator();
  let closeResolve: (() => void) | undefined;
  const closed = new Promise<void>(resolve => { closeResolve = resolve; });
  function captureOff() { if (worklet) { worklet.port.onmessage = null; worklet.disconnect(); } source?.disconnect(); if (context && context.state !== "closed") void context.close(); }
  const abort = () => { stopping = true; captureOff(); socket.close(); };
  options.signal.addEventListener("abort", abort, { once: true });
  const setup = new Promise<SpeechRecognizer>((resolve, reject) => {
    const timer = setTimeout(() => fail("识别连接超时，请重连"), 18000);
    const fail = (message: string) => {
      clearTimeout(timer); captureOff(); socket.close();
      if (!settled) { settled = true; reject(new Error(message)); }
      else if (!stopping) options.onError(message);
    };
    socket.onopen = () => socket.send(JSON.stringify({ type: "start", token: data.token, language: options.language, format: "pcm_s16le", sampleRate: 16000, channels: 1 }));
    socket.onerror = () => fail("语音网关连接失败，请检查本机服务");
    socket.onclose = () => {
      clearTimeout(timer); captureOff(); options.signal.removeEventListener("abort", abort); closeResolve?.();
      if (!settled) { settled = true; reject(new Error("语音连接已关闭")); }
      else if (!stopping) options.onError("识别断线，文字已保留，请重连");
    };
    socket.onmessage = async event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "error") { fail(message.message); return; }
        if (message.type === "transcript") {
          const update = accumulator.accept(message);
          if (update) options.onUpdate(update);
        }
        if (message.type === "ready" && !connected && !stopping) {
          connected = true; context = new AudioContext();
          await context.audioWorklet.addModule("/pcm-worklet.js");
          if (stopping || options.signal.aborted || socket.readyState !== WebSocket.OPEN) { abort(); return; }
          // Construct a new stream with only the mic track, never the recorder's video or playback output.
          source = context.createMediaStreamSource(new MediaStream(options.stream.getAudioTracks()));
          worklet = new AudioWorkletNode(context, "pcm-capture");
          worklet.port.onmessage = frame => {
            if (socket.readyState === WebSocket.OPEN && !stopping) {
              if (socket.bufferedAmount > 64000) { fail("上传音频积压，已暂停识别，请重连"); return; }
              socket.send(frame.data);
            }
          };
          source.connect(worklet); worklet.connect(context.destination); // Worklet output is silence.
          await context.resume(); clearTimeout(timer);
          settled = true; options.onStatus("阿里云实时识别已连接");
          resolve({ stop: async () => {
            if (stopping) return;
            stopping = true; captureOff();
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
            const timeout = setTimeout(() => socket.close(), 2000);
            await closed; clearTimeout(timeout);
          } });
        }
      } catch { fail("语音处理失败，请检查音频设备或重连"); }
    };
  });
  return setup;
}
