"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { startRecognizer } from "@/lib/speech-client";
import type { SettingsStatus, SpeechRecognizer } from "@/lib/providers/contracts";
import type { TrainingLanguage } from "@/lib/types";

interface VoiceInputProps { language: TrainingLanguage; onText(text: string): void; disabled?: boolean; provider?: SettingsStatus["bindings"]["recognition"]; onVerified?: (milliseconds: number) => void }
export function VoiceInput(props: VoiceInputProps) { return <VoiceCapture key={`${props.language}:${props.provider ?? "selected"}`} {...props} />; }
function VoiceCapture({ language, onText, disabled, provider, onVerified }: VoiceInputProps) {
  const [active, setActive] = useState(false), [status, setStatus] = useState("");
  const stream = useRef<MediaStream | null>(null), recognizer = useRef<SpeechRecognizer | null>(null), controller = useRef<AbortController | null>(null);
  const onTextRef = useRef(onText); useEffect(() => { onTextRef.current = onText; }, [onText]);
  const stop = async () => {
    if (!recognizer.current) controller.current?.abort();
    await recognizer.current?.stop(); recognizer.current = null;
    controller.current?.abort(); stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
    setActive(false);
  };
  useEffect(() => () => { controller.current?.abort(); void recognizer.current?.stop(); stream.current?.getTracks().forEach(t => t.stop()); }, []);
  async function toggle() {
    if (active) { await stop(); setStatus("语音已停止，文字待确认"); return; }
    const ctrl = new AbortController(); controller.current = ctrl; setActive(true);
    try {
      const config = await fetch("/api/settings", { signal: ctrl.signal }).then(r => r.json()) as SettingsStatus;
      const selected = provider ?? config.bindings.recognition;
      if (selected === "off") throw new Error("请在 API 配置中选择语音识别服务");
      if ((selected === "aliyun" || selected === "openai") && !config.providers[selected].saved) throw new Error(`请先在 API 配置中保存${selected === "aliyun" ? "阿里云 Key 和 Workspace ID" : "OpenAI Key"}`);
      setStatus(`连接 ${selected}；音频将发送给该识别服务`);
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (ctrl.signal.aborted) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media; let first = true; const start = performance.now();
      const connection = await startRecognizer({ provider: selected, stream: media, language, signal: ctrl.signal, onStatus: setStatus,
        onError: message => { setStatus(message); void stop(); },
        onUpdate: update => {
          if (ctrl.signal.aborted) return;
          if (first) { first = false; onVerified?.(Math.round(performance.now() - start)); }
          if (update.final) { onTextRef.current(update.text); setStatus("正在听；文字待确认发送"); } else setStatus(update.text);
        },
      });
      if (ctrl.signal.aborted) await connection.stop(); else recognizer.current = connection;
    } catch (error) { if (!ctrl.signal.aborted) setStatus(error instanceof Error ? error.message : "语音无法启动"); await stop(); }
  }
  return <div className="voice-input"><button type="button" className={`icon-button ${active ? "recording" : ""}`} aria-label={active ? "停止语音输入" : "语音输入"} title={active ? "停止语音输入" : "语音输入（音频发送至所选识别服务，可能消耗额度）"} disabled={disabled && !active} onClick={() => void toggle()}>{active ? <Square size={18} /> : <Mic size={18} />}</button>{status && <span role="status">{status}</span>}</div>;
}
