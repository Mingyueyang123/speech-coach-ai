"use client";

import {
  BookOpen, Camera, ChevronRight, CircleStop, Download, Eye, EyeOff,
  FileText, Gauge, Import, Library, Maximize2, Mic, Play, RotateCcw,
  ShieldCheck, Sparkles, Trash2, Upload, Users, Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaSession } from "@/hooks/useMediaSession";
import { calculateDeliveryMetrics, buildLocalReview } from "@/lib/analysis";
import { db } from "@/lib/db";
import { chunkText, parseKnowledgeFile, searchKnowledge } from "@/lib/knowledge";
import { connectRealtime, type RealtimeConnection } from "@/lib/realtime-client";
import { getScenario, SCENARIOS } from "@/lib/scenarios";
import type {
  AudienceIntensity, ConversationTurn, KnowledgeDocument, ReviewReport,
  SessionRecord, TeleprompterMode,
} from "@/lib/types";

type AppTab = "practice" | "knowledge" | "review";

interface RecognitionAlternativeLike { transcript: string }
interface RecognitionResultLike {
  isFinal: boolean;
  0: RecognitionAlternativeLike;
}
interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type RecognitionConstructor = new () => RecognitionLike;

const TAB_LABELS: Array<{ id: AppTab; label: string; icon: typeof Mic }> = [
  { id: "practice", label: "练习", icon: Mic },
  { id: "knowledge", label: "知识库", icon: Library },
  { id: "review", label: "复盘", icon: Gauge },
];

const INTENSITY_LABELS: Record<AudienceIntensity, string> = {
  friendly: "友好",
  balanced: "正常",
  challenging: "挑战",
};

function formatTime(totalSeconds: number): string {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function MetricCard({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}{suffix}</strong>
    </div>
  );
}

export function SpeechCoachApp() {
  const [activeTab, setActiveTab] = useState<AppTab>("practice");
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [intensity, setIntensity] = useState<AudienceIntensity>("balanced");
  const [teleprompterMode, setTeleprompterMode] = useState<TeleprompterMode>("full");
  const [fontSize, setFontSize] = useState(24);
  const [scrollSpeed, setScrollSpeed] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [isPracticing, setIsPracticing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [latestSession, setLatestSession] = useState<SessionRecord | null>(null);
  const [review, setReview] = useState<ReviewReport | null>(null);
  const [notice, setNotice] = useState("准备好后先开启摄像头，再开始练习。");
  const [feishuUrl, setFeishuUrl] = useState("");
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState("真实听众待机");
  const teleprompterRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const practicingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const realtimeRef = useRef<RealtimeConnection | null>(null);
  const {
    videoRef, cameraReady, visionStatus, error: mediaError,
    prepare: prepareMedia, startRecording, stopRecording, getMetricTimeline,
  } = useMediaSession();
  const scenario = getScenario(scenarioId);

  const knowledgeContext = useMemo(() => {
    const chunks = searchKnowledge(documents, `${scenario.title} ${scenario.goal}`);
    return chunks.map((chunk) => chunk.text).join("\n\n").slice(0, 10000);
  }, [documents, scenario]);

  const teleprompterText = useMemo(() => {
    if (teleprompterMode === "hidden") return "";
    if (teleprompterMode === "outline") return scenario.outline.map((item, index) => `${index + 1}. ${item}`).join("\n\n");
    return scenario.script;
  }, [scenario, teleprompterMode]);

  const reloadLocalData = useCallback(async () => {
    const [storedDocuments, storedSessions] = await Promise.all([
      db.documents.orderBy("updatedAt").reverse().toArray(),
      db.sessions.orderBy("startedAt").reverse().toArray(),
    ]);
    setDocuments(storedDocuments);
    setSessions(storedSessions);
    setLatestSession((current) => current ?? storedSessions[0] ?? null);
  }, []);

  useEffect(() => {
    const load = async () => reloadLocalData();
    void load();
  }, [reloadLocalData]);

  useEffect(() => {
    if (!isPracticing || scrollSpeed === 0 || teleprompterMode === "hidden") return;
    scrollRef.current = setInterval(() => {
      teleprompterRef.current?.scrollBy({ top: scrollSpeed, behavior: "smooth" });
    }, 120);
    return () => {
      if (scrollRef.current) clearInterval(scrollRef.current);
    };
  }, [isPracticing, scrollSpeed, teleprompterMode]);

  const configureSpeechRecognition = useCallback(() => {
    const browserWindow = window as typeof window & {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    };
    const Constructor = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Constructor) return null;
    const recognition = new Constructor();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      if (finalText) {
        setTranscript((current) => `${current}${current ? "\n" : ""}${finalText}`);
        setTurns((current) => [...current, {
          id: crypto.randomUUID(), role: "speaker", text: finalText, timestampMs: Date.now(),
        }]);
      }
      setInterimTranscript(interimText);
    };
    recognition.onerror = () => setNotice("浏览器语音识别暂时不可用，录像和视觉分析仍在继续。");
    recognition.onend = () => {
      if (practicingRef.current) {
        try { recognition.start(); } catch { /* Already active. */ }
      }
    };
    recognitionRef.current = recognition;
    return recognition;
  }, []);

  const prepareCamera = async () => {
    try {
      await prepareMedia();
      setNotice("摄像头已准备。录像只存本机，不上传视频帧。");
    } catch {
      setNotice("无法访问摄像头或麦克风，请检查浏览器权限。");
    }
  };

  const startPractice = async () => {
    try {
      const stream = await prepareMedia();
      setTranscript("");
      setInterimTranscript("");
      setTurns([]);
      setReview(null);
      setElapsed(0);
      teleprompterRef.current?.scrollTo({ top: 0 });
      startedAtRef.current = Date.now();
      startRecording();
      practicingRef.current = true;
      setIsPracticing(true);
      setNotice("练习进行中。你可以照着台词说，也可以逐步切换到提纲模式。");
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      const recognition = configureSpeechRecognition();
      try { recognition?.start(); } catch { /* Permission or duplicate start. */ }

      try {
        setAiStatus("正在连接真实听众");
        realtimeRef.current = await connectRealtime({
          stream, scenario, intensity, knowledgeContext,
          onStatus: setAiStatus,
          onTurn: (turn) => {
            if (turn.role === "audience") setTurns((current) => [...current, turn]);
          },
        });
      } catch (cause) {
        setAiStatus(cause instanceof Error ? cause.message : "真实听众未连接，当前使用本地模式");
      }
    } catch {
      setNotice("练习未开始：需要允许摄像头和麦克风权限。");
    }
  };

  const requestAudience = () => {
    if (realtimeRef.current) realtimeRef.current.requestResponse();
    else {
      const prompt = scenario.prompts[turns.filter((turn) => turn.role === "audience").length % scenario.prompts.length];
      setTurns((current) => [...current, {
        id: crypto.randomUUID(), role: "audience", text: prompt, timestampMs: Date.now(),
      }]);
      setAiStatus("本地模拟听众");
    }
  };

  const stopPractice = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    practicingRef.current = false;
    recognitionRef.current?.stop();
    realtimeRef.current?.disconnect();
    realtimeRef.current = null;
    setIsPracticing(false);
    setInterimTranscript("");
    setAiStatus("真实听众待机");
    const videoBlob = await stopRecording();
    const durationMs = Math.max(1000, Date.now() - startedAtRef.current);
    const metricTimeline = getMetricTimeline();
    const metrics = calculateDeliveryMetrics(transcript, durationMs, metricTimeline);
    const session: SessionRecord = {
      id: crypto.randomUUID(), scenarioId: scenario.id,
      startedAt: new Date(startedAtRef.current).toISOString(), durationMs,
      transcript, turns, metricTimeline, metrics,
      ...(videoBlob ? { videoBlob } : {}),
    };
    await db.sessions.put(session);
    setLatestSession(session);
    setSessions((current) => [session, ...current]);
    let nextReview = buildLocalReview(transcript, metrics, scenario);
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, metrics, scenario, knowledgeContext }),
      });
      if (response.ok) nextReview = await response.json() as ReviewReport;
    } catch {
      // Local review remains available offline.
    }
    setReview(nextReview);
    setNotice("练习已保存到本机。复盘不会上传原始录像或视觉关键点。");
    setActiveTab("review");
  };

  const resetPractice = () => {
    setTranscript("");
    setInterimTranscript("");
    setTurns([]);
    setElapsed(0);
    setReview(null);
    teleprompterRef.current?.scrollTo({ top: 0 });
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setKnowledgeBusy(true);
    try {
      for (const file of Array.from(files)) {
        const document = await parseKnowledgeFile(file);
        await db.documents.put(document);
      }
      await reloadLocalData();
      setNotice(`已导入 ${files.length} 份资料，内容保存在浏览器本地。`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "资料导入失败。");
    } finally {
      setKnowledgeBusy(false);
    }
  };

  const importFeishu = async () => {
    if (!feishuUrl.trim()) return;
    setKnowledgeBusy(true);
    try {
      const response = await fetch("/api/knowledge/feishu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: feishuUrl.trim() }),
      });
      const payload = await response.json() as { title?: string; text?: string; error?: string };
      if (!response.ok || !payload.text) throw new Error(payload.error || "飞书资料导入失败。");
      const now = new Date().toISOString();
      const document: KnowledgeDocument = {
        id: crypto.randomUUID(), source: "feishu", title: payload.title || "飞书文档",
        mimeType: "text/feishu", chunks: chunkText(payload.text), createdAt: now, updatedAt: now,
      };
      await db.documents.put(document);
      setFeishuUrl("");
      await reloadLocalData();
      setNotice("飞书资料已读取并保存在本机索引中，服务端不保留正文。");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "飞书资料导入失败。");
    } finally {
      setKnowledgeBusy(false);
    }
  };

  const deleteDocument = async (id: string) => {
    await db.documents.delete(id);
    await reloadLocalData();
  };

  const deleteSession = async (id: string) => {
    await db.sessions.delete(id);
    const next = sessions.filter((session) => session.id !== id);
    setSessions(next);
    if (latestSession?.id === id) {
      setLatestSession(next[0] ?? null);
      setReview(null);
    }
  };

  const downloadRecording = (session: SessionRecord) => {
    if (!session.videoBlob) return;
    const url = URL.createObjectURL(session.videoBlob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `speech-coach-${session.startedAt.replace(/[:.]/g, "-")}.webm`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark"><Mic size={20} /></div>
          <div><strong>Speech Coach AI</strong><span>本地优先的演讲陪练</span></div>
        </div>

        <nav className="main-nav" aria-label="主导航">
          {TAB_LABELS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}>
              <Icon size={18} /><span>{label}</span>
              {id === "knowledge" && documents.length > 0 && <em>{documents.length}</em>}
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <p className="section-label">练习场景</p>
          {SCENARIOS.map((item) => (
            <button
              key={item.id}
              className={`scenario-nav ${scenarioId === item.id ? "active" : ""}`}
              onClick={() => { setScenarioId(item.id); setActiveTab("practice"); resetPractice(); }}
            >
              <span>{item.title}</span><ChevronRight size={15} />
            </button>
          ))}
        </div>

        <div className="privacy-note">
          <ShieldCheck size={18} />
          <div><strong>录像只留本机</strong><span>视频帧与面部关键点不会发送给 AI</span></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">{scenario.title}</p><h1>{activeTab === "practice" ? scenario.description : activeTab === "knowledge" ? "知识库" : "练习复盘"}</h1></div>
          <div className="topbar-status"><span className={isPracticing ? "live-dot active" : "live-dot"} />{isPracticing ? `录制中 ${formatTime(elapsed)}` : "本地待机"}</div>
        </header>

        <div className="notice-bar"><Sparkles size={16} /><span>{notice}</span></div>

        {activeTab === "practice" && (
          <div className="practice-layout">
            <section className="stage-column">
              <div className="camera-panel panel">
                <div className="panel-head">
                  <div><p className="section-label">镜头预览</p><h2>像现场一样练</h2></div>
                  <span className="privacy-badge"><ShieldCheck size={14} /> 本地分析</span>
                </div>
                <div className="video-frame">
                  <video ref={videoRef} muted playsInline />
                  {!cameraReady && (
                    <div className="video-empty"><Camera size={34} /><strong>摄像头尚未开启</strong><span>建议镜头包含头部、肩膀和双手活动区域</span></div>
                  )}
                  <div className="video-overlay"><span>{visionStatus}</span><span>{aiStatus}</span></div>
                </div>
                {mediaError && <p className="error-text">{mediaError}</p>}
                <div className="stage-actions">
                  {!cameraReady && <button className="button secondary" onClick={prepareCamera}><Camera size={17} />开启摄像头</button>}
                  {!isPracticing ? (
                    <button className="button primary" onClick={startPractice}><Play size={17} fill="currentColor" />开始练习</button>
                  ) : (
                    <button className="button danger" onClick={stopPractice}><CircleStop size={17} />结束并复盘</button>
                  )}
                  <button className="icon-button" title="重置本轮内容" onClick={resetPractice}><RotateCcw size={18} /></button>
                </div>
              </div>

              <div className="conversation-panel panel">
                <div className="panel-head compact">
                  <div><p className="section-label">真实听众</p><h2>现场反应与转写</h2></div>
                  <button className="button ghost" onClick={requestAudience} disabled={!isPracticing}><Users size={16} />请听众回应</button>
                </div>
                <div className="turn-list">
                  {!turns.length && !interimTranscript && <div className="empty-copy">开始说话后，转写和听众追问会出现在这里。</div>}
                  {turns.map((turn) => (
                    <div key={turn.id} className={`turn ${turn.role}`}>
                      <span>{turn.role === "speaker" ? "你" : turn.role === "audience" ? "听众" : "系统"}</span>
                      <p>{turn.text}</p>
                    </div>
                  ))}
                  {interimTranscript && <div className="turn speaker interim"><span>识别中</span><p>{interimTranscript}</p></div>}
                </div>
              </div>
            </section>

            <aside className="coach-column">
              <section className="panel controls-panel">
                <p className="section-label">练习设置</p>
                <label>场景<select value={scenarioId} onChange={(event) => { setScenarioId(event.target.value); resetPractice(); }}>{SCENARIOS.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
                <label>听众强度<div className="segmented">{(["friendly", "balanced", "challenging"] as AudienceIntensity[]).map((value) => <button key={value} className={intensity === value ? "active" : ""} onClick={() => setIntensity(value)}>{INTENSITY_LABELS[value]}</button>)}</div></label>
                <div className="goal-box"><span>本轮目标</span><p>{scenario.goal}</p></div>
              </section>

              <section className="panel teleprompter-panel" ref={teleprompterRef}>
                <div className="panel-head sticky-head">
                  <div><p className="section-label">现场台词卡</p><h2>{scenario.title}</h2></div>
                  <button className="icon-button" title="全屏提词" onClick={() => teleprompterRef.current?.requestFullscreen()}><Maximize2 size={17} /></button>
                </div>
                <div className="segmented teleprompter-modes">
                  <button className={teleprompterMode === "full" ? "active" : ""} onClick={() => setTeleprompterMode("full")}><FileText size={14} />完整</button>
                  <button className={teleprompterMode === "outline" ? "active" : ""} onClick={() => setTeleprompterMode("outline")}><BookOpen size={14} />提纲</button>
                  <button className={teleprompterMode === "hidden" ? "active" : ""} onClick={() => setTeleprompterMode("hidden")}><EyeOff size={14} />隐藏</button>
                </div>
                {teleprompterMode === "hidden" ? (
                  <div className="hidden-script"><Eye size={28} /><strong>台词已隐藏</strong><span>现在尝试只依靠结构和现场感表达。</span></div>
                ) : (
                  <div className="script-text" style={{ fontSize }}>{teleprompterText}</div>
                )}
                <div className="teleprompter-tools">
                  <label>字号 <input type="range" min="18" max="38" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></label>
                  <label>滚动 <input type="range" min="0" max="5" value={scrollSpeed} onChange={(event) => setScrollSpeed(Number(event.target.value))} /></label>
                </div>
              </section>
            </aside>
          </div>
        )}

        {activeTab === "knowledge" && (
          <div className="knowledge-layout">
            <section className="panel import-panel">
              <div className="panel-head"><div><p className="section-label">本地资料</p><h2>导入你的知识与台本</h2></div><span className="privacy-badge"><ShieldCheck size={14} /> 存在浏览器内</span></div>
              <label className="upload-zone">
                <Upload size={28} /><strong>{knowledgeBusy ? "正在处理资料" : "选择 DOCX、PDF、Markdown 或 TXT"}</strong><span>文件会在本机解析和建立索引</span>
                <input type="file" multiple accept=".docx,.pdf,.md,.txt" onChange={(event) => void importFiles(event.target.files)} disabled={knowledgeBusy} />
              </label>
              <div className="divider"><span>或连接云端</span></div>
              <div className="feishu-import"><input value={feishuUrl} onChange={(event) => setFeishuUrl(event.target.value)} placeholder="粘贴飞书 docx 或 wiki 链接" /><button className="button primary" onClick={importFeishu} disabled={knowledgeBusy || !feishuUrl.trim()}><Import size={16} />读取飞书</button></div>
              <p className="helper-text">飞书连接器需要在 `.env.local` 配置只读应用凭证，并为应用授予目标文档权限。</p>
            </section>

            <section className="panel library-panel">
              <div className="panel-head"><div><p className="section-label">资料库</p><h2>{documents.length} 份可用资料</h2></div></div>
              <div className="document-list">
                {!documents.length && <div className="empty-copy">导入资料后，真实听众会用相关内容提出更具体的问题。</div>}
                {documents.map((document) => (
                  <div className="document-row" key={document.id}>
                    <div className="document-icon">{document.source === "feishu" ? <Library size={19} /> : <FileText size={19} />}</div>
                    <div><strong>{document.title}</strong><span>{document.source === "feishu" ? "飞书" : "本地文件"} · {document.chunks.length} 个片段</span></div>
                    <button className="icon-button" title="删除资料" onClick={() => void deleteDocument(document.id)}><Trash2 size={17} /></button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === "review" && (
          <div className="review-layout">
            {!latestSession ? (
              <section className="panel no-review"><Video size={34} /><h2>还没有练习记录</h2><p>完成一轮练习后，这里会出现录像回放、表达时间轴和改进建议。</p><button className="button primary" onClick={() => setActiveTab("practice")}><Play size={16} />开始第一轮</button></section>
            ) : (
              <>
                <section className="review-main">
                  <div className="panel review-summary">
                    <div className="score-ring"><strong>{review?.overallScore ?? "--"}</strong><span>综合表现</span></div>
                    <div><p className="section-label">本轮结论</p><h2>{review?.summary ?? "选择一条练习记录查看本地指标。"}</h2><p>{new Date(latestSession.startedAt).toLocaleString("zh-CN")} · {formatTime(Math.round(latestSession.durationMs / 1000))}</p></div>
                  </div>

                  {latestSession.videoBlob && <LocalVideo blob={latestSession.videoBlob} />}

                  <div className="metrics-grid panel">
                    <MetricCard label="语速" value={latestSession.metrics.wordsPerMinute} suffix=" 字/分" />
                    <MetricCard label="填充词" value={latestSession.metrics.fillerCount} />
                    <MetricCard label="面向镜头" value={latestSession.metrics.cameraFacingRatio} suffix="%" />
                    <MetricCard label="双手可见" value={latestSession.metrics.handsVisibleRatio} suffix="%" />
                    <MetricCard label="手势活动" value={latestSession.metrics.gestureRate} suffix="%" />
                    <MetricCard label="身体晃动" value={latestSession.metrics.bodySway} suffix="%" />
                  </div>

                  <section className="panel timeline-panel">
                    <div className="panel-head compact"><div><p className="section-label">表达时间轴</p><h2>音量与镜头连接</h2></div></div>
                    <MetricTimeline points={latestSession.metricTimeline} />
                  </section>

                  {review && <section className="panel feedback-grid">
                    <div><p className="section-label positive">做得好的</p>{review.strengths.map((item) => <p key={item}>{item}</p>)}</div>
                    <div><p className="section-label caution">优先改进</p>{review.improvements.map((item) => <p key={item}>{item}</p>)}</div>
                    <div><p className="section-label action">下一轮练习</p>{review.nextPractice.map((item) => <p key={item}>{item}</p>)}</div>
                  </section>}
                </section>

                <aside className="panel session-history">
                  <p className="section-label">本地记录</p><h2>练习历史</h2>
                  {sessions.map((session) => (
                    <div className={`session-row ${latestSession.id === session.id ? "active" : ""}`} key={session.id}>
                      <button onClick={() => { setLatestSession(session); setReview(buildLocalReview(session.transcript, session.metrics, getScenario(session.scenarioId))); }}><strong>{getScenario(session.scenarioId).title}</strong><span>{new Date(session.startedAt).toLocaleString("zh-CN")}</span></button>
                      <div><button title="下载录像" disabled={!session.videoBlob} onClick={() => downloadRecording(session)}><Download size={15} /></button><button title="永久删除" onClick={() => void deleteSession(session.id)}><Trash2 size={15} /></button></div>
                    </div>
                  ))}
                </aside>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function LocalVideo({ blob }: { blob: Blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);
  return <div className="panel playback-panel"><video controls src={url} /><div><ShieldCheck size={15} />这段录像来自本机 IndexedDB，没有上传到服务端。</div></div>;
}

function MetricTimeline({ points }: { points: SessionRecord["metricTimeline"] }) {
  if (!points.length) return <div className="empty-copy">本轮没有可用的视觉时间轴。</div>;
  const sampled = points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 60)) === 0).slice(0, 60);
  return <div className="timeline-chart" aria-label="表达时间轴">{sampled.map((point) => <div className="timeline-column" key={point.timestampMs}><i style={{ height: `${Math.max(4, point.volume * 100)}%` }} /><b style={{ height: `${Math.max(4, point.cameraFacing * 100)}%` }} /></div>)}</div>;
}
