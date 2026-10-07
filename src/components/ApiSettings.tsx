"use client";
import { useEffect, useState } from "react";
import { KeyRound, Save, PlugZap, Trash2 } from "lucide-react";
type Status = { openai: boolean; feishu: boolean; realtimeModel: string; reviewModel: string };
export function ApiSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [key, setKey] = useState("");
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/settings").then(r => r.json()).then(value => { if (value.error) setMessage(value.error); else setStatus(value); }).catch(() => setMessage("无法读取配置")); }, []);
  async function request(url: string, body: object) {
    setBusy(true);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (url === "/api/settings") { setStatus(data); setKey(""); setAppId(""); setSecret(""); }
      setMessage(data.message || "配置已保存，下次练习立即生效");
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }
  return <section className="api-settings">
    <h2><KeyRound size={20} /> API 配置</h2>
    <p>密钥只保存到本机服务端文件，不会写入浏览器存储或公开仓库。文件未加密，请使用你信任的本机账户。</p>
    <div className="capability-row"><strong>视频与表情分析</strong><span>不需要 Key · MediaPipe 本地处理 · 仅首次加载需联网</span></div>
    <div className="capability-row"><strong>浏览器语音跟随</strong><span>不需要 Key · 依赖浏览器语音服务与网络，内嵌浏览器可能不支持</span></div>
    <div className="capability-row"><strong>OpenAI 语音与教练</strong><span>{status?.openai ? "密钥已配置（尚不代表调用已验证）" : "未配置"} · 麦克风音频会发送到 OpenAI，视频不上传</span></div>
    <label>OpenAI API Key<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={status?.openai ? "已保存，留空保持原密钥" : "粘贴 API Key"} /></label>
    <p><a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">创建 OpenAI API Key</a> · 同一密钥用于语音跟随、实时听众、目标整理和复盘。</p>
    <details><summary>模型设置</summary><label>实时模型<input value={status?.realtimeModel ?? ""} onChange={e => setStatus(s => s ? { ...s, realtimeModel: e.target.value } : s)} /></label><label>文本模型<input value={status?.reviewModel ?? ""} onChange={e => setStatus(s => s ? { ...s, reviewModel: e.target.value } : s)} /></label></details>
    <details><summary>飞书连接 · {status?.feishu ? "已配置" : "可选"}</summary><p>只在导入飞书文档时需要 App ID 和 App Secret，并授权应用读取目标文档。</p><label>App ID<input value={appId} onChange={e => setAppId(e.target.value)} /></label><label>App Secret<input type="password" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} placeholder="留空保持原值" /></label><button className="button ghost" disabled={busy} onClick={() => void request("/api/settings", { FEISHU_APP_ID: "", FEISHU_APP_SECRET: "" })}><Trash2 size={16} />清除飞书配置</button></details>
    <div className="settings-actions"><button className="button primary" disabled={busy || !status} onClick={() => void request("/api/settings", { ...(key.trim() ? { OPENAI_API_KEY: key.trim() } : {}), ...(appId.trim() ? { FEISHU_APP_ID: appId.trim() } : {}), ...(secret.trim() ? { FEISHU_APP_SECRET: secret.trim() } : {}), OPENAI_REALTIME_MODEL: status?.realtimeModel, OPENAI_REVIEW_MODEL: status?.reviewModel })}><Save size={16} />保存</button><button className="button secondary" disabled={busy || !status?.openai} onClick={() => void request("/api/settings/test", {})}><PlugZap size={16} />测试已保存密钥</button><button className="button ghost" disabled={busy || !status?.openai} onClick={() => void request("/api/settings", { OPENAI_API_KEY: "" })}><Trash2 size={16} />清除 Key</button></div>
    <p role="status">{busy ? "正在处理…" : message}</p>
  </section>;
}
