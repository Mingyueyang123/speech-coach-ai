"use client";
import { useEffect, useRef, useState } from "react";
import { KeyRound, Save, PlugZap, Trash2, Play, Square } from "lucide-react";
import { VoiceInput } from "./VoiceInput";
import type { ProviderId, SettingsStatus, VoiceOption } from "@/lib/providers/contracts";

const NAMES: Record<ProviderId, string> = { aliyun: "阿里云 · 连续语音识别", deepseek: "DeepSeek · 文本教练", minimax: "MiniMax · 听众配音", openai: "OpenAI · 语音与文本" };
const KEY_FIELDS = { aliyun: "ALIYUN_API_KEY", deepseek: "DEEPSEEK_API_KEY", minimax: "MINIMAX_API_KEY", openai: "OPENAI_API_KEY" };
export function ApiSettings() {
  const [status, setStatus] = useState<SettingsStatus | null>(null), [selected, setSelected] = useState<ProviderId>("aliyun");
  const [values, setValues] = useState<Record<string, string>>({}), [voices, setVoices] = useState<VoiceOption[]>([]);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [language, setLanguage] = useState<"zh-CN" | "en-US">("zh-CN");
  const [micResult, setMicResult] = useState(""), [micLatency, setMicLatency] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null), audioUrl = useRef<string | null>(null), pending = useRef<AbortController | null>(null);
  const refresh = async () => { const r = await fetch("/api/settings"); if (!r.ok) throw new Error("无法读取配置"); setStatus(await r.json()); };
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/settings", { signal: controller.signal }).then(r => { if (!r.ok) throw new Error("无法读取配置"); return r.json(); }).then(setStatus).catch(e => { if (!controller.signal.aborted) setMessage(e.message); });
    return () => { controller.abort(); pending.current?.abort(); audio.current?.pause(); if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); };
  }, []);
  function stopAudio() { pending.current?.abort(); audio.current?.pause(); audio.current = null; if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); audioUrl.current = null; }
  async function request(url: string, body: object) {
    stopAudio(); const controller = new AbortController(); pending.current = controller; setBusy(true); setMessage("");
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      if (!r.ok) throw new Error((await r.json()).error || "调用未成功");
      if (r.headers.get("Content-Type")?.startsWith("audio/")) {
        const blob = await r.blob(); controller.signal.throwIfAborted();
        audioUrl.current = URL.createObjectURL(blob); audio.current = new Audio(audioUrl.current);
        await audio.current.play(); setMessage(`实际配音调用通过 · ${r.headers.get("X-Latency-Ms")} ms`);
      } else {
        const data = await r.json();
        if (data.voices) { setVoices(data.voices); setMessage("音色列表已读取，认证通过"); }
        else setMessage(data.message || "已保存；下次连接使用新配置");
        if (url === "/api/settings") { setValues({}); setMicLatency(null); }
      }
      await refresh();
    } catch (e) { if (!controller.signal.aborted) setMessage(e instanceof Error ? e.message : "操作失败"); }
    finally { if (pending.current === controller) { setBusy(false); pending.current = null; } }
  }
  const field = (name: string, label: string, secret = false) => <label key={name}>{label}<input type={secret ? "password" : "text"} autoComplete="off" value={values[name] ?? ""} onChange={e => setValues(v => ({ ...v, [name]: e.target.value }))} placeholder="留空保留已保存值" /></label>;
  const providerStatus = status?.providers[selected];
  return <section className="api-settings">
    <h2><KeyRound size={20} /> API 配置</h2>
    <p>密钥仅存本机服务端，文件未加密。摄像头、录像和关键点不上传。</p>
    <div className="settings-actions"><button className="button secondary" disabled={busy} onClick={() => void request("/api/settings", { bindings: { text: "deepseek", recognition: "aliyun", synthesis: "minimax" } })}>使用国内组合</button><button className="button secondary" disabled={busy} onClick={() => void request("/api/settings", { bindings: { text: "openai", recognition: "openai", synthesis: "openai" } })}>使用 OpenAI</button></div>
    <div className="capability-row"><strong>当前分配</strong><span>识别 {status?.bindings.recognition} · 文本 {status?.bindings.text} · 配音 {status?.bindings.synthesis}</span></div>
    <div className="provider-options" role="tablist" aria-label="服务商">{(Object.keys(NAMES) as ProviderId[]).map(id => <button role="tab" aria-selected={selected === id} className={selected === id ? "active" : ""} key={id} onClick={() => { setSelected(id); setMessage(""); setMicResult(""); setMicLatency(null); }}><strong>{NAMES[id]}</strong><span>{!status?.providers[id].saved ? "未配置" : status.providers[id].checks.callAt ? `${status.providers[id].checks.callCapability === "recognition" ? "识别" : status.providers[id].checks.callCapability === "synthesis" ? "配音" : "文本"}实际调用通过` : status.providers[id].checks.authenticationAt ? "认证通过" : "已保存 · 未测试"}</span></button>)}</div>
    <section className="provider-detail" aria-label={NAMES[selected]}>
      <h3>{NAMES[selected]}</h3>
      <p>{selected === "aliyun" ? "阿里云接收麦克风音频。北京地域 Key 与 Workspace ID 必须匹配。" : selected === "deepseek" ? "DeepSeek 只接收当前目标、发言和相关资料片段。单独配置即可整理目标、素材及复盘。" : selected === "minimax" ? "MiniMax 只接收需要朗读的短文本。AI 合成声音，不是现场真人。" : "OpenAI 接收所选能力需要的麦克风音频或文本。不会收到摄像头画面。"}</p>
      {field(KEY_FIELDS[selected], "API Key", true)}
      {selected === "aliyun" && field("ALIYUN_WORKSPACE_ID", "Workspace ID")}
      {selected === "minimax" && <div className="voice-selection"><button className="button secondary" disabled={busy || !providerStatus?.saved} onClick={() => void request("/api/speech/voices", {})}><PlugZap size={16} />读取音色列表</button><label>听众音色<select value={values.MINIMAX_VOICE_ID ?? status?.voice ?? ""} onChange={e => setValues(v => ({ ...v, MINIMAX_VOICE_ID: e.target.value }))}><option value="">选择音色</option>{status?.voice && !voices.some(v => v.id === status.voice) && <option value={status.voice}>{status.voice}</option>}{voices.map(v => <option value={v.id} key={v.id}>{v.name}</option>)}</select></label></div>}
      <div className="settings-actions"><button className="button primary" disabled={busy || !status} onClick={() => void request("/api/settings", Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])))}><Save size={16} />保存</button><button className="button ghost" disabled={busy || !providerStatus?.saved} onClick={() => void request("/api/settings", { [KEY_FIELDS[selected]]: "" })}><Trash2 size={16} />清除 Key</button></div>
      <div className="provider-tests"><p>以下测试会连接所选服务；生成、试听和麦克风测试可能消耗额度。建议佩戴耳机。</p><div className="settings-actions"><select aria-label="测试语言" value={language} onChange={e => setLanguage(e.target.value as typeof language)}><option value="zh-CN">中文短测</option><option value="en-US">English test</option></select>
        {selected !== "aliyun" && <button className="button secondary" disabled={busy || !providerStatus?.saved} onClick={() => void request("/api/settings/test", { provider: selected, capability: "authentication", language })}><PlugZap size={16} />认证测试</button>}
        {(selected === "deepseek" || selected === "openai") && <button className="button secondary" disabled={busy || !providerStatus?.saved} onClick={() => void request("/api/settings/test", { provider: selected, capability: "text", language })}>短文本测试</button>}
        {(selected === "minimax" || selected === "openai") && <><button className="button secondary" disabled={busy || !providerStatus?.saved} onClick={() => void request("/api/settings/test", { provider: selected, capability: "synthesis", language })}><Play size={16} />音色试听</button><button className="icon-button" title="停止试听或取消请求" onClick={stopAudio}><Square size={16} /></button></>}
        {(selected === "aliyun" || selected === "openai") && <VoiceInput key={`${selected}:${language}`} provider={selected} language={language} disabled={!providerStatus?.saved} onText={text => setMicResult(text)} onVerified={setMicLatency} />}
      </div>{micLatency !== null && <p role="status">实际识别结果已收到 · 启动至首段文字 {micLatency} ms（包含等待开口时间）</p>}{micResult && <p>{micResult}</p>}</div>
    </section>
    <details><summary>高级设置 · 模型、地域、能力分配</summary>
      {status && <><label>文本服务<select value={status.bindings.text} onChange={e => setStatus({ ...status, bindings: { ...status.bindings, text: e.target.value as SettingsStatus["bindings"]["text"] } })}><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option></select></label><label>语音识别<select value={status.bindings.recognition} onChange={e => setStatus({ ...status, bindings: { ...status.bindings, recognition: e.target.value as SettingsStatus["bindings"]["recognition"] } })}><option value="aliyun">阿里云</option><option value="openai">OpenAI</option><option value="browser">浏览器语音服务（音频由浏览器服务处理）</option><option value="off">关闭</option></select></label><label>听众配音<select value={status.bindings.synthesis} onChange={e => setStatus({ ...status, bindings: { ...status.bindings, synthesis: e.target.value as SettingsStatus["bindings"]["synthesis"] } })}><option value="minimax">MiniMax</option><option value="openai">OpenAI</option><option value="off">仅文字</option></select></label>
        {field("DEEPSEEK_MODEL", `DeepSeek 模型 · ${status.models.deepseek}`)}{field("ALIYUN_ASR_MODEL", `阿里云模型 · ${status.models.aliyun}`)}{field("MINIMAX_MODEL", `MiniMax 模型 · ${status.models.minimax}`)}{field("OPENAI_REALTIME_MODEL", `OpenAI 实时模型 · ${status.realtimeModel}`)}{field("OPENAI_REVIEW_MODEL", `OpenAI 文本模型 · ${status.reviewModel}`)}
        <label>阿里云地域<select value={status.region} onChange={e => setStatus({ ...status, region: e.target.value as SettingsStatus["region"] })}><option value="cn-beijing">北京</option><option value="ap-southeast-1">新加坡</option></select></label><button className="button secondary" disabled={busy} onClick={() => void request("/api/settings", { ...Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim())), bindings: status.bindings, ALIYUN_REGION: status.region })}><Save size={16} />保存高级设置</button></>}
    </details>
    <details><summary>飞书只读连接 · {status?.feishu ? "已配置" : "未配置"}</summary>{field("FEISHU_APP_ID", "App ID")}{field("FEISHU_APP_SECRET", "App Secret", true)}<div className="settings-actions"><button className="button secondary" disabled={busy} onClick={() => void request("/api/settings", Object.fromEntries(Object.entries(values).filter(([key, v]) => key.startsWith("FEISHU") && v.trim())))}><Save size={16} />保存飞书配置</button><button className="button ghost" disabled={busy} onClick={() => void request("/api/settings", { FEISHU_APP_ID: "", FEISHU_APP_SECRET: "" })}><Trash2 size={16} />清除</button></div></details>
    <div className="capability-row"><strong>视频与表情分析</strong><span>MediaPipe 本地处理 · 无需 Key</span></div>
    <p role="status">{busy ? "正在测试 / 保存…" : message}</p>
  </section>;
}
