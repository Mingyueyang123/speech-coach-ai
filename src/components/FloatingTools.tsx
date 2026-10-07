"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, PictureInPicture2, X, Minus, Plus, Eye, Timer, Pause, Play, RotateCcw } from "lucide-react";

export function FloatingTools({ children }: { children: ReactNode }) {
  const [floating, setFloating] = useState(false);
  const [position, setPosition] = useState({ x: 24, y: 90 });
  const [pip, setPip] = useState<Window | null>(null);
  const [error, setError] = useState("");
  const pipRef = useRef<Window | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  const mount = useCallback((node: HTMLDivElement | null) => {
    mountRef.current = node;
    if (node) {
      const host = document.createElement("div");
      node.appendChild(host);
      setPortalHost(host);
      return () => host.remove();
    }
  }, []);
  // Move one portal host between documents so clocks and script scroll survive PiP.
  useEffect(() => {
    if (portalHost) (pip?.document.body ?? mountRef.current)?.appendChild(portalHost);
  }, [pip, portalHost]);
  useEffect(() => () => pipRef.current?.close(), []);
  async function openPip() {
    const api = (window as Window & { documentPictureInPicture?: { requestWindow: (options: { width: number; height: number }) => Promise<Window> } }).documentPictureInPicture;
    if (!api) { setError("当前浏览器不支持桌面置顶，请用桌面 Chrome 打开此地址。页内悬浮仍可使用。"); return; }
    try {
      const child = await api.requestWindow({ width: 500, height: 640 });
      for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
        const copy = node.cloneNode(true) as HTMLElement;
        if (node instanceof HTMLLinkElement) (copy as HTMLLinkElement).href = node.href;
        child.document.head.appendChild(copy);
      }
      child.document.title = "Speech Coach · 桌面提词";
      child.document.body.className = "pip-body";
      child.addEventListener("pagehide", () => { pipRef.current = null; setPip(null); }, { once: true });
      pipRef.current = child;
      setPip(child);
      setError("");
    } catch { setError("无法打开悬浮窗口，请从主页面再次点击桌面悬浮。"); }
  }
  const tools = <div ref={frameRef} className={`floating-tools ${floating && !pip ? "is-floating" : ""}`} style={floating && !pip ? { left: position.x, top: position.y } : undefined}>
    <div className="floating-bar">
      <button className="icon-button drag-grip" title="拖动台词卡" disabled={!floating || !!pip} onPointerDown={event => {
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        const initialX = position.x, initialY = position.y;
        const pointerX = event.clientX, pointerY = event.clientY;
        target.onpointermove = move => {
          const width = frameRef.current?.offsetWidth ?? 400;
          setPosition({ x: Math.max(0, Math.min(window.innerWidth - width, initialX + move.clientX - pointerX)), y: Math.max(0, Math.min(window.innerHeight - 100, initialY + move.clientY - pointerY)) });
        };
        target.onpointerup = () => { target.onpointermove = null; target.onpointerup = null; };
        target.onpointercancel = () => { target.onpointermove = null; };
      }}><GripHorizontal size={18} /></button>
      <span>台词与计时</span>
      {!pip && <button className="button ghost" onClick={() => setFloating(!floating)}>{floating ? "放回布局" : "页内悬浮"}</button>}
      <button className="icon-button" title={pip ? "返回主窗口" : "桌面悬浮"} onClick={() => pip ? pip.close() : void openPip()}>{pip ? <X size={18} /> : <PictureInPicture2 size={18} />}</button>
    </div>
    {error && <p className="helper-text" role="status">{error}</p>}
    {children}
  </div>;
  return <><div ref={mount} hidden={!!pip} />{pip && <button className="button secondary" onClick={() => pip.close()}>台词在桌面悬浮窗 · 收回</button>}{portalHost && createPortal(tools, portalHost)}</>;
}

export function PracticeClock({ elapsed, practicing }: { elapsed: number; practicing: boolean }) {
  const [hidden, setHidden] = useState(false);
  const [size, setSize] = useState(40);
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const started = useRef(0);
  const accumulated = useRef(0);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => { setNow(new Date()); if (running) setSeconds(Math.floor((accumulated.current + Date.now() - started.current) / 1000)); };
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [running]);
  const total = practicing ? elapsed : seconds;
  return <section className="practice-clock" aria-label="练习计时器">
    <div className="clock-toolbar"><Timer size={17} /><span>{practicing ? "本轮计时" : "计时器"}</span>
      <button className="icon-button" title={hidden ? "显示计时器" : "隐藏计时器"} onClick={() => setHidden(!hidden)}>{hidden ? <Eye size={16} /> : <Minus size={16} />}</button>
    </div>
    {!hidden && <><div className="clock-digits" style={{ fontSize: size }} role="timer">{String(Math.floor(total / 60)).padStart(2,"0")}:{String(total % 60).padStart(2,"0")}</div><div className="clock-toolbar"><time>{now?.toLocaleTimeString("zh-CN", { hour12: false }) ?? "--:--:--"}</time>
      <button className="icon-button" title="缩小计时" disabled={size <= 24} onClick={() => setSize(Math.max(24,size - 8))}><Minus size={16} /></button>
      <button className="icon-button" title="放大计时" disabled={size >= 88} onClick={() => setSize(Math.min(88,size + 8))}><Plus size={16} /></button>
      <button className="icon-button" disabled={practicing} title={running ? "暂停独立计时" : "开始独立计时"} onClick={() => { if (running) accumulated.current += Date.now() - started.current; else started.current = Date.now(); setRunning(!running); }}>{running ? <Pause size={16} /> : <Play size={16} />}</button>
      <button className="icon-button" title="重置独立计时" disabled={practicing} onClick={() => { accumulated.current = 0; started.current = Date.now(); setSeconds(0); setRunning(false); }}><RotateCcw size={16} /></button>
    </div></>}
  </section>;
}
