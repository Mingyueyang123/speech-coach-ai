"use client";

import {
  ArrowRight, Camera, Check, ChevronDown, ChevronRight, ChevronUp,
  CircleStop, Download, EyeOff, FileText, Gauge, GripHorizontal, Import,
  Languages, Library, Lightbulb, Maximize2, MessageCircle, Mic, Play, Send,
  Power, Settings, RotateCcw, ShieldCheck, Sparkles, Target, Trash2, Upload, Users, Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiSettings } from "@/components/ApiSettings";
import { VoiceInput } from "@/components/VoiceInput";
import { startRecognizer } from "@/lib/speech-client";
import { AudiencePlayer } from "@/lib/audience-player";
import type { SettingsStatus, SpeechRecognizer, ProviderSnapshot } from "@/lib/providers/contracts";
import { FloatingTools, PracticeClock } from "@/components/FloatingTools";
import { useMediaSession } from "@/hooks/useMediaSession";
import { buildLocalReview, calculateDeliveryMetrics } from "@/lib/analysis";
import { db } from "@/lib/db";
import { buildLocalGoalPlan, createPracticeRounds, DEFAULT_PROFILE, nextRoundIndex } from "@/lib/goals";
import { HUMOR_METHODS, HUMOR_SOURCES } from "@/lib/humor";
import { chunkText, parseKnowledgeFile, searchKnowledge } from "@/lib/knowledge";
import { getScenario, getScenarioByKind, SCENARIOS } from "@/lib/scenarios";
import { findSpeechProgress, progressToSection } from "@/lib/speech-follow";
import type {
  AppPreferences, AudienceIntensity, ConversationTurn, GoalPlan,
  HumorMaterial, KnowledgeDocument, PracticeScenario,
  ReviewReport, ScenarioKind, ScrollMode, SessionRecord, TeleprompterMode,
  TrainingGoal, TrainingLanguage, UserProfile,
} from "@/lib/types";

type AppTab = "practice" | "goals" | "knowledge" | "humor" | "review" | "settings";

const DEFAULT_PREFERENCES: AppPreferences = {
  id: "app-preferences", cameraHeight: 420, cameraCollapsed: false,
  scrollMode: "speech", onboardingDismissed: false, updatedAt: new Date(0).toISOString(),
};

const TAB_LABELS: Array<{ id: AppTab; label: string; icon: typeof Mic }> = [
  { id: "practice", label: "练习", icon: Mic },
  { id: "goals", label: "目标", icon: Target },
  { id: "knowledge", label: "知识库", icon: Library },
  { id: "humor", label: "灵感素材", icon: Lightbulb },
  { id: "review", label: "复盘", icon: Gauge },
  { id: "settings", label: "API 配置", icon: Settings },
];

const INTENSITY_LABELS: Record<AudienceIntensity, string> = { friendly: "友好", balanced: "正常", challenging: "挑战" };
const ROUND_LABELS: Record<TeleprompterMode, string> = { full: "完整台词", cues: "关键词", hidden: "脱稿" };
const SCENARIO_LABELS: Record<ScenarioKind, string> = { "investor-pitch": "投资人 Pitch", "client-roadshow": "客户路演", "live-speaking": "线下演讲 / 主持" };
function formatTime(totalSeconds: number): string {
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
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
  const [, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const turnsRef = useRef<ConversationTurn[]>([]);
  const addTurn = (turn: ConversationTurn) => { turnsRef.current = [...turnsRef.current, turn]; setTurns(turnsRef.current); };
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
  const recognitionRef = useRef<SpeechRecognizer | null>(null);
  const recognitionAbort = useRef<AbortController | null>(null);
  const audienceAbort = useRef<AbortController | null>(null);
  const audiencePlayer = useRef<AudiencePlayer | null>(null);
  const providerRef = useRef<SettingsStatus | null>(null);
  const snapshotRef = useRef<ProviderSnapshot | undefined>(undefined);
  const [recognitionDisconnected, setRecognitionDisconnected] = useState(false);
  const [connectingSpeech, setConnectingSpeech] = useState(false);
  const practicingRef = useRef(false);
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const spokenTextRef = useRef("");
  const progressRef = useRef(0);
  const missedMatchesRef = useRef(0);
  const followRef = useRef<(text: string, final: boolean) => void>(() => {});
  const speechModeRef = useRef<ScrollMode>("speech");

  const {
    videoRef, stream: mediaStream, cameraReady, recording, visionStatus, error: mediaError,
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

  const setSpeechMatch = useCallback((spoken: string, final: boolean) => {
    if (speechModeRef.current !== "speech") return;
    if (spoken.trim().length < (scenario.language === "en-US" ? 8 : 4)) return;
    const match = findSpeechProgress(scenario.script, spoken, scenario.language, progressRef.current);
    if (!match.matched) {
      if (!final) return;
      missedMatchesRef.current += 1;
      setSpeechStatus(`正在重新定位 ${missedMatchesRef.current}/4`);
      if (missedMatchesRef.current >= 4) {
        setSpeechStatus("识别连续偏离，已切到匀速滚动");
        setNotice("语音跟随暂时无法定位台词，已暂停自动滚动，可手动调整。");
        setScrollSpeed(0);
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
  }, [savePreferences, scenario, scriptParagraphs.length, teleprompterMode]);

  useEffect(() => { followRef.current = setSpeechMatch; speechModeRef.current = scrollMode; }, [setSpeechMatch, scrollMode]);

  const cancelAudience = () => { audienceAbort.current?.abort(); audiencePlayer.current?.cancel(); };
  useEffect(() => () => {
    recognitionAbort.current?.abort(); void recognitionRef.current?.stop();
    audienceAbort.current?.abort(); audiencePlayer.current?.cancel();
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const connectSpeech = async (stream: MediaStream, settings: SettingsStatus) => {
    setConnectingSpeech(true); setRecognitionDisconnected(false);
    recognitionAbort.current?.abort();
    const controller = new AbortController(); recognitionAbort.current = controller;
    const failed = (message: string) => {
      if (!practicingRef.current) return;
      controller.abort(); recognitionRef.current = null;
      setSpeechStatus("语音跟随暂停"); setAiStatus(message); setRecognitionDisconnected(true); setScrollSpeed(0);
    };
    try {
      const connection = await startRecognizer({ provider: settings.bindings.recognition, stream, language: scenario.language, signal: controller.signal,
        onStatus: setSpeechStatus, onError: failed,
        onUpdate: update => {
          if (controller.signal.aborted) return;
          cancelAudience();
          if (update.final) {
            spokenTextRef.current += `${spokenTextRef.current ? "\n" : ""}${update.text}`;
            setTranscript(spokenTextRef.current);
            addTurn({ id: update.id, role: "speaker", text: update.text, timestampMs: Date.now() });
          }
          setInterimTranscript(update.final ? "" : update.text);
          followRef.current(`${spokenTextRef.current} ${update.final ? "" : update.text}`, update.final);
        },
      });
      if (!practicingRef.current || controller.signal.aborted) await connection.stop();
      else { recognitionRef.current = connection; setAiStatus("听众待命 · 点击回应后才提问"); }
    } catch (e) { if (!controller.signal.aborted) failed(e instanceof Error ? e.message : "语音连接失败"); }
    finally { setConnectingSpeech(false); }
  };

  const resetPractice = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setTurns([]);
    turnsRef.current = [];
    snapshotRef.current = undefined;
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
    if (startingRef.current || stoppingRef.current || practicingRef.current) return;
    startingRef.current = true;
    try {
      const stream = await prepareMedia();
      resetPractice();
      startedAtRef.current = Date.now();
      startRecording();
      practicingRef.current = true;
      setIsPracticing(true);
      setNotice(`第 ${roundIndex} 轮进行中：${ROUND_LABELS[teleprompterMode]}。`);
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250);
      try {
        const status = await fetch("/api/settings", { signal: AbortSignal.timeout(5000) }).then(r => r.json()) as SettingsStatus;
        if (!practicingRef.current) return;
        providerRef.current = status;
        snapshotRef.current = { ...status.bindings, textModel: status.bindings.text === "deepseek" ? status.models.deepseek : status.reviewModel,
          recognitionModel: status.bindings.recognition === "aliyun" ? status.models.aliyun : status.bindings.recognition === "openai" ? status.realtimeModel : status.bindings.recognition,
          synthesisModel: status.bindings.synthesis === "minimax" ? status.models.minimax : status.bindings.synthesis === "openai" ? "gpt-4o-mini-tts" : "off" };
        await connectSpeech(stream, status);
      } catch (cause) {
        if (!practicingRef.current) return;
        setAiStatus(cause instanceof Error ? cause.message : "无法读取语音配置");
        setRecognitionDisconnected(true);
      }
    } catch {
      setNotice("练习未开始：需要允许摄像头和麦克风权限。");
    } finally { startingRef.current = false; }
  };

  const requestAudience = async () => {
    cancelAudience(); const controller = new AbortController(); audienceAbort.current = controller;
    setAiStatus("听众正在准备问题");
    try {
      const response = await fetch("/api/audience", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ language: scenario.language, title: scenario.title, goal: scenario.goal, persona: scenario.audiencePersona, intensity,
          transcript: spokenTextRef.current.slice(-8000), knowledgeContext: knowledgeContext.slice(0, 6000), previousQuestions: turns.filter(t => t.role === "audience").slice(-5).map(t => t.text.slice(0, 1200)) }),
      });
      if (!response.ok) throw new Error("听众请求失败，请重试");
      const data = await response.json(); controller.signal.throwIfAborted();
      if (!practicingRef.current) return;
      addTurn({ id: crypto.randomUUID(), role: "audience", text: data.question, timestampMs: Date.now() });
      setAiStatus(data.source === "local" ? "本地模板问题 · 所选文本服务不可用" : "AI 听众提问 · 合成声音");
      if (providerRef.current?.bindings.synthesis !== "off") {
        audiencePlayer.current ??= new AudiencePlayer();
        await audiencePlayer.current.play(data.question, scenario.language, controller.signal);
      }
    } catch (e) { if (!controller.signal.aborted) setAiStatus(e instanceof Error ? e.message : "听众回应失败"); }
  };

  const stopPracticeSession = async () => {
    if (stoppingRef.current || !practicingRef.current) return;
    stoppingRef.current = true;
    try {
    if (timerRef.current) clearInterval(timerRef.current);
    practicingRef.current = false;
    cancelAudience();
    await recognitionRef.current?.stop();
    recognitionRef.current = null;
    recognitionAbort.current?.abort();
    setIsPracticing(false);
    setInterimTranscript("");
    setAiStatus("真实听众待机");
    const videoBlob = await stopRecording();
    const durationMs = Math.max(1000, Date.now() - startedAtRef.current);
    const metricTimeline = getMetricTimeline();
    const transcript = spokenTextRef.current.trim();
    const metrics = calculateDeliveryMetrics(transcript, durationMs, metricTimeline, scenario.language);
    const session: SessionRecord = {
      id: crypto.randomUUID(), scenarioId: scenario.id.split(":")[0], goalId: activeGoal?.id,
      roundMode: teleprompterMode, roundIndex, language: scenario.language,
      providers: snapshotRef.current,
      speechFollowProgress: progressRef.current, startedAt: new Date(startedAtRef.current).toISOString(),
      durationMs, transcript, turns: turnsRef.current, metricTimeline, metrics, ...(videoBlob ? { videoBlob } : {}),
    };
    await db.sessions.put(session);
    setLatestSession(session);
    setSessions((current) => [session, ...current]);

    let nextReview = buildLocalReview(transcript, metrics, scenario);
    let localReview = true;
    try {
      const response = await fetch("/api/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: transcript.slice(-30000), metrics, scenario: { title: scenario.title, goal: scenario.goal, rubric: scenario.rubric, prompts: scenario.prompts, language: scenario.language }, knowledgeContext }),
      });
      if (response.ok) { nextReview = await response.json() as ReviewReport; localReview = false; }
    } catch { /* Local review remains available offline. */ }
    if (localReview) nextReview = { ...nextReview, summary: `${scenario.language === "en-US" ? "Local template review: " : "本地模板复盘："}${nextReview.summary}` };
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
    } catch { setNotice("本轮处理未完成，请检查浏览器可用存储空间。已有记录不会被清空。"); }
    finally { stoppingRef.current = false; }
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
        : activeTab === "humor" ? "灵感素材库"
          : activeTab === "settings" ? "API 配置" : "练习复盘";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block"><div className="brand-mark"><Mic size={20} /></div><div><strong>Speech Coach AI</strong><span>本地优先的演讲陪练</span></div></div>
        <nav className="main-nav" aria-label="主导航">
          {TAB_LABELS.map(({ id, label, icon: Icon }) => (
            <button key={id} aria-label={label} title={label} className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}>
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

        <div hidden={activeTab !== "practice"}>
          <PracticeView
            elapsed={elapsed}
            scenario={scenario} activeGoal={activeGoal} roundIndex={roundIndex} selectRound={selectRound}
            isPracticing={isPracticing} cameraReady={cameraReady} recording={recording} cameraCollapsed={preferences.cameraCollapsed}
            cameraHeight={preferences.cameraHeight} videoRef={videoRef} visionStatus={visionStatus} aiStatus={aiStatus}
            mediaError={mediaError} prepareCamera={prepareCamera} startPractice={startPractice} stopPractice={stopPracticeSession}
            stopCamera={() => { stopCamera(); setNotice("摄像头和麦克风已关闭。"); }} toggleCameraCollapsed={toggleCameraCollapsed}
            beginCameraResize={beginCameraResize} resetPractice={resetPractice} turns={turns} interimTranscript={interimTranscript}
            requestAudience={requestAudience} intensity={intensity} setIntensity={setIntensity}
            cancelAudience={cancelAudience} recognitionDisconnected={recognitionDisconnected} connectingSpeech={connectingSpeech}
            reconnectSpeech={() => { if (mediaStream && providerRef.current) void connectSpeech(mediaStream, providerRef.current); }}
            chooseScenario={chooseScenario} scrollMode={scrollMode} changeScrollMode={changeScrollMode}
            speechStatus={speechStatus} speechProgress={speechProgress} teleprompterMode={teleprompterMode}
            scriptParagraphs={scriptParagraphs} activeSection={activeSection}
            teleprompterRef={teleprompterRef} fontSize={fontSize} setFontSize={setFontSize}
            scrollSpeed={scrollSpeed} setScrollSpeed={setScrollSpeed}
          />
        </div>
        {activeTab === "settings" && (isPracticing ? <p role="status">本轮正在录制。结束练习后可调整服务商配置。</p> : <ApiSettings />)}

        {activeTab === "goals" && <GoalsView goals={goals} documents={documents} profile={profile} busy={goalBusy} setBusy={setGoalBusy} reload={reloadLocalData} chooseGoal={chooseGoal} setNotice={setNotice} />}
        {activeTab === "knowledge" && <KnowledgeView documents={documents} busy={knowledgeBusy} feishuUrl={feishuUrl} setFeishuUrl={setFeishuUrl} importFiles={importFiles} importFeishu={importFeishu} deleteDocument={async (id) => { await db.documents.delete(id); await reloadLocalData(); }} />}
        {activeTab === "humor" && <HumorView materials={humorMaterials} documents={documents} busy={knowledgeBusy} importFiles={importFiles} openKnowledge={() => setActiveTab("knowledge")} reload={reloadLocalData} setNotice={setNotice} />}
        {activeTab === "review" && <ReviewView latestSession={latestSession} sessions={sessions} review={review} goals={goals} selectRound={selectRound} setActiveTab={setActiveTab} setLatestSession={(session) => { setLatestSession(session); setReview(buildLocalReview(session.transcript, session.metrics, getScenario(session.scenarioId))); }} downloadRecording={downloadRecording} deleteSession={deleteSession} />}
      </section>

      {onboardingOpen && <OnboardingModal onClose={() => { setOnboardingOpen(false); void savePreferences({ onboardingDismissed: true }); }} onStart={async () => { const next = { ...DEFAULT_PROFILE, onboardingComplete: true, updatedAt: new Date().toISOString() }; await db.profiles.put(next); setProfile(next); setOnboardingOpen(false); setNotice("不用先填画像，直接告诉教练你准备面对谁、在什么时候讲什么。"); setActiveTab("goals"); }} />}
    </main>
  );
}

interface PracticeViewProps {
  elapsed: number;
  scenario: PracticeScenario; activeGoal: TrainingGoal | null; roundIndex: 1 | 2 | 3; selectRound: (index: 1 | 2 | 3) => void;
  isPracticing: boolean; cameraReady: boolean; recording: boolean; cameraCollapsed: boolean; cameraHeight: number;
  videoRef: React.RefObject<HTMLVideoElement | null>; visionStatus: string; aiStatus: string; mediaError: string;
  prepareCamera: () => void; startPractice: () => void; stopPractice: () => void; stopCamera: () => void; toggleCameraCollapsed: () => void;
  beginCameraResize: (event: React.PointerEvent<HTMLButtonElement>) => void; resetPractice: () => void;
  turns: ConversationTurn[]; interimTranscript: string; requestAudience: () => void;
  cancelAudience: () => void; recognitionDisconnected: boolean; connectingSpeech: boolean; reconnectSpeech: () => void;
  intensity: AudienceIntensity; setIntensity: (value: AudienceIntensity) => void;
  chooseScenario: (kind: ScenarioKind, language: TrainingLanguage) => void;
  scrollMode: ScrollMode; changeScrollMode: (mode: ScrollMode) => void; speechStatus: string; speechProgress: number;
  teleprompterMode: TeleprompterMode; scriptParagraphs: string[]; activeSection: number;
  teleprompterRef: React.RefObject<HTMLElement | null>;
  fontSize: number; setFontSize: (value: number) => void; scrollSpeed: number; setScrollSpeed: (value: number) => void;
}

function PracticeView({
  elapsed, scenario, activeGoal, roundIndex, selectRound, isPracticing, cameraReady,
  recording, cameraCollapsed, cameraHeight, videoRef, visionStatus, aiStatus,
  mediaError, prepareCamera, startPractice, stopPractice, stopCamera,
  toggleCameraCollapsed, beginCameraResize, resetPractice, turns,
  interimTranscript, requestAudience, intensity, setIntensity, chooseScenario,
  cancelAudience, recognitionDisconnected, connectingSpeech, reconnectSpeech,
  scrollMode, changeScrollMode, speechStatus, speechProgress, teleprompterMode,
  scriptParagraphs, activeSection, teleprompterRef, fontSize, setFontSize,
  scrollSpeed, setScrollSpeed,
}: PracticeViewProps) {
  const [settingsHidden, setSettingsHidden] = useState(false);
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
          <div hidden={cameraCollapsed}>
            <div className="video-frame" style={{ height: cameraHeight }}>
              <video ref={videoRef} muted playsInline />
              {!cameraReady && <div className="video-empty"><Camera size={34} /><strong>摄像头尚未开启</strong><span>建议镜头包含头部、肩膀和双手活动区域</span></div>}
              <div className="video-overlay"><span>{visionStatus}</span><span>{aiStatus}</span></div>
            </div>
            <button className="camera-resize-handle" title="拖动调整预览高度" onPointerDown={beginCameraResize}><GripHorizontal size={20} /></button>
          </div>
          {mediaError && <p className="error-text">{mediaError}</p>}
          <div className="stage-actions">
            {!cameraReady && <button className="button secondary" onClick={prepareCamera}><Camera size={17} />开启摄像头</button>}
            {!isPracticing ? <button className="button primary" onClick={startPractice}><Play size={17} fill="currentColor" />用这段练习</button> : <button className="button danger" onClick={stopPractice}><CircleStop size={17} />结束并复盘</button>}
            {cameraReady && <button className="button ghost" onClick={stopCamera} disabled={isPracticing} title={isPracticing ? "请先结束本轮" : "停止摄像头和麦克风"}><Power size={16} />关闭摄像头</button>}
            <button className="icon-button" title="重置本轮内容" onClick={resetPractice} disabled={isPracticing}><RotateCcw size={18} /></button>
          </div>
        </div>

        <div className="conversation-panel panel">
          <div className="panel-head compact"><div><p className="section-label">真实听众</p><h2>现场反应与转写</h2></div><div className="settings-actions"><button className="button ghost" onClick={requestAudience} disabled={!isPracticing}><Users size={16} />请听众回应</button><button className="icon-button" title="停止听众配音和待播放内容" onClick={cancelAudience} disabled={!isPracticing}><CircleStop size={18} /></button>{recognitionDisconnected && <button className="button secondary" onClick={reconnectSpeech} disabled={!isPracticing || connectingSpeech}><RotateCcw size={16} />{connectingSpeech ? "连接中" : "重连识别"}</button>}</div></div>
          <div className="turn-list">
            {!turns.length && !interimTranscript && <div className="empty-copy">开始说话后，转写和听众追问会出现在这里。</div>}
            {turns.map((turn) => <div key={turn.id} className={`turn ${turn.role}`}><span>{turn.role === "speaker" ? "你" : turn.role === "audience" ? "听众" : "系统"}</span><p>{turn.text}</p></div>)}
            {interimTranscript && <div className="turn speaker interim"><span>识别中</span><p>{interimTranscript}</p></div>}
          </div>
        </div>
      </section>

      <aside className="coach-column">
        <section className="panel controls-panel">
          <div className="panel-head compact"><h2>练习设置</h2><button className="icon-button" title={settingsHidden ? "展开练习设置" : "收起练习设置"} onClick={() => setSettingsHidden(!settingsHidden)}>{settingsHidden ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</button></div>
          <div hidden={settingsHidden} className="practice-setting-fields">
          <div className="setting-field">训练语言<div className="segmented two" role="group" aria-label="训练语言"><button className={scenario.language === "zh-CN" ? "active" : ""} onClick={() => chooseScenario(scenario.kind, "zh-CN")}><Languages size={14} />中文</button><button className={scenario.language === "en-US" ? "active" : ""} onClick={() => chooseScenario(scenario.kind, "en-US")}><Languages size={14} />English</button></div></div>
          <label>场景<select value={scenario.kind} onChange={(event) => chooseScenario(event.target.value as ScenarioKind, scenario.language)} disabled={isPracticing}>{Object.entries(SCENARIO_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className="setting-field">听众强度<div className="segmented" role="group" aria-label="听众强度">{(["friendly", "balanced", "challenging"] as AudienceIntensity[]).map((value) => <button key={value} className={intensity === value ? "active" : ""} onClick={() => setIntensity(value)}>{INTENSITY_LABELS[value]}</button>)}</div></div>
          <div className="goal-box"><span>本轮目标</span><p>{scenario.goal}</p></div>
          </div>
        </section>

        <FloatingTools>
        <PracticeClock elapsed={elapsed} practicing={isPracticing} />
        <section className="panel teleprompter-panel" ref={teleprompterRef}>
          <div className="sticky-head"><div className="panel-head"><div><p className="section-label">现场台词卡 · {ROUND_LABELS[teleprompterMode]}</p><h2>{scenario.title}</h2></div><button className="icon-button" title="全屏提词" onClick={() => teleprompterRef.current?.requestFullscreen()}><Maximize2 size={17} /></button></div>
          <div className="follow-toolbar">
            <div className="segmented two"><button className={scrollMode === "speech" ? "active" : ""} onClick={() => changeScrollMode("speech")}><Mic size={14} />语音跟随</button><button className={scrollMode === "manual" ? "active" : ""} onClick={() => changeScrollMode("manual")}><Play size={14} />匀速滚动</button></div>
            <div className="follow-progress"><span>{scrollMode === "speech" ? speechStatus : `速度 ${scrollSpeed}`}</span><i><b style={{ width: `${Math.round(speechProgress * 100)}%` }} /></i></div>
          </div>
          </div>
          {teleprompterMode === "hidden" ? <div className="hidden-script"><EyeOff size={28} /><strong>台词已隐藏</strong><span>系统仍会记录识别进度。现在只依靠结构和现场感表达。</span></div> : <div className={`script-text ${teleprompterMode}`} style={{ fontSize: fontSize }}>{content.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 12)}`} data-teleprompter-section={index} className={index === activeSection ? "active" : ""}>{teleprompterMode === "cues" ? `${index + 1}. ${paragraph}` : paragraph}</p>)}</div>}
          <div className="teleprompter-tools"><label>字号 <input type="range" min="18" max="38" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></label><label className={scrollMode === "speech" ? "disabled" : ""}>速度 <input type="range" min="0" max="5" value={scrollSpeed} disabled={scrollMode === "speech"} onChange={(event) => setScrollSpeed(Number(event.target.value))} /></label></div>
        </section>
        </FloatingTools>
      </aside>
    </div>
  </>;
}

interface GoalDraft {
  title: string;
  scenarioKind: ScenarioKind;
  targetDate: string;
  audience: string;
  desiredOutcome: string;
  durationSeconds: number;
  language: TrainingLanguage;
  humorLevel: "none" | "light" | "medium";
  successCriteria: string[];
}

interface ChatLine { id: string; role: "assistant" | "user"; text: string }

function GoalsView({ goals, documents, profile, busy, setBusy, reload, chooseGoal, setNotice }: {
  goals: TrainingGoal[]; documents: KnowledgeDocument[]; profile: UserProfile | null;
  busy: boolean; setBusy: (value: boolean) => void; reload: () => Promise<void>; chooseGoal: (goal: TrainingGoal) => Promise<void>;
  setNotice: (value: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [inputLanguage, setInputLanguage] = useState<TrainingLanguage>(profile?.languages[0] ?? "zh-CN");
  const [chat, setChat] = useState<ChatLine[]>([{ id: "welcome", role: "assistant", text: "告诉我：你准备在什么时间、面对谁、完成一次怎样的表达？一段自然的话就够了。" }]);

  const createFromConversation = async () => {
    const userText = message.trim();
    if (!userText || busy) return;
    setMessage("");
    setChat((current) => [...current, { id: crypto.randomUUID(), role: "user", text: userText }]);
    setBusy(true);
    try {
      const understandResponse = await fetch("/api/goals/understand", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, profile: profile ?? undefined }),
      });
      if (!understandResponse.ok) throw new Error("目标拆解失败");
      const { draft } = await understandResponse.json() as { draft: GoalDraft };
      const knowledgeContext = searchKnowledge(documents, `${draft.title} ${draft.desiredOutcome}`).map(chunk => chunk.text).join("\n\n").slice(0, 10000);
      let plan: GoalPlan = buildLocalGoalPlan(draft);
      let source = "本地模板";
      try {
        const response = await fetch("/api/goals/plan", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: profile ?? undefined, goal: draft, knowledgeContext, humorContext: "" }),
        });
        if (response.ok) {
          const payload = await response.json() as { plan: GoalPlan; source: string };
          plan = payload.plan;
          source = payload.source === "ai" ? "AI" : "本地模板";
        }
      } catch { /* The structured local plan remains available. */ }
      const now = new Date().toISOString();
      const goal: TrainingGoal = {
        id: crypto.randomUUID(), ...draft, knowledgeDocumentIds: documents.map((document) => document.id),
        humorMaterialIds: [], plan, rounds: createPracticeRounds(), createdAt: now, updatedAt: now,
      };
      await db.goals.put(goal);
      await reload();
      setChat((current) => [...current, {
        id: crypto.randomUUID(), role: "assistant",
        text: `我已经整理好了：${SCENARIO_LABELS[draft.scenarioKind]}，目标日期 ${draft.targetDate}，面向${draft.audience}。训练目标是“${draft.desiredOutcome}”。三轮计划来自${source}。`,
      }]);
      setNotice("目标已从对话中拆解并保存。确认后可以直接开始第一轮。");
    } catch {
      setChat((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: "我暂时没能整理这段话。请再说一次，最好带上场合、对象和日期。" }]);
    } finally { setBusy(false); }
  };

  return <div className="conversation-workspace">
    <section className="panel coach-chat">
      <div className="panel-head"><div><p className="section-label">目标对话</p><h2>把目标说出来，其余交给教练</h2></div><div className="segmented two language-mini" aria-label="对话识别语言"><button className={inputLanguage === "zh-CN" ? "active" : ""} onClick={() => setInputLanguage("zh-CN")}>中文</button><button className={inputLanguage === "en-US" ? "active" : ""} onClick={() => setInputLanguage("en-US")}>EN</button></div></div>
      <div className="coach-chat-body">{chat.map((line) => <div key={line.id} className={`coach-message ${line.role}`}><span>{line.role === "assistant" ? "教练" : "你"}</span><p>{line.text}</p></div>)}{busy && <div className="coach-message assistant pending"><span>教练</span><p>正在识别场景、日期和训练重点...</p></div>}</div>
      <div className="chat-composer"><textarea aria-label="描述训练目标" value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void createFromConversation(); } }} placeholder="例如：下个月 20 号我要向一群早期投资人做 3 分钟英文 Pitch，希望他们愿意约下一次会。" /><VoiceInput key={inputLanguage} language={inputLanguage} disabled={busy} onText={text => setMessage(current => `${current}${current ? " " : ""}${text}`)} /><button className="icon-button send-button" title="发送" disabled={!message.trim() || busy} onClick={() => void createFromConversation()}><Send size={18} /></button></div>
      <p className="chat-hint">按 Enter 发送，Shift + Enter 换行。已导入的知识资料会自动参与计划生成。</p>
    </section>

    <section className="goal-list">
      {!goals.length && <div className="panel no-review"><Target size={34} /><h2>还没有训练目标</h2><p>创建目标后，系统会为同一场景安排完整台词、关键词和脱稿三轮。</p></div>}
      {goals.map((goal) => <article className="panel goal-item" key={goal.id}>
        <div className="goal-item-head"><div><p className="section-label">{SCENARIO_LABELS[goal.scenarioKind]} · {goal.language === "en-US" ? "English" : "中文"}</p><h2>{goal.title}</h2><span>{goal.targetDate || "未设日期"} · {Math.round(goal.durationSeconds / 60)} 分钟</span></div><button className="button primary" onClick={() => void chooseGoal(goal)}><Play size={16} />继续训练</button></div>
        <div className="round-mini">{goal.rounds.map((round) => <span key={round.index} className={round.status}><b>{round.status === "completed" ? "✓" : round.index}</b>{ROUND_LABELS[round.mode]}{round.score !== undefined && <em>{round.score}</em>}</span>)}</div>
        <button className="icon-button goal-delete" title="删除目标" onClick={async () => { await db.goals.delete(goal.id); await reload(); }}><Trash2 size={16} /></button>
      </article>)}
    </section>
  </div>;
}

function KnowledgeView({ documents, busy, feishuUrl, setFeishuUrl, importFiles, importFeishu, deleteDocument }: { documents: KnowledgeDocument[]; busy: boolean; feishuUrl: string; setFeishuUrl: (value: string) => void; importFiles: (files: FileList | null) => Promise<void>; importFeishu: () => Promise<void>; deleteDocument: (id: string) => Promise<void> }) {
  return <div className="knowledge-layout"><section className="panel import-panel"><div className="panel-head"><div><p className="section-label">本地资料</p><h2>导入你的知识与台本</h2></div><span className="privacy-badge"><ShieldCheck size={14} /> 存在浏览器内</span></div><label className="upload-zone"><Upload size={28} /><strong>{busy ? "正在处理资料" : "选择 DOCX、PDF、Markdown 或 TXT"}</strong><span>文件会在本机解析和建立索引</span><input type="file" multiple accept=".docx,.pdf,.md,.txt" onChange={(event) => void importFiles(event.target.files)} disabled={busy} /></label><div className="divider"><span>或连接云端</span></div><div className="feishu-import"><input value={feishuUrl} onChange={(event) => setFeishuUrl(event.target.value)} placeholder="粘贴飞书 docx 或 wiki 链接" /><button className="button primary" onClick={() => void importFeishu()} disabled={busy || !feishuUrl.trim()}><Import size={16} />读取飞书</button></div><p className="helper-text">飞书连接器需要在 `.env.local` 配置只读应用凭证。</p></section><section className="panel library-panel"><div className="panel-head"><div><p className="section-label">资料库</p><h2>{documents.length} 份可用资料</h2></div></div><div className="document-list">{!documents.length && <div className="empty-copy">导入资料后，目标生成器和真实听众会使用相关片段。</div>}{documents.map((document) => <div className="document-row" key={document.id}><div className="document-icon">{document.source === "feishu" ? <Library size={19} /> : <FileText size={19} />}</div><div><strong>{document.title}</strong><span>{document.source === "feishu" ? "飞书" : "本地文件"} · {document.chunks.length} 个片段</span></div><button className="icon-button" title="删除资料" onClick={() => void deleteDocument(document.id)}><Trash2 size={17} /></button></div>)}</div></section></div>;
}

function HumorView({ materials, documents, busy, importFiles, openKnowledge, reload, setNotice }: { materials: HumorMaterial[]; documents: KnowledgeDocument[]; busy: boolean; importFiles: (files: FileList | null) => Promise<void>; openKnowledge: () => void; reload: () => Promise<void>; setNotice: (value: string) => void }) {
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState<ChatLine[]>([{ id: "material-welcome", role: "assistant", text: "想到什么就直接说，不用先分类。我会帮你整理成以后能用于演讲、故事或幽默表达的素材。" }]);
  const [language, setLanguage] = useState<TrainingLanguage>("zh-CN");

  const organizeMaterial = async () => {
    const userText = message.trim();
    if (!userText || busy) return;
    setMessage("");
    setChat((current) => [...current, { id: crypto.randomUUID(), role: "user", text: userText }]);
    try {
      const response = await fetch("/api/materials/organize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: userText, language }) });
      if (!response.ok) throw new Error("素材整理失败");
      const { material, source } = await response.json() as { material: Omit<HumorMaterial, "id" | "createdAt" | "updatedAt">; source: string };
      const now = new Date().toISOString();
      const stored: HumorMaterial = { ...material, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
      await db.humorMaterials.put(stored);
      await reload();
      setChat((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: `已经替你整理为“${stored.title}”。${source === "local" ? "当前使用本地模板，所选文本服务未配置或未成功调用。" : "我保留了原意，并标记了适合使用的场景和受众边界。"}` }]);
      setNotice("灵感已经由对话整理并保存在本机素材库。");
    } catch {
      setChat((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: "这段灵感暂时没能整理，请稍后再说一次。" }]);
    }
  };

  return <div className="humor-layout">
    <section className="material-sources" aria-label="素材导入方式">
      <button onClick={openKnowledge}><Library size={22} /><strong>外部知识库</strong><span>连接飞书文档或 Wiki</span></button>
      <label className={busy ? "disabled" : ""}><Upload size={22} /><strong>{busy ? "正在导入" : "上传文档"}</strong><span>DOCX、PDF、Markdown、TXT</span><input type="file" multiple accept=".docx,.pdf,.md,.txt" disabled={busy} onChange={(event) => void importFiles(event.target.files)} /></label>
      <button onClick={() => { document.querySelector<HTMLButtonElement>(".material-chat .voice-input button")?.click(); }}><Mic size={22} /><strong>语音记录</strong><span>识别后确认整理</span></button>
    </section>
    <div className="humor-workspace">
      <section className="panel coach-chat material-chat">
        <div className="panel-head"><div><p className="section-label">灵感对话</p><h2>说出来，教练替你整理</h2></div><div className="segmented two language-mini"><button className={language === "zh-CN" ? "active" : ""} onClick={() => setLanguage("zh-CN")}>中文</button><button className={language === "en-US" ? "active" : ""} onClick={() => setLanguage("en-US")}>EN</button></div></div>
        <div className="coach-chat-body">{chat.map((line) => <div key={line.id} className={`coach-message ${line.role}`}><span>{line.role === "assistant" ? "教练" : "你"}</span><p>{line.text}</p></div>)}</div>
        <div className="chat-composer"><textarea aria-label="讲述灵感素材" value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void organizeMaterial(); } }} placeholder="比如：今天开会时我发现，大家说要拥抱 AI，最后最忙的是复制粘贴的人..." /><VoiceInput language={language} disabled={busy} onText={text => setMessage(current => `${current}${current ? " " : ""}${text}`)} /><button className="icon-button send-button" title="发送并整理" disabled={!message.trim() || busy} onClick={() => void organizeMaterial()}><Send size={18} /></button></div>
      </section>
      <section className="panel material-list"><div className="panel-head"><div><p className="section-label">自动整理 · 仅存本机</p><h2>{materials.length} 条灵感素材</h2></div><span className="library-count">另有 {documents.length} 份知识资料</span></div>{!materials.length && <div className="empty-copy">这里没有需要填写的表单。讲一段经历或观察，教练会自动整理。</div>}{materials.map((item) => <article className="material-row" key={item.id}><div><span>{item.language === "en-US" ? "English" : "中文"}</span><strong>{item.title}</strong><p>{item.content}</p><small>边界：{item.audienceBoundary}</small></div><button className="icon-button" title="删除素材" onClick={async () => { await db.humorMaterials.delete(item.id); await reload(); }}><Trash2 size={16} /></button></article>)}</section>
    </div>
    <section className="method-band"><div className="section-heading"><div><p className="section-label">训练方法</p><h2>从灵感到可讲述的素材</h2></div><p>以下方法为公开资料主题的转述，不复制书籍正文，也不模仿特定作者文风。</p></div><div className="method-grid">{HUMOR_METHODS.map((method) => <article className="method-card" key={method.id}><Lightbulb size={19} /><h3>{method.title[language]}</h3><p>{method.summary[language]}</p><strong>{method.exercise[language]}</strong></article>)}</div><div className="source-links"><span>合法公开来源：</span>{HUMOR_SOURCES.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}</a>)}</div></section>
  </div>;
}

function ReviewView({ latestSession, sessions, review, goals, selectRound, setActiveTab, setLatestSession, downloadRecording, deleteSession }: { latestSession: SessionRecord | null; sessions: SessionRecord[]; review: ReviewReport | null; goals: TrainingGoal[]; selectRound: (index: 1 | 2 | 3) => void; setActiveTab: (tab: AppTab) => void; setLatestSession: (session: SessionRecord) => void; downloadRecording: (session: SessionRecord) => void; deleteSession: (id: string) => Promise<void> }) {
  if (!latestSession) return <section className="panel no-review"><Video size={34} /><h2>还没有练习记录</h2><p>完成一轮后，这里会出现录像、表达时间轴和三轮对比。</p><button className="button primary" onClick={() => setActiveTab("practice")}><Play size={16} />开始第一轮</button></section>;
  const goal = goals.find((item) => item.id === latestSession.goalId);
  const goalSessions = goal ? sessions.filter((session) => session.goalId === goal.id) : [];
  const next = latestSession.roundIndex && latestSession.roundIndex < 3 ? (latestSession.roundIndex + 1) as 2 | 3 : null;
  return <div className="review-layout"><section className="review-main"><div className="panel review-summary"><div className="score-ring"><strong>{review?.overallScore ?? goal?.rounds.find((round) => round.sessionId === latestSession.id)?.score ?? "--"}</strong><span>本轮表现</span></div><div><p className="section-label">{latestSession.roundMode ? ROUND_LABELS[latestSession.roundMode] : "本轮结论"}</p><h2>{review?.summary ?? "选择一条记录查看本地指标。"}</h2><p>{new Date(latestSession.startedAt).toLocaleString("zh-CN")} · {formatTime(Math.round(latestSession.durationMs / 1000))}</p></div></div>{next && <div className="next-round-bar"><div><strong>本轮已完成</strong><span>下一轮不会自动开始，你可以先复盘或重新练习。</span></div><button className="button primary" onClick={() => selectRound(next)}>进入第 {next} 轮 <ArrowRight size={16} /></button></div>}{goal && <section className="panel round-comparison"><div className="panel-head"><div><p className="section-label">三轮对比</p><h2>同一目标的脱稿变化</h2></div></div><div className="comparison-grid">{([1, 2, 3] as const).map((index) => { const item = goalSessions.find((session) => session.roundIndex === index); const state = goal.rounds.find((round) => round.index === index); return <div key={index} className={item ? "complete" : ""}><span>第 {index} 轮 · {ROUND_LABELS[index === 1 ? "full" : index === 2 ? "cues" : "hidden"]}</span><strong>{state?.score ?? "--"}</strong><small>{item ? `${item.metrics.wordsPerMinute} ${item.language === "en-US" ? "wpm" : "字/分"} · 镜头 ${item.metrics.cameraFacingRatio}%` : "尚未练习"}</small></div>; })}</div></section>}{latestSession.videoBlob && <LocalVideo blob={latestSession.videoBlob} />}<div className="metrics-grid panel"><MetricCard label={latestSession.language === "en-US" ? "Words/min" : "语速"} value={latestSession.metrics.wordsPerMinute} suffix={latestSession.language === "en-US" ? "" : " 字/分"} /><MetricCard label="填充词" value={latestSession.metrics.fillerCount} /><MetricCard label="面向镜头" value={latestSession.metrics.cameraFacingRatio} suffix="%" /><MetricCard label="双手可见" value={latestSession.metrics.handsVisibleRatio} suffix="%" /><MetricCard label="手势活动" value={latestSession.metrics.gestureRate} suffix="%" /><MetricCard label="身体晃动" value={latestSession.metrics.bodySway} suffix="%" /></div><section className="panel timeline-panel"><div className="panel-head compact"><div><p className="section-label">表达时间轴</p><h2>音量与镜头连接</h2></div></div><MetricTimeline points={latestSession.metricTimeline} /></section>{review && <section className="panel feedback-grid"><div><p className="section-label positive">做得好的</p>{review.strengths.map((item) => <p key={item}>{item}</p>)}</div><div><p className="section-label caution">优先改进</p>{review.improvements.map((item) => <p key={item}>{item}</p>)}</div><div><p className="section-label action">下一轮练习</p>{review.nextPractice.map((item) => <p key={item}>{item}</p>)}</div></section>}</section><aside className="panel session-history"><p className="section-label">本地记录</p><h2>练习历史</h2>{sessions.map((session) => <div className={`session-row ${latestSession.id === session.id ? "active" : ""}`} key={session.id}><button onClick={() => setLatestSession(session)}><strong>{getScenario(session.scenarioId).title}{session.roundIndex ? ` · 第 ${session.roundIndex} 轮` : ""}</strong><span>{new Date(session.startedAt).toLocaleString("zh-CN")}</span></button><div><button title="下载录像" disabled={!session.videoBlob} onClick={() => downloadRecording(session)}><Download size={15} /></button><button title="永久删除" onClick={() => void deleteSession(session.id)}><Trash2 size={15} /></button></div></div>)}</aside></div>;
}

function OnboardingModal({ onClose, onStart }: { onClose: () => void; onStart: () => Promise<void> }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="开始使用"><section className="onboarding-modal minimal"><button className="modal-close" type="button" title="跳过" onClick={onClose}><X size={18} /></button><div className="onboarding-symbol"><MessageCircle size={28} /></div><p className="section-label">不填画像 · 从对话开始</p><h2>把你要面对的那一刻，说给教练听</h2><p>不用设置角色、行业或成功标准。告诉我你准备在什么时候、面对谁、讲什么，我会在对话里逐步理解你，并自动整理成目标和三轮训练。</p><div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>暂时跳过</button><button className="button primary" onClick={() => void onStart()}><MessageCircle size={16} />开始对话</button></div></section></div>;
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
