"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Check, ChevronDown, CircleStop, FileText, Headphones, Languages, Mic, Minus, Play, Plus, Settings, Target, Timer, Users, X } from "lucide-react";
import { FloatingTools } from "./FloatingTools";
import type { AudienceIntensity, PracticeScenario, ScrollMode } from "@/lib/types";
import type { PracticeDevices } from "@/lib/media-devices";
import { routeAudio } from "@/lib/media-devices";

type Menu = "language" | "scenario" | "audience" | "microphone" | "camera" | "output" | "script" | "timer";
interface Props {
  editScript?: () => void;
  importScript?: () => void;
  scenario: PracticeScenario;
  practicing: boolean;
  intensity: AudienceIntensity;
  chooseScenario: (kind: PracticeScenario["kind"], language: PracticeScenario["language"]) => void;
  setIntensity: (value: AudienceIntensity) => void;
  devices: PracticeDevices;
  setDevices: (devices: PracticeDevices) => void;
  target: number;
  setTarget: (seconds: number) => void;
  scriptVisible: boolean;
  timerVisible: boolean;
  cameraPanelVisible: boolean;
  audiencePanelVisible: boolean;
  scriptPinned: boolean;
  timerPinned: boolean;
  toggleScript: () => void;
  toggleTimer: () => void;
  toggleCameraPanel: () => void;
  toggleAudiencePanel: () => void;
  toggleScriptPinned: () => void;
  toggleTimerPinned: () => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  scrollMode: ScrollMode;
  changeScrollMode: (mode: ScrollMode) => void;
  scrollSpeed: number;
  setScrollSpeed: (speed: number) => void;
  start: () => void;
  stop: () => void;
  startRequested: boolean;
  cancelStart: () => void;
  requestStart: () => void;
}

export function PracticeDock(p: Props) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [status, setStatus] = useState("");
  const [starting, setStarting] = useState(false);
  const [speakerSelection, setSpeakerSelection] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testingAudio, setTestingAudio] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const mounted = useRef(true);
  const testAudio = useRef<HTMLAudioElement | null>(null);
  const testUrl = useRef<string | null>(null);
  const testController = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => void navigator.mediaDevices?.enumerateDevices().then(list => { if (mounted.current) { setDevices(list); setSpeakerSelection(typeof HTMLMediaElement.prototype.setSinkId === "function"); } }).catch(() => {});
    refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => { mounted.current = false; navigator.mediaDevices?.removeEventListener("devicechange", refresh); testController.current?.abort(); testAudio.current?.pause(); if (testUrl.current) URL.revokeObjectURL(testUrl.current); };
  }, []);
  const close = () => { setMenu(null); };
  useEffect(() => {
    const documents = [document, root.current?.ownerDocument].filter((d, index, all): d is Document => !!d && all.indexOf(d) === index);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(null); trigger.current?.focus(); } };
    const outside = (event: PointerEvent) => { if (root.current && !event.composedPath().includes(root.current)) setMenu(null); };
    documents.forEach(doc => { doc.addEventListener("keydown", key); doc.addEventListener("pointerdown", outside); });
    return () => { documents.forEach(doc => { doc.removeEventListener("keydown", key); doc.removeEventListener("pointerdown", outside); }); if (menu) trigger.current?.focus(); };
  }, [menu]);
  const updateDevice = (patch: Partial<PracticeDevices>) => { p.setDevices({ ...p.devices, ...patch }); setStatus(""); };
  async function authorize(kind: "microphone" | "camera") {
    setBusy(true); setStatus("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia(kind === "microphone" ? { audio: true } : { video: true });
      stream.getTracks().forEach(track => track.stop());
      const list = await navigator.mediaDevices.enumerateDevices();
      if (mounted.current) { setDevices(list); setStatus("权限已开启"); }
    } catch { if (mounted.current) setStatus("无法读取设备，请检查浏览器权限和安全连接。"); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function testOutput() {
    if (testingAudio) { testController.current?.abort(); testAudio.current?.pause(); setTestingAudio(false); return; }
    setTestingAudio(true); setStatus("");
    const controller = new AbortController(); testController.current = controller;
    try {
      // A local WAV tone: no network, synthesis API, or microphone capture.
      const length = 8000, buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer);
      const write = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
      write(0, "RIFF"); view.setUint32(4, 36 + length * 2, true); write(8, "WAVEfmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, length * 2, true);
      for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * 440 / 16000) * 3000 * Math.min(1, i / 300, (length - i) / 300), true);
      if (testUrl.current) URL.revokeObjectURL(testUrl.current);
      const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" })); testUrl.current = url;
      const audio = new Audio(url); testAudio.current = audio;
      audio.onended = () => { if (mounted.current) setTestingAudio(false); };
      await routeAudio(audio, p.devices.outputId);
      controller.signal.throwIfAborted();
      await audio.play();
    } catch (error) { setTestingAudio(false); if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "无法试听"); }
  }
  function item(value: string, label: string, selected: boolean, action: () => void, disabled = false) {
    return <button key={value} className="dock-option" role="menuitemradio" aria-checked={selected} disabled={disabled} onClick={action}><span>{label}</span>{selected && <Check size={17} />}</button>;
  }
  const labels = { language: "训练语言", scenario: "场景", audience: "听众强度", microphone: "语音接入", camera: "相机接入", output: "音频输出", script: "台词", timer: "计时" };
  const icons = { language: Languages, scenario: Target, audience: Users, microphone: Mic, camera: Camera, output: Headphones, script: FileText, timer: Timer };
  const scenarioLabels = { "investor-pitch": "投资人 Pitch", "client-roadshow": "客户路演", "live-speaking": "线下演讲 / 主持" } as const;
  const intensityLabels = { friendly: "友好", balanced: "正常", challenging: "挑战" } as const;
  const deviceMenu = menu === "microphone" || menu === "camera" || menu === "output";
  const kind = menu === "microphone" ? "audioinput" : menu === "camera" ? "videoinput" : "audiooutput";
  const selectedDevice = menu === "microphone" ? p.devices.microphoneId : menu === "camera" ? p.devices.cameraId : p.devices.outputId;
  return <>
    <div className="practice-dock-shell">
      <FloatingTools title="练习工具栏" dock overlay={p.startRequested && <div className="modal-backdrop" onKeyDown={event => { if (event.key === "Escape" && !starting) p.cancelStart(); }}><section className="start-practice-dialog" role="dialog" aria-modal="true" aria-labelledby="start-heading"><div className="dock-popover-head"><h2 id="start-heading">本轮台词怎么走？</h2><button className="icon-button" title="取消开始" disabled={starting} onClick={p.cancelStart}><X size={18} /></button></div><div className="segmented two">{(["speech", "manual"] as const).map(mode => <button key={mode} autoFocus={mode === p.scrollMode} aria-pressed={p.scrollMode === mode} className={p.scrollMode === mode ? "active" : ""} onClick={() => p.changeScrollMode(mode)}>{mode === "speech" ? <Mic size={18} /> : <Play size={18} />}{mode === "speech" ? "语音跟随" : "匀速滚动"}</button>)}</div><p>{p.scenario.language === "en-US" ? "English" : "中文"} · {p.target / 60} 分钟 · {p.devices.cameraEnabled ? "录像与录音" : "仅录音"}</p><button className="button primary" disabled={starting} onClick={async () => { setStarting(true); setMenu(null); try { await p.start(); } finally { setStarting(false); p.cancelStart(); } }}><Play size={18} />{starting ? "准备设备中" : "开始本轮"}</button></section></div>}>
        <div className="practice-dock" ref={root}>
          <button className="icon-button" title={collapsed ? "展开练习工具栏" : "收起练习工具栏"} aria-expanded={!collapsed} onClick={() => { setCollapsed(!collapsed); setMenu(null); }}>{collapsed ? <Settings size={20} /> : <Minus size={20} />}</button>
          {!collapsed && <div className="dock-buttons">{(Object.keys(labels) as Menu[]).map(key => { const Icon = icons[key]; return <button key={key} className={`dock-trigger ${menu === key ? "active" : ""}`} title={labels[key]} aria-label={labels[key]} aria-haspopup="menu" aria-expanded={menu === key} onClick={event => { trigger.current = event.currentTarget; setMenu(menu === key ? null : key); setStatus(""); }}><Icon size={19} /><span>{key === "language" ? (p.scenario.language === "en-US" ? "English" : "中文") : labels[key]}</span><ChevronDown size={12} /></button>; })}</div>}
          <button aria-label={p.practicing ? "结束练习" : "开始练习"} className={`button ${p.practicing ? "danger" : "primary"} dock-record`} disabled={starting} onClick={p.practicing ? p.stop : p.requestStart}>{p.practicing ? <CircleStop size={20} /> : <Play size={20} />}<span>{p.practicing ? "结束" : "练习"}</span></button>
          {menu && !collapsed && <div className="dock-popover" role="menu" aria-label={`${labels[menu]}选项`}>
            <div className="dock-popover-head"><strong>{labels[menu]}</strong><button className="icon-button" title="关闭选项" onClick={close}><X size={18} /></button></div>
            {menu === "language" && (["zh-CN", "en-US"] as const).map(language => item(language, language === "zh-CN" ? "中文" : "英文", p.scenario.language === language, () => { p.chooseScenario(p.scenario.kind, language); close(); }, p.practicing))}
            {menu === "scenario" && (Object.keys(scenarioLabels) as Array<PracticeScenario["kind"]>).map(kind => item(kind, scenarioLabels[kind], p.scenario.kind === kind, () => { p.chooseScenario(kind, p.scenario.language); close(); }, p.practicing))}
            {menu === "audience" && <>{(Object.keys(intensityLabels) as AudienceIntensity[]).map(value => item(value, intensityLabels[value], p.intensity === value, () => { p.setIntensity(value); close(); }, p.practicing))}<button className="dock-option" onClick={p.toggleAudiencePanel}>{p.audiencePanelVisible ? "隐藏听众与转写" : "显示听众与转写"}</button></>}
            {deviceMenu && <>
              {menu === "camera" && <button className="dock-option" onClick={p.toggleCameraPanel}>{p.cameraPanelVisible ? "隐藏镜头窗口" : "显示镜头窗口"}</button>}
              {menu === "camera" && item("none", "不接入相机 · 只录音", !p.devices.cameraEnabled, () => updateDevice({ cameraEnabled: false }), p.practicing)}
              {(menu !== "output" || speakerSelection) && <>
                {item("default", "系统默认", !selectedDevice && (menu !== "camera" || p.devices.cameraEnabled), () => updateDevice(menu === "microphone" ? { microphoneId: "" } : menu === "camera" ? { cameraId: "", cameraEnabled: true } : { outputId: "" }), p.practicing)}
                {devices.filter(d => d.kind === kind && d.deviceId && d.deviceId !== "default").map((d, i) => item(d.deviceId, d.label || `${labels[menu]} ${i + 1}`, selectedDevice === d.deviceId, () => updateDevice(menu === "microphone" ? { microphoneId: d.deviceId } : menu === "camera" ? { cameraId: d.deviceId, cameraEnabled: true } : { outputId: d.deviceId }), p.practicing))}
              </>}
              {menu !== "output" && <button className="button secondary" disabled={p.practicing || busy} onClick={() => void authorize(menu as "microphone" | "camera")}>{busy ? "正在请求权限" : "授权并刷新设备"}</button>}
              {menu === "output" && <><p className="helper-text">{speakerSelection ? "建议使用耳机，避免听众声音进入麦克风。" : "音频输出由系统管理。请在 iPad 控制中心选择耳机或扬声器。"}</p><button className="button secondary" onClick={() => void testOutput()}>{testingAudio ? "停止试听" : "试听提示音"}</button></>}
              {p.practicing && menu !== "output" && <p className="helper-text">结束本轮后可更换输入设备。</p>}
            </>}
            {menu === "script" && <>{p.editScript && <button className="dock-option" disabled={p.practicing} onClick={() => { close(); p.editScript?.(); }}>编辑台本与表达记忆</button>}{p.importScript && <button className="dock-option" disabled={p.practicing} onClick={() => { close(); p.importScript?.(); }}>从知识库生成台本</button>}<button className="dock-option" onClick={p.toggleScript}>{p.scriptVisible ? "隐藏台词" : "显示台词"}</button><button className="dock-option" role="menuitemcheckbox" aria-checked={p.scriptPinned} onClick={p.toggleScriptPinned}><span>跨页面悬浮</span>{p.scriptPinned && <Check size={17} />}</button><p className="helper-text">默认仅在练习页显示；开启后切换到目标、知识库等页面仍会悬浮。</p><div className="dock-stepper"><span>字号 {p.fontSize}</span><button className="icon-button" title="缩小台词" disabled={p.fontSize <= 18} onClick={() => p.setFontSize(p.fontSize - 2)}><Minus size={18} /></button><button className="icon-button" title="放大台词" disabled={p.fontSize >= 60} onClick={() => p.setFontSize(p.fontSize + 2)}><Plus size={18} /></button></div>{!p.practicing && <div className="segmented two">{(["speech", "manual"] as const).map(mode => <button key={mode} className={p.scrollMode === mode ? "active" : ""} onClick={() => p.changeScrollMode(mode)}>{mode === "speech" ? "语音跟随" : "匀速滚动"}</button>)}</div>}{p.scrollMode === "manual" && <label className="dock-slider">滚动速度<input type="range" min="0" max="5" value={p.scrollSpeed} onChange={e => p.setScrollSpeed(Number(e.target.value))} /></label>}</>}
            {menu === "timer" && <><button className="dock-option" onClick={p.toggleTimer}>{p.timerVisible ? "隐藏计时器" : "显示计时器"}</button><button className="dock-option" role="menuitemcheckbox" aria-checked={p.timerPinned} onClick={p.toggleTimerPinned}><span>跨页面悬浮</span>{p.timerPinned && <Check size={17} />}</button><p className="helper-text">默认仅在练习页显示，悬浮设置与台词相互独立。</p><div className="dock-stepper"><span>目标 {p.target / 60} 分钟</span><button className="icon-button" title="减少目标时长" disabled={p.practicing || p.target <= 60} onClick={() => p.setTarget(p.target - 60)}><Minus size={18} /></button><button className="icon-button" title="增加目标时长" disabled={p.practicing || p.target >= 7200} onClick={() => p.setTarget(p.target + 60)}><Plus size={18} /></button></div><div className="segmented">{[3, 5, 10, 20].map(minutes => <button key={minutes} disabled={p.practicing} className={p.target === minutes * 60 ? "active" : ""} onClick={() => p.setTarget(minutes * 60)}>{minutes} 分</button>)}</div></>}
            {status && <p className="helper-text" role="status">{status}</p>}
          </div>}
        </div>
      </FloatingTools>
    </div>

  </>;
}
