"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, PictureInPicture2, X, Minus, Plus, Eye, Timer, Pause, Play, RotateCcw, MoveDiagonal2, Pin } from "lucide-react";

type ToolSize = { width: number; height: number };

export function FloatingTools({ children, overlay, title = "台词", forceFloating = false, hidden = false, reading = false, dock = false, surface, initialSize, onResize, onHide }: { children: ReactNode; overlay?: ReactNode; title?: string; forceFloating?: boolean; hidden?: boolean; reading?: boolean; dock?: boolean; surface?: "camera" | "audience"; initialSize?: ToolSize; onResize?: (size: ToolSize) => void; onHide?: () => void }) {
  const [floating, setFloating] = useState(false);
  const [position, setPosition] = useState({ x: title === "计时器" ? 620 : 160, y: title === "计时器" ? 90 : 350 });
  const [size, setSize] = useState<ToolSize | null>(initialSize ?? null);
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
  useEffect(() => {
    const clamp = () => {
      const rect = frameRef.current?.getBoundingClientRect();
      setPosition(previous => ({ x: Math.max(0, Math.min(previous.x, window.innerWidth - (rect?.width ?? 260))), y: Math.max(0, Math.min(previous.y, window.innerHeight - 180)) }));
    };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);
  async function openPip() {
    const api = (window as Window & { documentPictureInPicture?: { requestWindow: (options: { width: number; height: number }) => Promise<Window> } }).documentPictureInPicture;
    if (!api) { setError("此浏览器不支持跨 App 悬浮。iPad 可使用应用内悬浮或系统多窗口；桌面 Chrome 支持一个置顶窗口。"); return; }
    try {
      const child = await api.requestWindow({ width: dock ? 900 : 500, height: dock ? 300 : title === "计时器" ? 300 : 640 });
      for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
        const copy = node.cloneNode(true) as HTMLElement;
        if (node instanceof HTMLLinkElement) (copy as HTMLLinkElement).href = node.href;
        child.document.head.appendChild(copy);
      }
      child.document.title = `Speech Coach · ${title}`;
      child.document.body.className = "pip-body";
      child.addEventListener("pagehide", () => { pipRef.current = null; setPip(null); }, { once: true });
      pipRef.current = child;
      setPip(child);
      setError("");
    } catch { setError("无法打开悬浮窗口，请从主页面再次点击桌面悬浮。"); }
  }
  const detached = (floating || forceFloating) && !pip;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const top = Math.max(0, Math.min(position.y, viewportHeight - 280));
  const tools = <div ref={frameRef} hidden={hidden} aria-label={`${title}窗口`} className={`floating-tools ${detached ? "is-floating" : ""} ${reading ? "reading-surface" : ""} ${dock ? "dock-surface" : ""} ${title === "计时器" ? "timer-surface" : ""} ${surface ? `${surface}-surface` : ""}`} style={{ ...(detached ? { left: Math.min(position.x, Math.max(0, (typeof window === "undefined" ? 1024 : window.innerWidth) - (size?.width ?? (title === "计时器" ? 340 : 460)))), top, maxHeight: Math.max(190, viewportHeight - top - 90) } : {}), ...(!dock && !pip && size ? size : {}) }}>
    <div className="floating-bar">
      <button className="icon-button drag-grip" title={`拖动${title}`} disabled={!!pip || dock} onPointerDown={event => {
        const rect = frameRef.current!.getBoundingClientRect();
        if (!detached) { setPosition({ x: rect.left, y: rect.top }); setFloating(true); }
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        const initialX = rect.left, initialY = rect.top;
        const pointerX = event.clientX, pointerY = event.clientY;
        target.onpointermove = move => {
          const width = frameRef.current?.offsetWidth ?? 400;
          setPosition({ x: Math.max(0, Math.min(window.innerWidth - width, initialX + move.clientX - pointerX)), y: Math.max(0, Math.min(window.innerHeight - 100, initialY + move.clientY - pointerY)) });
        };
        target.onpointerup = () => { target.onpointermove = null; target.onpointerup = null; };
        target.onpointercancel = () => { target.onpointermove = null; };
      }}><GripHorizontal size={18} /></button>
      <span>{title}</span>
      {!pip && !dock && <button className="icon-button" title={floating ? "放回布局" : "页内悬浮"} onClick={() => { setFloating(!floating); setSize(null); }}><Pin size={18} /></button>}
      <button className="icon-button" title={pip ? "返回主窗口" : "桌面悬浮"} onClick={() => pip ? pip.close() : void openPip()}>{pip ? <X size={18} /> : <PictureInPicture2 size={18} />}</button>
      {onHide && <button className="icon-button" title={`隐藏${title}`} onClick={onHide}><Minus size={18} /></button>}
    </div>
    {error && <p className="helper-text" role="status">{error}</p>}
    {children}
    {!dock && !pip && <button className="surface-resize icon-button" title={`调整${title}窗口大小`} onPointerDown={event => {
      const target = event.currentTarget, rect = frameRef.current!.getBoundingClientRect();
      const startX = event.clientX, startY = event.clientY;
      const nextSize = (x: number, y: number) => ({ width: Math.max(260, Math.min(window.innerWidth - Math.max(0, rect.left) - 8, rect.width + x - startX)), height: Math.max(title === "计时器" ? 190 : 260, Math.min(window.innerHeight - Math.max(0, rect.top) - 90, rect.height + y - startY)) });
      target.setPointerCapture(event.pointerId);
      target.onpointermove = move => setSize(nextSize(move.clientX, move.clientY));
      target.onpointerup = up => { const next = nextSize(up.clientX, up.clientY); setSize(next); onResize?.(next); target.onpointermove = null; target.onpointerup = null; target.onpointercancel = null; };
      target.onpointercancel = () => { target.onpointermove = null; target.onpointerup = null; target.onpointercancel = null; };
    }}><MoveDiagonal2 size={17} /></button>}
  </div>;
  return <><div ref={mount} hidden={!!pip} />{pip && <button className="button secondary" onClick={() => pip.close()}>{title}在桌面悬浮窗 · 收回</button>}{portalHost && createPortal(<>{tools}{overlay && createPortal(overlay, pip?.document.body ?? document.body)}</>, portalHost)}</>;
}

export function PracticeClock({ elapsed, practicing, targetSeconds = 0 }: { elapsed: number; practicing: boolean; targetSeconds?: number }) {
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
  const remaining = Math.max(0, targetSeconds - total);
  const warning = targetSeconds > 0 && remaining <= 60 && (practicing || running || total > 0);
  return <section className={`practice-clock ${warning ? "time-warning" : ""}`} aria-label="练习计时器">
    {targetSeconds > 0 && <p className="countdown-note" role="status">{remaining === 0 ? "已到目标时长" : warning ? "最后一分钟" : "目标倒计时"}</p>}
    <div className="clock-toolbar"><Timer size={17} /><span>{practicing ? "本轮计时" : "计时器"}</span>
      <button className="icon-button" title={hidden ? "显示计时器" : "隐藏计时器"} onClick={() => setHidden(!hidden)}>{hidden ? <Eye size={16} /> : <Minus size={16} />}</button>
    </div>
    {!hidden && <><div className="clock-digits" style={{ fontSize: size }} role="timer">{String(Math.floor((targetSeconds ? remaining : total) / 60)).padStart(2,"0")}:{String((targetSeconds ? remaining : total) % 60).padStart(2,"0")}</div>{targetSeconds > 0 && <p className="countdown-note">已用 {Math.floor(total / 60)}:{String(total % 60).padStart(2, "0")} / 目标 {Math.floor(targetSeconds / 60)} 分钟</p>}<div className="clock-toolbar"><time>{now?.toLocaleTimeString("zh-CN", { hour12: false }) ?? "--:--:--"}</time>
      <button className="icon-button" title="缩小计时" disabled={size <= 24} onClick={() => setSize(Math.max(24,size - 8))}><Minus size={16} /></button>
      <button className="icon-button" title="放大计时" disabled={size >= 88} onClick={() => setSize(Math.min(88,size + 8))}><Plus size={16} /></button>
      <button className="icon-button" disabled={practicing} title={running ? "暂停独立计时" : "开始独立计时"} onClick={() => { if (running) accumulated.current += Date.now() - started.current; else started.current = Date.now(); setRunning(!running); }}>{running ? <Pause size={16} /> : <Play size={16} />}</button>
      <button className="icon-button" title="重置独立计时" disabled={practicing} onClick={() => { accumulated.current = 0; started.current = Date.now(); setSeconds(0); setRunning(false); }}><RotateCcw size={16} /></button>
    </div></>}
  </section>;
}
