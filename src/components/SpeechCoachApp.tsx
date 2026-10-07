"use client";

import {
  ArrowRight, Camera, Check, ChevronDown, ChevronRight, ChevronUp,
  CircleStop, Download, EyeOff, FileText, Gauge, GripHorizontal, Import,
  Languages, Library, Lightbulb, Maximize2, Mic, Play, Plus,
  Power, RotateCcw, ShieldCheck, Sparkles, Target, Trash2, Upload, Users, Video,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaSession } from "@/hooks/useMediaSession";
import { buildLocalReview, calculateDeliveryMetrics } from "@/lib/analysis";
import { db } from "@/lib/db";
import { buildLocalGoalPlan, createPracticeRounds, DEFAULT_PROFILE, nextRoundIndex } from "@/lib/goals";
import { HUMOR_METHODS, HUMOR_SOURCES } from "@/lib/humor";
import { chunkText, parseKnowledgeFile, searchKnowledge } from "@/lib/knowledge";
import { connectRealtime, type RealtimeConnection } from "@/lib/realtime-client";
import { getScenario, getScenarioByKind, SCENARIOS } from "@/lib/scenarios";
import { findSpeechProgress, progressToSection } from "@/lib/speech-follow";
import type {
  AppPreferences, AudienceIntensity, ConversationTurn, GoalPlan, HumorLevel,
  HumorMaterial, HumorMaterialType, KnowledgeDocument, PracticeScenario,
  ReviewReport, ScenarioKind, ScrollMode, SessionRecord, TeleprompterMode,
  TrainingGoal, TrainingLanguage, UserProfile,
} from "@/lib/types";

type AppTab = "practice" | "goals" | "knowledge" | "humor" | "review";

interface RecognitionAlternativeLike { transcript: string; confidence?: number }
interface RecognitionResultLike { isFinal: boolean; 0: RecognitionAlternativeLike }
interface RecognitionEventLike { resultIndex: number; results: ArrayLike<RecognitionResultLike> }
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

const DEFAULT_PREFERENCES: AppPreferences = {
  id: "app-preferences", cameraHeight: 420, cameraCollapsed: false,
  scrollMode: "speech", onboardingDismissed: false, updatedAt: new Date(0).toISOString(),
};

const TAB_LABELS: Array<{ id: AppTab; label: string; icon: typeof Mic }> = [
  { id: "practice", label: "练习", icon: Mic },
  { id: "goals", label: "目标", icon: Target },
  { id: "knowledge", label: "知识库", icon: Library },
  { id: "humor", label: "幽默素材", icon: Lightbulb },
  { id: "review", label: "复盘", icon: Gauge },
];

const INTENSITY_LABELS: Record<AudienceIntensity, string> = { friendly: "友好", balanced: "正常", challenging: "挑战" };
const ROUND_LABELS: Record<TeleprompterMode, string> = { full: "完整台词", cues: "关键词", hidden: "脱稿" };
const SCENARIO_LABELS: Record<ScenarioKind, string> = { "investor-pitch": "投资人 Pitch", "client-roadshow": "客户路演", "live-speaking": "线下演讲 / 主持" };
const HUMOR_TYPE_LABELS: Record<HumorMaterialType, string> = {
  observation: "观察", story: "个人故事", analogy: "类比", contrast: "反差",
  "self-deprecation": "自嘲", callback: "回扣", interaction: "现场互动",
};

function formatTime(totalSeconds: number): string {
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function todayPlus(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function MetricCard({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}{suffix}</strong></div>;
}

export function SpeechCoachApp() {
  const [activeTab, setActiveTab] = useState<AppTab>("practice");
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [intensity, setIntensity] = useState<AudienceIntensity>("balanced");
  const [roundIndex, setRoundIndex] = useState<1 | 2 | 3>(1);
  const [fontSize, setFontSize] = useState(24);
  const [scrollSpeed, setScrollSpeed] = useState(1);
  const [scrollMode, setScrollMode] = useState<ScrollMode>("speech");
  const [speechProgress, setSpeechProgress] = useState(0);
  const [speechStatus, setSpeechStatus] = useState("等待语音");
  const [elapsed, setElapsed] = useState(0);
  const [isPracticing, setIsPracticing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [goals, setGoals] = useState<TrainingGoal[]>([]);
  const [humorMaterials, setHumorMaterials] = useState<HumorMaterial[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [preferences, setPreferences] = useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [latestSession, setLatestSession] = useState<SessionRecord | null>(null);
  const [review, setReview] = useState<ReviewReport | null>(null);
  const [notice, setNotice] = useState("先选择目标和训练轮次，再开启摄像头开始练习。");
  const [feishuUrl, setFeishuUrl] = useState("");
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [goalBusy, setGoalBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState("真实听众待机");

  const teleprompterRef = useRef<HTMLElement>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const practicingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const realtimeRef = useRef<RealtimeConnection | null>(null);
  const spokenTextRef = useRef("");
  const progressRef = useRef(0);
  const missedMatchesRef = useRef(0);

  const {
    videoRef, cameraReady, recording, visionStatus, error: mediaError,
    prepare: prepareMedia, startRecording, stopRecording, stopCamera, getMetricTimeline,
  } = useMediaSession();

  const activeGoal = useMemo(
    () => goals.find((goal) => goal.id === preferences.activeGoalId) ?? null,
    [goals, preferences.activeGoalId],
  );

  const baseScenario = getScenario(scenarioId);
  const scenario = useMemo<PracticeScenario>(() => {
    if (!activeGoal) return baseScenario;
    const base = getScenarioByKind(activeGoal.scenarioKind, activeGoal.language);
    return {
      ...base,
      id: `${base.id}:${activeGoal.id}`,
      title: activeGoal.title,
      goal: activeGoal.desiredOutcome,
      durationSeconds: activeGoal.durationSeconds,
      audiencePersona: activeGoal.plan.audiencePersona,
      script: activeGoal.plan.script,
      cues: activeGoal.plan.cues,
      prompts: activeGoal.plan.prompts,
      rubric: activeGoal.plan.rubric,
      knowledgeDocumentIds: activeGoal.knowledgeDocumentIds,
    };
  }, [activeGoal, baseScenario]);

  const teleprompterMode: TeleprompterMode = roundIndex === 1 ? "full" : roundIndex === 2 ? "cues" : "hidden";
  const scriptParagraphs = useMemo(() => scenario.script.split(/\n\s*\n/).filter(Boolean), [scenario.script]);
  const activeSection = progressToSection(speechProgress, teleprompterMode === "cues" ? scenario.cues.length : scriptParagraphs.length);
  const knowledgeContext = useMemo(() => {
    const selected = activeGoal?.knowledgeDocumentIds.length
      ? documents.filter((document) => activeGoal.knowledgeDocumentIds.includes(document.id))
      : documents;
    return searchKnowledge(selected, `${scenario.title} ${scenario.goal}`).map((chunk) => chunk.text).join("\n\n").slice(0, 10000);
  }, [activeGoal, documents, scenario.goal, scenario.title]);

  const reloadLocalData = useCallback(async () => {
    const [storedDocuments, storedSessions, storedGoals, storedHumor, storedProfile, storedPreferences] = await Promise.all([
      db.documents.orderBy("updatedAt").reverse().toArray(),
      db.sessions.orderBy("startedAt").reverse().toArray(),
      db.goals.orderBy("updatedAt").reverse().toArray(),
      db.humorMaterials.orderBy("updatedAt").reverse().toArray(),
      db.profiles.get("local-profile"),
      db.preferences.get("app-preferences"),
    ]);
    const nextPreferences = storedPreferences ?? DEFAULT_PREFERENCES;
    setDocuments(storedDocuments);
    setSessions(storedSessions);
    setGoals(storedGoals);
    setHumorMaterials(storedHumor);
    setProfile(storedProfile ?? null);
    setPreferences(nextPreferences);
    setScrollMode(nextPreferences.scrollMode);
    setLatestSession((current) => current ?? storedSessions[0] ?? null);
    setOnboardingOpen(!storedProfile && !nextPreferences.onboardingDismissed);
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => void reloadLocalData(), 0);
    return () => window.clearTimeout(handle);
  }, [reloadLocalData]);

  useEffect(() => {
    if (!isPracticing || scrollMode !== "manual" || scrollSpeed === 0 || teleprompterMode === "hidden") return;
    scrollRef.current = setInterval(() => teleprompterRef.current?.scrollBy({ top: scrollSpeed, behavior: "smooth" }), 120);
    return () => { if (scrollRef.current) clearInterval(scrollRef.current); };
  }, [isPracticing, scrollMode, scrollSpeed, teleprompterMode]);

  const savePreferences = useCallback(async (patch: Partial<AppPreferences>) => {
    const next = { ...preferences, ...patch, id: "app-preferences" as const, updatedAt: new Date().toISOString() };
    setPreferences(next);
    if (patch.scrollMode) setScrollMode(patch.scrollMode);
    await db.preferences.put(next);
  }, [preferences]);

  const setSpeechMatch = useCallback((spoken: string) => {
    if (scrollMode !== "speech") return;
    const match = findSpeechProgress(scenario.script, spoken, scenario.language, progressRef.current);
    if (!match.matched) {
      missedMatchesRef.current += 1;
      setSpeechStatus(`正在重新定位 ${missedMatchesRef.current}/4`);
      if (missedMatchesRef.current >= 4) {
        setSpeechStatus("识别连续偏离，已切到匀速滚动");
        setNotice("语音跟随暂时无法定位台词，已自动切换到匀速滚动。");
        void savePreferences({ scrollMode: "manual" });
      }
      return;
    }
    missedMatchesRef.current = 0;
    progressRef.current = match.progress;
    setSpeechProgress(match.progress);
    setSpeechStatus(`已跟随 ${Math.round(match.progress * 100)}%`);
    const count = teleprompterMode === "cues" ? scenario.cues.length : scriptParagraphs.length;
    teleprompterRef.current
      ?.querySelector(`[data-teleprompter-section="${progressToSection(match.progress, count)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [savePreferences, scenario, scriptParagraphs.length, scrollMode, teleprompterMode]);

  const configureSpeechRecognition = useCallback(() => {
    const browserWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Constructor = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setSpeechStatus("浏览器不支持语音跟随");
      setNotice("当前浏览器不支持连续语音识别，已使用匀速滚动。建议桌面 Chrome。");
      void savePreferences({ scrollMode: "manual" });
      return null;
    }
    const recognition = new Constructor();
    recognition.lang = scenario.language;
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
        spokenTextRef.current += ` ${finalText}`;
        setTranscript((current) => `${current}${current ? "\n" : ""}${finalText}`);
        setTurns((current) => [...current, { id: crypto.randomUUID(), role: "speaker", text: finalText, timestampMs: Date.now() }]);
      }
      setInterimTranscript(interimText);
      setSpeechMatch(`${spokenTextRef.current} ${interimText}`);
    };
    recognition.onerror = () => {
      setSpeechStatus("语音识别中断");
      setNotice("语音识别暂时中断；录像和本地视觉分析仍在继续。");
    };
    recognition.onend = () => {
      if (practicingRef.current) {
        try { recognition.start(); } catch { /* Browser is still closing the previous stream. */ }
      }
    };
    recognitionRef.current = recognition;
    return recognition;
  }, [savePreferences, scenario.language, setSpeechMatch]);

  const resetPractice = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setTurns([]);
    setElapsed(0);
    setReview(null);
    setSpeechProgress(0);
    setSpeechStatus("等待语音");
    spokenTextRef.current = "";
    progressRef.current = 0;
    missedMatchesRef.current = 0;
    teleprompterRef.current?.scrollTo({ top: 0 });
  }, []);

  const prepareCamera = async () => {
    try {
      await prepareMedia();
      setNotice("摄像头已准备。收起画面不会停止录像或本地分析。");
    } catch {
      setNotice("无法访问摄像头或麦克风，请检查浏览器权限。");
    }
  };

  const startPractice = async () => {
    try {
      const stream = await prepareMedia();
      resetPractice();
      startedAtRef.current = Date.now();
      startRecording();
      practicingRef.current = true;
      setIsPracticing(true);
      setNotice(`第 ${roundIndex} 轮进行中：${ROUND_LABELS[teleprompterMode]}。`);
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250);
      const recognition = configureSpeechRecognition();
      try { recognition?.start(); } catch { /* Permission or duplicate start. */ }
      try {
        setAiStatus("正在连接真实听众");
        realtimeRef.current = await connectRealtime({
          stream, scenario, intensity, knowledgeContext, onStatus: setAiStatus,
          onTurn: (turn) => { if (turn.role === "audience") setTurns((current) => [...current, turn]); },
        });
      } catch (cause) {
        setAiStatus(cause instanceof Error ? cause.message : "真实听众未连接，当前使用本地模式");
      }
    } catch {
      setNotice("练习未开始：需要允许摄像头和麦克风权限。");
    }
  };

  const requestAudience = () => {
    if (realtimeRef.current) {
      realtimeRef.current.requestResponse(scenario.language === "en-US" ? "Respond as a realistic audience member with one concise question." : "请作为真实听众，用一句简短反应或追问回应。 ");
      return;
    }
    const prompt = scenario.prompts[turns.filter((turn) => turn.role === "audience").length % scenario.prompts.length];
    setTurns((current) => [...current, { id: crypto.randomUUID(), role: "audience", text: prompt, timestampMs: Date.now() }]);
    setAiStatus("本地模拟听众");
  };

  const stopPracticeSession = async () => {
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
    const metrics = calculateDeliveryMetrics(transcript, durationMs, metricTimeline, scenario.language);
    const session: SessionRecord = {
      id: crypto.randomUUID(), scenarioId: scenario.id.split(":")[0], goalId: activeGoal?.id,
      roundMode: teleprompterMode, roundIndex, language: scenario.language,
      speechFollowProgress: progressRef.current, startedAt: new Date(startedAtRef.current).toISOString(),
      durationMs, transcript, turns, metricTimeline, metrics, ...(videoBlob ? { videoBlob } : {}),
    };
    await db.sessions.put(session);
    setLatestSession(session);
    setSessions((current) => [session, ...current]);

    let nextReview = buildLocalReview(transcript, metrics, scenario);
    try {
      const response = await fetch("/api/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, metrics, scenario, knowledgeContext }),
      });
      if (response.ok) nextReview = await response.json() as ReviewReport;
    } catch { /* Local review remains available offline. */ }
    setReview(nextReview);

    if (activeGoal) {
      const updated: TrainingGoal = {
        ...activeGoal,
        rounds: activeGoal.rounds.map((round) => round.index === roundIndex
          ? { ...round, status: "completed", sessionId: session.id, score: nextReview.overallScore, completedAt: new Date().toISOString() }
          : round),
        updatedAt: new Date().toISOString(),
      };
      await db.goals.put(updated);
      setGoals((current) => current.map((goal) => goal.id === updated.id ? updated : goal));
    }
    setNotice("本轮已保存到本机。你可以先复盘，再手动进入下一轮。");
    setActiveTab("review");
  };

  const selectRound = (index: 1 | 2 | 3) => {
    if (isPracticing) return;
    setRoundIndex(index);
    resetPractice();
    setActiveTab("practice");
  };

  const chooseScenario = (kind: ScenarioKind, language: TrainingLanguage) => {
    if (isPracticing) return;
    const selected = getScenarioByKind(kind, language);
    setScenarioId(selected.id);
    setRoundIndex(1);
    void savePreferences({ activeGoalId: undefined });
    resetPractice();
    setActiveTab("practice");
  };

  const chooseGoal = async (goal: TrainingGoal) => {
    const next = nextRoundIndex(goal);
    setScenarioId(getScenarioByKind(goal.scenarioKind, goal.language).id);
    setRoundIndex(next);
    await savePreferences({ activeGoalId: goal.id });
    resetPractice();
    setActiveTab("practice");
    setNotice(`已载入目标“${goal.title}”，从第 ${next} 轮开始。`);
  };

  const changeScrollMode = (mode: ScrollMode) => {
    setSpeechStatus(mode === "speech" ? "等待语音" : "匀速滚动");
    void savePreferences({ scrollMode: mode });
  };

  const toggleCameraCollapsed = () => void savePreferences({ cameraCollapsed: !preferences.cameraCollapsed });

  const beginCameraResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = preferences.cameraHeight;
    const max = window.innerWidth <= 720 ? 480 : 720;
    const move = (moveEvent: PointerEvent) => {
      const next = Math.max(220, Math.min(max, startHeight + moveEvent.clientY - startY));
      setPreferences((current) => ({ ...current, cameraHeight: next }));
    };
    const end = (endEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      const next = Math.max(220, Math.min(max, startHeight + endEvent.clientY - startY));
      void savePreferences({ cameraHeight: next });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setKnowledgeBusy(true);
    try {
      for (const file of Array.from(files)) await db.documents.put(await parseKnowledgeFile(file));
      await reloadLocalData();
      setNotice(`已导入 ${files.length} 份资料，内容保存在浏览器本地。`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "资料导入失败。");
    } finally { setKnowledgeBusy(false); }
  };

  const importFeishu = async () => {
    if (!feishuUrl.trim()) return;
    setKnowledgeBusy(true);
    try {
      const response = await fetch("/api/knowledge/feishu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: feishuUrl.trim() }) });
      const payload = await response.json() as { title?: string; text?: string; error?: string };
      if (!response.ok || !payload.text) throw new Error(payload.error || "飞书资料导入失败。");
      const now = new Date().toISOString();
      await db.documents.put({ id: crypto.randomUUID(), source: "feishu", title: payload.title || "飞书文档", mimeType: "text/feishu", chunks: chunkText(payload.text), createdAt: now, updatedAt: now });
      setFeishuUrl("");
      await reloadLocalData();
      setNotice("飞书资料已读取并保存在本机索引中，服务端不保留正文。");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "飞书资料导入失败。");
    } finally { setKnowledgeBusy(false); }
  };

  const deleteSession = async (id: string) => {
    await db.sessions.delete(id);
    const next = sessions.filter((session) => session.id !== id);
    setSessions(next);
    if (latestSession?.id === id) { setLatestSession(next[0] ?? null); setReview(null); }
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

  const headerTitle = activeTab === "practice" ? scenario.description
    : activeTab === "goals" ? "目标中心"
      : activeTab === "knowledge" ? "知识库"
        : activeTab === "humor" ? "幽默方法与个人素材"
          : "练习复盘";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block"><div className="brand-mark"><Mic size={20} /></div><div><strong>Speech Coach AI</strong><span>本地优先的演讲陪练</span></div></div>
        <nav className="main-nav" aria-label="主导航">
          {TAB_LABELS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}>
              <Icon size={18} /><span>{label}</span>{id === "goals" && goals.length > 0 && <em>{goals.length}</em>}{id === "knowledge" && documents.length > 0 && <em>{documents.length}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-section">
          <p className="section-label">快速场景</p>
          {(["investor-pitch", "client-roadshow", "live-speaking"] as ScenarioKind[]).map((kind) => (
            <button key={kind} className={`scenario-nav ${scenario.kind === kind ? "active" : ""}`} onClick={() => chooseScenario(kind, scenario.language)}>
              <span>{SCENARIO_LABELS[kind]}</span><ChevronRight size={15} />
            </button>
          ))}
        </div>
        <div className="privacy-note"><ShieldCheck size={18} /><div><strong>录像只留本机</strong><span>视频帧与关键点不会发送给 AI</span></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">{activeGoal ? `目标 · ${activeGoal.title}` : scenario.title}</p><h1>{headerTitle}</h1></div>
          <div className="topbar-status"><span className={isPracticing ? "live-dot active" : "live-dot"} />{isPracticing ? `录制中 ${formatTime(elapsed)}` : "本地待机"}</div>
        </header>
        <div className="notice-bar"><Sparkles size={16} /><span>{notice}</span></div>

        {activeTab === "practice" && (
          <PracticeView
            scenario={scenario} activeGoal={activeGoal} roundIndex={roundIndex} selectRound={selectRound}
            isPracticing={isPracticing} cameraReady={cameraReady} recording={recording} cameraCollapsed={preferences.cameraCollapsed}
            cameraHeight={preferences.cameraHeight} videoRef={videoRef} visionStatus={visionStatus} aiStatus={aiStatus}
            mediaError={mediaError} prepareCamera={prepareCamera} startPractice={startPractice} stopPractice={stopPracticeSession}
            stopCamera={() => { stopCamera(); setNotice("摄像头和麦克风已关闭。"); }} toggleCameraCollapsed={toggleCameraCollapsed}
            beginCameraResize={beginCameraResize} resetPractice={resetPractice} turns={turns} interimTranscript={interimTranscript}
            requestAudience={requestAudience} intensity={intensity} setIntensity={setIntensity}
            chooseScenario={chooseScenario} scrollMode={scrollMode} changeScrollMode={changeScrollMode}
            speechStatus={speechStatus} speechProgress={speechProgress} teleprompterMode={teleprompterMode}
            scriptParagraphs={scriptParagraphs} activeSection={activeSection}
            teleprompterRef={teleprompterRef} fontSize={fontSize} setFontSize={setFontSize}
            scrollSpeed={scrollSpeed} setScrollSpeed={setScrollSpeed}
          />
        )}

        {activeTab === "goals" && <GoalsView goals={goals} documents={documents} humorMaterials={humorMaterials} profile={profile} busy={goalBusy} setBusy={setGoalBusy} reload={reloadLocalData} chooseGoal={chooseGoal} setNotice={setNotice} />}
        {activeTab === "knowledge" && <KnowledgeView documents={documents} busy={knowledgeBusy} feishuUrl={feishuUrl} setFeishuUrl={setFeishuUrl} importFiles={importFiles} importFeishu={importFeishu} deleteDocument={async (id) => { await db.documents.delete(id); await reloadLocalData(); }} />}
        {activeTab === "humor" && <HumorView materials={humorMaterials} reload={reloadLocalData} setNotice={setNotice} />}
        {activeTab === "review" && <ReviewView latestSession={latestSession} sessions={sessions} review={review} goals={goals} selectRound={selectRound} setActiveTab={setActiveTab} setLatestSession={(session) => { setLatestSession(session); setReview(buildLocalReview(session.transcript, session.metrics, getScenario(session.scenarioId))); }} downloadRecording={downloadRecording} deleteSession={deleteSession} />}
      </section>

      {onboardingOpen && <OnboardingModal initial={profile ?? DEFAULT_PROFILE} onClose={() => { setOnboardingOpen(false); void savePreferences({ onboardingDismissed: true }); }} onSave={async (next) => { await db.profiles.put(next); setProfile(next); setOnboardingOpen(false); setNotice("个人目标已保存在本机。现在可以创建第一个训练目标。"); setActiveTab("goals"); }} />}
    </main>
  );
}

interface PracticeViewProps {
  scenario: PracticeScenario; activeGoal: TrainingGoal | null; roundIndex: 1 | 2 | 3; selectRound: (index: 1 | 2 | 3) => void;
  isPracticing: boolean; cameraReady: boolean; recording: boolean; cameraCollapsed: boolean; cameraHeight: number;
  videoRef: React.RefObject<HTMLVideoElement | null>; visionStatus: string; aiStatus: string; mediaError: string;
  prepareCamera: () => void; startPractice: () => void; stopPractice: () => void; stopCamera: () => void; toggleCameraCollapsed: () => void;
  beginCameraResize: (event: React.PointerEvent<HTMLButtonElement>) => void; resetPractice: () => void;
  turns: ConversationTurn[]; interimTranscript: string; requestAudience: () => void;
  intensity: AudienceIntensity; setIntensity: (value: AudienceIntensity) => void;
  chooseScenario: (kind: ScenarioKind, language: TrainingLanguage) => void;
  scrollMode: ScrollMode; changeScrollMode: (mode: ScrollMode) => void; speechStatus: string; speechProgress: number;
  teleprompterMode: TeleprompterMode; scriptParagraphs: string[]; activeSection: number;
  teleprompterRef: React.RefObject<HTMLElement | null>;
  fontSize: number; setFontSize: (value: number) => void; scrollSpeed: number; setScrollSpeed: (value: number) => void;
}

function PracticeView({
  scenario, activeGoal, roundIndex, selectRound, isPracticing, cameraReady,
  recording, cameraCollapsed, cameraHeight, videoRef, visionStatus, aiStatus,
  mediaError, prepareCamera, startPractice, stopPractice, stopCamera,
  toggleCameraCollapsed, beginCameraResize, resetPractice, turns,
  interimTranscript, requestAudience, intensity, setIntensity, chooseScenario,
  scrollMode, changeScrollMode, speechStatus, speechProgress, teleprompterMode,
  scriptParagraphs, activeSection, teleprompterRef, fontSize, setFontSize,
  scrollSpeed, setScrollSpeed,
}: PracticeViewProps) {
  const roundStates = activeGoal?.rounds ?? createPracticeRounds();
  const content = teleprompterMode === "cues" ? scenario.cues : scriptParagraphs;
  return <>
    <div className="round-stepper" aria-label="三轮训练">
      {roundStates.map((round) => <button key={round.index} className={`${round.index === roundIndex ? "active" : ""} ${round.status}`} onClick={() => selectRound(round.index)} disabled={isPracticing}><span>{round.status === "completed" ? <Check size={14} /> : round.index}</span><strong>第 {round.index} 轮</strong><small>{ROUND_LABELS[round.mode]}</small></button>)}
    </div>
    <div className="practice-layout">
      <section className="stage-column">
        <div className={`camera-panel panel ${cameraCollapsed ? "collapsed" : ""}`}>
          <div className="panel-head compact">
            <div><p className="section-label">镜头预览</p><h2>{cameraCollapsed ? (recording ? "画面已收起 · 仍在录制" : "画面已收起") : "像现场一样练"}</h2></div>
            <div className="panel-actions"><span className="privacy-badge"><ShieldCheck size={14} /> 本地分析</span><button className="icon-button" title={cameraCollapsed ? "展开摄像头" : "收起摄像头"} onClick={toggleCameraCollapsed}>{cameraCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</button></div>
          </div>
          {!cameraCollapsed && <>
            <div className="video-frame" style={{ height: cameraHeight }}>
              <video ref={videoRef} muted playsInline />
              {!cameraReady && <div className="video-empty"><Camera size={34} /><strong>摄像头尚未开启</strong><span>建议镜头包含头部、肩膀和双手活动区域</span></div>}
              <div className="video-overlay"><span>{visionStatus}</span><span>{aiStatus}</span></div>
            </div>
            <button className="camera-resize-handle" title="拖动调整预览高度" onPointerDown={beginCameraResize}><GripHorizontal size={20} /></button>
          </>}
          {mediaError && <p className="error-text">{mediaError}</p>}
          <div className="stage-actions">
            {!cameraReady && <button className="button secondary" onClick={prepareCamera}><Camera size={17} />开启摄像头</button>}
            {!isPracticing ? <button className="button primary" onClick={startPractice}><Play size={17} fill="currentColor" />用这段练习</button> : <button className="button danger" onClick={stopPractice}><CircleStop size={17} />结束并复盘</button>}
            {cameraReady && <button className="button ghost" onClick={stopCamera} disabled={isPracticing} title={isPracticing ? "请先结束本轮" : "停止摄像头和麦克风"}><Power size={16} />关闭摄像头</button>}
            <button className="icon-button" title="重置本轮内容" onClick={resetPractice} disabled={isPracticing}><RotateCcw size={18} /></button>
          </div>
        </div>

        <div className="conversation-panel panel">
          <div className="panel-head compact"><div><p className="section-label">真实听众</p><h2>现场反应与转写</h2></div><button className="button ghost" onClick={requestAudience} disabled={!isPracticing}><Users size={16} />请听众回应</button></div>
          <div className="turn-list">
            {!turns.length && !interimTranscript && <div className="empty-copy">开始说话后，转写和听众追问会出现在这里。</div>}
            {turns.map((turn) => <div key={turn.id} className={`turn ${turn.role}`}><span>{turn.role === "speaker" ? "你" : turn.role === "audience" ? "听众" : "系统"}</span><p>{turn.text}</p></div>)}
            {interimTranscript && <div className="turn speaker interim"><span>识别中</span><p>{interimTranscript}</p></div>}
          </div>
        </div>
      </section>

      <aside className="coach-column">
        <section className="panel controls-panel">
          <p className="section-label">练习设置</p>
          <label>训练语言<div className="segmented two"><button className={scenario.language === "zh-CN" ? "active" : ""} onClick={() => chooseScenario(scenario.kind, "zh-CN")}><Languages size={14} />中文</button><button className={scenario.language === "en-US" ? "active" : ""} onClick={() => chooseScenario(scenario.kind, "en-US")}><Languages size={14} />English</button></div></label>
          <label>场景<select value={scenario.kind} onChange={(event) => chooseScenario(event.target.value as ScenarioKind, scenario.language)} disabled={isPracticing}>{Object.entries(SCENARIO_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>听众强度<div className="segmented">{(["friendly", "balanced", "challenging"] as AudienceIntensity[]).map((value) => <button key={value} className={intensity === value ? "active" : ""} onClick={() => setIntensity(value)}>{INTENSITY_LABELS[value]}</button>)}</div></label>
          <div className="goal-box"><span>本轮目标</span><p>{scenario.goal}</p></div>
        </section>

        <section className="panel teleprompter-panel" ref={teleprompterRef}>
          <div className="panel-head sticky-head"><div><p className="section-label">现场台词卡 · {ROUND_LABELS[teleprompterMode]}</p><h2>{scenario.title}</h2></div><button className="icon-button" title="全屏提词" onClick={() => teleprompterRef.current?.requestFullscreen()}><Maximize2 size={17} /></button></div>
          <div className="follow-toolbar">
            <div className="segmented two"><button className={scrollMode === "speech" ? "active" : ""} onClick={() => changeScrollMode("speech")}><Mic size={14} />语音跟随</button><button className={scrollMode === "manual" ? "active" : ""} onClick={() => changeScrollMode("manual")}><Play size={14} />匀速滚动</button></div>
            <div className="follow-progress"><span>{scrollMode === "speech" ? speechStatus : `速度 ${scrollSpeed}`}</span><i><b style={{ width: `${Math.round(speechProgress * 100)}%` }} /></i></div>
          </div>
          {teleprompterMode === "hidden" ? <div className="hidden-script"><EyeOff size={28} /><strong>台词已隐藏</strong><span>系统仍会记录识别进度。现在只依靠结构和现场感表达。</span></div> : <div className={`script-text ${teleprompterMode}`} style={{ fontSize: fontSize }}>{content.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 12)}`} data-teleprompter-section={index} className={index === activeSection ? "active" : ""}>{teleprompterMode === "cues" ? `${index + 1}. ${paragraph}` : paragraph}</p>)}</div>}
          <div className="teleprompter-tools"><label>字号 <input type="range" min="18" max="38" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></label><label className={scrollMode === "speech" ? "disabled" : ""}>速度 <input type="range" min="0" max="5" value={scrollSpeed} disabled={scrollMode === "speech"} onChange={(event) => setScrollSpeed(Number(event.target.value))} /></label></div>
        </section>
      </aside>
    </div>
  </>;
}

function GoalsView({ goals, documents, humorMaterials, profile, busy, setBusy, reload, chooseGoal, setNotice }: {
  goals: TrainingGoal[]; documents: KnowledgeDocument[]; humorMaterials: HumorMaterial[]; profile: UserProfile | null;
  busy: boolean; setBusy: (value: boolean) => void; reload: () => Promise<void>; chooseGoal: (goal: TrainingGoal) => Promise<void>;
  setNotice: (value: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [scenarioKind, setScenarioKind] = useState<ScenarioKind>("live-speaking");
  const [language, setLanguage] = useState<TrainingLanguage>(profile?.languages[0] ?? "zh-CN");
  const [targetDate, setTargetDate] = useState(todayPlus(21));
  const [audience, setAudience] = useState("");
  const [desiredOutcome, setDesiredOutcome] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(180);
  const [humorLevel, setHumorLevel] = useState<HumorLevel>("light");
  const [successCriteria, setSuccessCriteria] = useState("结构完整\n表达自然\n听众愿意进入下一步");
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [selectedHumor, setSelectedHumor] = useState<string[]>([]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const now = new Date().toISOString();
    const goalBase = { title: title.trim(), scenarioKind, targetDate, audience, desiredOutcome, durationSeconds, language, humorLevel, successCriteria: successCriteria.split(/\n|，|,/).map((item) => item.trim()).filter(Boolean) };
    const knowledgeContext = documents.filter((document) => selectedDocs.includes(document.id)).flatMap((document) => document.chunks.map((chunk) => chunk.text)).join("\n\n").slice(0, 10000);
    const humorContext = humorMaterials.filter((item) => selectedHumor.includes(item.id)).map((item) => `${item.title}: ${item.content}`).join("\n").slice(0, 4000);
    let plan: GoalPlan = buildLocalGoalPlan(goalBase);
    let source = "本地模板";
    try {
      const response = await fetch("/api/goals/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: profile ?? undefined, goal: goalBase, knowledgeContext, humorContext }) });
      if (response.ok) { const payload = await response.json() as { plan: GoalPlan; source: string }; plan = payload.plan; source = payload.source === "ai" ? "AI" : "本地模板"; }
    } catch { /* Local plan already exists. */ }
    const goal: TrainingGoal = { id: crypto.randomUUID(), ...goalBase, knowledgeDocumentIds: selectedDocs, humorMaterialIds: selectedHumor, plan, rounds: createPracticeRounds(), createdAt: now, updatedAt: now };
    await db.goals.put(goal);
    await reload();
    setBusy(false);
    setTitle("");
    setNotice(`目标已创建，计划来自${source}。台词和关键词可继续编辑。`);
    await chooseGoal(goal);
  };

  const updatePlan = async (goal: TrainingGoal, plan: GoalPlan) => { await db.goals.put({ ...goal, plan, updatedAt: new Date().toISOString() }); await reload(); };
  return <div className="goals-layout">
    <form className="panel goal-form" onSubmit={submit}>
      <div className="panel-head"><div><p className="section-label">新训练目标</p><h2>先定义你想让听众做什么</h2></div></div>
      <div className="form-grid">
        <label className="span-2">目标名称<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：Demo Day 三分钟融资陈述" /></label>
        <label>场景<select value={scenarioKind} onChange={(event) => { const value = event.target.value as ScenarioKind; setScenarioKind(value); if (value !== "live-speaking" && humorLevel === "medium") setHumorLevel("light"); }}>{Object.entries(SCENARIO_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>语言<select value={language} onChange={(event) => setLanguage(event.target.value as TrainingLanguage)}><option value="zh-CN">中文</option><option value="en-US">English</option></select></label>
        <label>目标日期<input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
        <label>时长（秒）<input type="number" min="30" max="3600" value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} /></label>
        <label className="span-2">目标听众<textarea value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="他们是谁、懂多少、最在意什么" /></label>
        <label className="span-2">期望结果<textarea required value={desiredOutcome} onChange={(event) => setDesiredOutcome(event.target.value)} placeholder="练完以后，希望听众理解、相信或采取什么行动" /></label>
        <label>幽默程度<select value={humorLevel} onChange={(event) => setHumorLevel(event.target.value as HumorLevel)}><option value="none">不需要</option><option value="light">轻度</option><option value="medium">适中</option></select></label>
        <label className="span-2">成功标准<textarea value={successCriteria} onChange={(event) => setSuccessCriteria(event.target.value)} /></label>
      </div>
      {!!documents.length && <fieldset><legend>关联知识材料</legend>{documents.map((document) => <label className="check-row" key={document.id}><input type="checkbox" checked={selectedDocs.includes(document.id)} onChange={() => setSelectedDocs((current) => current.includes(document.id) ? current.filter((id) => id !== document.id) : [...current, document.id])} />{document.title}</label>)}</fieldset>}
      {!!humorMaterials.length && <fieldset><legend>关联个人幽默素材</legend>{humorMaterials.map((item) => <label className="check-row" key={item.id}><input type="checkbox" checked={selectedHumor.includes(item.id)} onChange={() => setSelectedHumor((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />{item.title}</label>)}</fieldset>}
      <button className="button primary" disabled={busy || !title.trim() || !desiredOutcome.trim()}><Sparkles size={16} />{busy ? "正在生成训练计划" : "生成三轮计划"}</button>
    </form>

    <section className="goal-list">
      {!goals.length && <div className="panel no-review"><Target size={34} /><h2>还没有训练目标</h2><p>创建目标后，系统会为同一场景安排完整台词、关键词和脱稿三轮。</p></div>}
      {goals.map((goal) => <article className="panel goal-item" key={goal.id}>
        <div className="goal-item-head"><div><p className="section-label">{SCENARIO_LABELS[goal.scenarioKind]} · {goal.language === "en-US" ? "English" : "中文"}</p><h2>{goal.title}</h2><span>{goal.targetDate || "未设日期"} · {Math.round(goal.durationSeconds / 60)} 分钟</span></div><button className="button primary" onClick={() => void chooseGoal(goal)}><Play size={16} />继续训练</button></div>
        <div className="round-mini">{goal.rounds.map((round) => <span key={round.index} className={round.status}><b>{round.status === "completed" ? "✓" : round.index}</b>{ROUND_LABELS[round.mode]}{round.score !== undefined && <em>{round.score}</em>}</span>)}</div>
        <details><summary>编辑台词与关键词</summary><label>完整台词<textarea value={goal.plan.script} onChange={(event) => void updatePlan(goal, { ...goal.plan, script: event.target.value })} /></label><label>关键词（每行一个）<textarea value={goal.plan.cues.join("\n")} onChange={(event) => void updatePlan(goal, { ...goal.plan, cues: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} /></label></details>
        <button className="icon-button goal-delete" title="删除目标" onClick={async () => { await db.goals.delete(goal.id); await reload(); }}><Trash2 size={16} /></button>
      </article>)}
    </section>
  </div>;
}

function KnowledgeView({ documents, busy, feishuUrl, setFeishuUrl, importFiles, importFeishu, deleteDocument }: { documents: KnowledgeDocument[]; busy: boolean; feishuUrl: string; setFeishuUrl: (value: string) => void; importFiles: (files: FileList | null) => Promise<void>; importFeishu: () => Promise<void>; deleteDocument: (id: string) => Promise<void> }) {
  return <div className="knowledge-layout"><section className="panel import-panel"><div className="panel-head"><div><p className="section-label">本地资料</p><h2>导入你的知识与台本</h2></div><span className="privacy-badge"><ShieldCheck size={14} /> 存在浏览器内</span></div><label className="upload-zone"><Upload size={28} /><strong>{busy ? "正在处理资料" : "选择 DOCX、PDF、Markdown 或 TXT"}</strong><span>文件会在本机解析和建立索引</span><input type="file" multiple accept=".docx,.pdf,.md,.txt" onChange={(event) => void importFiles(event.target.files)} disabled={busy} /></label><div className="divider"><span>或连接云端</span></div><div className="feishu-import"><input value={feishuUrl} onChange={(event) => setFeishuUrl(event.target.value)} placeholder="粘贴飞书 docx 或 wiki 链接" /><button className="button primary" onClick={() => void importFeishu()} disabled={busy || !feishuUrl.trim()}><Import size={16} />读取飞书</button></div><p className="helper-text">飞书连接器需要在 `.env.local` 配置只读应用凭证。</p></section><section className="panel library-panel"><div className="panel-head"><div><p className="section-label">资料库</p><h2>{documents.length} 份可用资料</h2></div></div><div className="document-list">{!documents.length && <div className="empty-copy">导入资料后，目标生成器和真实听众会使用相关片段。</div>}{documents.map((document) => <div className="document-row" key={document.id}><div className="document-icon">{document.source === "feishu" ? <Library size={19} /> : <FileText size={19} />}</div><div><strong>{document.title}</strong><span>{document.source === "feishu" ? "飞书" : "本地文件"} · {document.chunks.length} 个片段</span></div><button className="icon-button" title="删除资料" onClick={() => void deleteDocument(document.id)}><Trash2 size={17} /></button></div>)}</div></section></div>;
}

function HumorView({ materials, reload, setNotice }: { materials: HumorMaterial[]; reload: () => Promise<void>; setNotice: (value: string) => void }) {
  const [type, setType] = useState<HumorMaterialType>("observation");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState<TrainingLanguage>("zh-CN");
  const [boundary, setBoundary] = useState("不涉及个人隐私，不攻击具体个人或群体");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const now = new Date().toISOString();
    await db.humorMaterials.put({ id: crypto.randomUUID(), type, title, content, language, scenarioKinds: ["live-speaking"], audienceBoundary: boundary, sensitiveTopics: [], tags: [], createdAt: now, updatedAt: now });
    setTitle(""); setContent(""); await reload(); setNotice("幽默素材已保存在本机，可关联到训练目标。");
  };
  return <div className="humor-layout"><section className="method-band"><div className="section-heading"><div><p className="section-label">方法卡</p><h2>把幽默当成可练习的表达能力</h2></div><p>以下方法为公开资料主题的转述，不复制书籍正文，也不模仿特定作者文风。</p></div><div className="method-grid">{HUMOR_METHODS.map((method) => <article className="method-card" key={method.id}><Lightbulb size={19} /><h3>{method.title[language]}</h3><p>{method.summary[language]}</p><strong>{method.exercise[language]}</strong></article>)}</div><div className="source-links"><span>合法公开来源：</span>{HUMOR_SOURCES.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}</a>)}</div></section><div className="humor-workspace"><form className="panel humor-form" onSubmit={submit}><div className="panel-head"><div><p className="section-label">个人素材库</p><h2>记录真实观察与故事</h2></div></div><label>类型<select value={type} onChange={(event) => setType(event.target.value as HumorMaterialType)}>{Object.entries(HUMOR_TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>语言<select value={language} onChange={(event) => setLanguage(event.target.value as TrainingLanguage)}><option value="zh-CN">中文</option><option value="en-US">English</option></select></label><label>标题<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="一句能帮助你想起来的标题" /></label><label>素材<textarea required value={content} onChange={(event) => setContent(event.target.value)} placeholder="发生了什么？反差在哪里？你的真实感受是什么？" /></label><label>受众边界<textarea value={boundary} onChange={(event) => setBoundary(event.target.value)} /></label><button className="button primary"><Plus size={16} />保存素材</button></form><section className="panel material-list"><div className="panel-head"><div><p className="section-label">仅存本机</p><h2>{materials.length} 条个人素材</h2></div></div>{!materials.length && <div className="empty-copy">先记录，不急着写成笑话。真实细节往往比“造梗”更耐用。</div>}{materials.map((item) => <article className="material-row" key={item.id}><div><span>{HUMOR_TYPE_LABELS[item.type]} · {item.language === "en-US" ? "EN" : "中文"}</span><strong>{item.title}</strong><p>{item.content}</p><small>边界：{item.audienceBoundary}</small></div><button className="icon-button" title="删除素材" onClick={async () => { await db.humorMaterials.delete(item.id); await reload(); }}><Trash2 size={16} /></button></article>)}</section></div></div>;
}

function ReviewView({ latestSession, sessions, review, goals, selectRound, setActiveTab, setLatestSession, downloadRecording, deleteSession }: { latestSession: SessionRecord | null; sessions: SessionRecord[]; review: ReviewReport | null; goals: TrainingGoal[]; selectRound: (index: 1 | 2 | 3) => void; setActiveTab: (tab: AppTab) => void; setLatestSession: (session: SessionRecord) => void; downloadRecording: (session: SessionRecord) => void; deleteSession: (id: string) => Promise<void> }) {
  if (!latestSession) return <section className="panel no-review"><Video size={34} /><h2>还没有练习记录</h2><p>完成一轮后，这里会出现录像、表达时间轴和三轮对比。</p><button className="button primary" onClick={() => setActiveTab("practice")}><Play size={16} />开始第一轮</button></section>;
  const goal = goals.find((item) => item.id === latestSession.goalId);
  const goalSessions = goal ? sessions.filter((session) => session.goalId === goal.id) : [];
  const next = latestSession.roundIndex && latestSession.roundIndex < 3 ? (latestSession.roundIndex + 1) as 2 | 3 : null;
  return <div className="review-layout"><section className="review-main"><div className="panel review-summary"><div className="score-ring"><strong>{review?.overallScore ?? goal?.rounds.find((round) => round.sessionId === latestSession.id)?.score ?? "--"}</strong><span>本轮表现</span></div><div><p className="section-label">{latestSession.roundMode ? ROUND_LABELS[latestSession.roundMode] : "本轮结论"}</p><h2>{review?.summary ?? "选择一条记录查看本地指标。"}</h2><p>{new Date(latestSession.startedAt).toLocaleString("zh-CN")} · {formatTime(Math.round(latestSession.durationMs / 1000))}</p></div></div>{next && <div className="next-round-bar"><div><strong>本轮已完成</strong><span>下一轮不会自动开始，你可以先复盘或重新练习。</span></div><button className="button primary" onClick={() => selectRound(next)}>进入第 {next} 轮 <ArrowRight size={16} /></button></div>}{goal && <section className="panel round-comparison"><div className="panel-head"><div><p className="section-label">三轮对比</p><h2>同一目标的脱稿变化</h2></div></div><div className="comparison-grid">{([1, 2, 3] as const).map((index) => { const item = goalSessions.find((session) => session.roundIndex === index); const state = goal.rounds.find((round) => round.index === index); return <div key={index} className={item ? "complete" : ""}><span>第 {index} 轮 · {ROUND_LABELS[index === 1 ? "full" : index === 2 ? "cues" : "hidden"]}</span><strong>{state?.score ?? "--"}</strong><small>{item ? `${item.metrics.wordsPerMinute} ${item.language === "en-US" ? "wpm" : "字/分"} · 镜头 ${item.metrics.cameraFacingRatio}%` : "尚未练习"}</small></div>; })}</div></section>}{latestSession.videoBlob && <LocalVideo blob={latestSession.videoBlob} />}<div className="metrics-grid panel"><MetricCard label={latestSession.language === "en-US" ? "Words/min" : "语速"} value={latestSession.metrics.wordsPerMinute} suffix={latestSession.language === "en-US" ? "" : " 字/分"} /><MetricCard label="填充词" value={latestSession.metrics.fillerCount} /><MetricCard label="面向镜头" value={latestSession.metrics.cameraFacingRatio} suffix="%" /><MetricCard label="双手可见" value={latestSession.metrics.handsVisibleRatio} suffix="%" /><MetricCard label="手势活动" value={latestSession.metrics.gestureRate} suffix="%" /><MetricCard label="身体晃动" value={latestSession.metrics.bodySway} suffix="%" /></div><section className="panel timeline-panel"><div className="panel-head compact"><div><p className="section-label">表达时间轴</p><h2>音量与镜头连接</h2></div></div><MetricTimeline points={latestSession.metricTimeline} /></section>{review && <section className="panel feedback-grid"><div><p className="section-label positive">做得好的</p>{review.strengths.map((item) => <p key={item}>{item}</p>)}</div><div><p className="section-label caution">优先改进</p>{review.improvements.map((item) => <p key={item}>{item}</p>)}</div><div><p className="section-label action">下一轮练习</p>{review.nextPractice.map((item) => <p key={item}>{item}</p>)}</div></section>}</section><aside className="panel session-history"><p className="section-label">本地记录</p><h2>练习历史</h2>{sessions.map((session) => <div className={`session-row ${latestSession.id === session.id ? "active" : ""}`} key={session.id}><button onClick={() => setLatestSession(session)}><strong>{getScenario(session.scenarioId).title}{session.roundIndex ? ` · 第 ${session.roundIndex} 轮` : ""}</strong><span>{new Date(session.startedAt).toLocaleString("zh-CN")}</span></button><div><button title="下载录像" disabled={!session.videoBlob} onClick={() => downloadRecording(session)}><Download size={15} /></button><button title="永久删除" onClick={() => void deleteSession(session.id)}><Trash2 size={15} /></button></div></div>)}</aside></div>;
}

function OnboardingModal({ initial, onClose, onSave }: { initial: UserProfile; onClose: () => void; onSave: (profile: UserProfile) => Promise<void> }) {
  const [role, setRole] = useState(initial.role);
  const [industry, setIndustry] = useState(initial.industry);
  const [experience, setExperience] = useState<UserProfile["experience"]>(initial.experience);
  const [language, setLanguage] = useState<TrainingLanguage>(initial.languages[0] ?? "zh-CN");
  const [primaryGoal, setPrimaryGoal] = useState(initial.primaryGoal);
  const [preferredStyle, setPreferredStyle] = useState(initial.preferredStyle);
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="设置训练画像"><form className="onboarding-modal" onSubmit={(event) => { event.preventDefault(); void onSave({ id: "local-profile", role, industry, experience, languages: [language], primaryGoal, preferredStyle, onboardingComplete: true, updatedAt: new Date().toISOString() }); }}><button className="modal-close" type="button" title="跳过" onClick={onClose}><X size={18} /></button><p className="section-label">首次设置 · 只存本机</p><h2>你希望成为怎样的表达者？</h2><p>这些信息会帮助目标生成器选择场景、难度和反馈重点，之后可以随时修改。</p><div className="form-grid"><label>你的角色<input value={role} onChange={(event) => setRole(event.target.value)} placeholder="创始人 / 主持人 / 销售负责人" /></label><label>行业<input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="AI / 消费 / 教育" /></label><label>经验<select value={experience} onChange={(event) => setExperience(event.target.value as UserProfile["experience"])}><option value="beginner">刚开始系统练习</option><option value="intermediate">有一些公开表达经验</option><option value="advanced">经常演讲或路演</option></select></label><label>常用语言<select value={language} onChange={(event) => setLanguage(event.target.value as TrainingLanguage)}><option value="zh-CN">中文</option><option value="en-US">English</option></select></label><label className="span-2">主要目标<textarea value={primaryGoal} onChange={(event) => setPrimaryGoal(event.target.value)} placeholder="例如：面对投资人时更清晰、更有说服力" /></label><label className="span-2">偏好风格<input value={preferredStyle} onChange={(event) => setPreferredStyle(event.target.value)} /></label></div><div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>暂时跳过</button><button className="button primary">保存并创建目标</button></div></form></div>;
}

function LocalVideo({ blob }: { blob: Blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <div className="panel playback-panel"><video controls src={url} /><div><ShieldCheck size={15} />这段录像来自本机 IndexedDB，没有上传到服务端。</div></div>;
}

function MetricTimeline({ points }: { points: SessionRecord["metricTimeline"] }) {
  if (!points.length) return <div className="empty-copy">本轮没有可用的视觉时间轴。</div>;
  const sampled = points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 60)) === 0).slice(0, 60);
  return <div className="timeline-chart" aria-label="表达时间轴">{sampled.map((point) => <div className="timeline-column" key={point.timestampMs}><i style={{ height: `${Math.max(4, point.volume * 100)}%` }} /><b style={{ height: `${Math.max(4, point.cameraFacing * 100)}%` }} /></div>)}</div>;
}
