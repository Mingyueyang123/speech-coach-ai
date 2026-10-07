"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Brain, Check, GitCompareArrows, History, Pencil, Save, Sparkles, Trash2, X } from "lucide-react";
import { db } from "@/lib/db";
import { coachingSchema, comparableSessions, generatedScriptSchema, groundedCoaching, relevantMemories, scriptCues, selectScriptSources, sentenceDiff, type ScriptCoaching, type ScriptRequest } from "@/lib/script-coach";
import type { CoachMemory, KnowledgeDocument, PracticeScenario, ScriptVersion, SessionRecord } from "@/lib/types";

export interface ScriptSave {
  script: string; cues: string[]; sourceDocumentIds: string[]; sourceSessionId?: string;
  memoryIds: string[]; origin: ScriptVersion["origin"];
}
interface Props {
  scenario: PracticeScenario;
  documents: KnowledgeDocument[];
  sessions: SessionRecord[];
  versions: ScriptVersion[];
  memories: CoachMemory[];
  initialTab?: "edit" | "sources" | "learn" | "memory";
  initialSessionId?: string;
  onSave: (value: ScriptSave) => Promise<void>;
  onRefresh: () => Promise<void>;
  onClose: () => void;
  onKnowledge: () => void;
}

export function ScriptStudio(p: Props) {
  const [tab, setTab] = useState(p.initialTab ?? "edit");
  const [draft, setDraft] = useState(p.scenario.script);
  const [cues, setCues] = useState(p.scenario.cues);
  const [dirty, setDirty] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<string[]>(p.scenario.knowledgeDocumentIds);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [origin, setOrigin] = useState<ScriptVersion["origin"]>("manual");
  const [usedDocuments, setUsedDocuments] = useState<string[]>(p.scenario.knowledgeDocumentIds);
  const [usedMemories, setUsedMemories] = useState<string[]>([]);
  const [sourceSessionId, setSourceSessionId] = useState<string>();
  const [useMemory, setUseMemory] = useState(true);
  const [analysis, setAnalysis] = useState<ScriptCoaching | null>(null);
  const [analysisSource, setAnalysisSource] = useState("");
  const [checkedHabits, setCheckedHabits] = useState<number[]>([]);
  const records = useMemo(() => comparableSessions(p.sessions, p.scenario.id), [p.sessions, p.scenario.id]);
  const [selectedSessionId, setSelectedSessionId] = useState(p.initialSessionId ?? records[0]?.id ?? "");
  const selectedSession = records.find(s => s.id === selectedSessionId);
  const baseline = selectedSession?.scenarioSnapshot?.script;
  const peers = records.filter(s => s.scenarioSnapshot?.script === baseline);
  const memory = relevantMemories(p.memories, p.scenario);
  const versions = p.versions.filter(v => v.scopeKey === p.scenario.id);
  const diff = useMemo(() => baseline && selectedSession ? sentenceDiff(baseline, selectedSession.transcript) : null, [baseline, selectedSession]);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { mounted.current = true; panel.current?.focus(); return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const close = () => {
    if (!dirty || window.confirm("台本草稿尚未保存，放弃这次修改？")) { controller.current?.abort(); p.onClose(); }
  };
  const edit = (text: string) => { setDraft(text); setCues(scriptCues(text)); setDirty(true); setOrigin("manual"); };
  const replaceDraft = (text: string, nextOrigin: ScriptVersion["origin"], nextCues = scriptCues(text)) => {
    if (dirty && !window.confirm("用新草稿替换当前未保存的修改？")) return false;
    setDraft(text); setCues(nextCues); setOrigin(nextOrigin); setDirty(true); setTab("edit"); return true;
  };
  async function save() {
    if (!draft.trim() || draft.length > 30000) { setStatus("台本应为 1–30000 字符。"); return; }
    setBusy(true);
    try {
      await p.onSave({ script: draft.trim(), cues: cues.length ? cues : scriptCues(draft), origin, sourceDocumentIds: usedDocuments, sourceSessionId, memoryIds: usedMemories });
      if (mounted.current) { setDirty(false); setStatus("新版本已启用，下一轮从这份台本开始。旧稿与练习记录仍保留。"); }
    } catch (error) { if (mounted.current) setStatus(error instanceof Error ? error.message : "保存失败，请重试。"); }
    finally { if (mounted.current) setBusy(false); }
  }
  function payload(operation: ScriptRequest["operation"], fromSession: boolean): ScriptRequest {
    const session = fromSession ? selectedSession : undefined;
    const snapshot = session?.scenarioSnapshot ?? p.scenario;
    return {
      operation,
      scenario: { kind: snapshot.kind, language: snapshot.language, title: snapshot.title.slice(0, 200), goal: snapshot.goal.slice(0, 1500), durationSeconds: Math.max(30, Math.min(7200, snapshot.durationSeconds)) },
      original: session?.scenarioSnapshot?.script ?? draft,
      transcript: session?.transcript ?? "",
      instruction,
      sources: operation === "generate" ? selectScriptSources(p.documents, selectedDocs, `${p.scenario.title} ${p.scenario.goal} ${instruction}`) : [],
      memories: useMemory ? memory.map(({ rule, kind }) => ({ rule, kind })) : [],
      ...(session ? { metrics: { wordsPerMinute: session.metrics.wordsPerMinute, fillerCount: session.metrics.fillerCount, pauseCount: session.metrics.pauseCount } } : {}),
      ...(session?.review ? { review: { overallScore: session.review.overallScore, improvements: session.review.improvements.slice(0, 3).map(t => t.slice(0, 1000)), source: session.reviewSource ?? "unknown" } } : {}),
    };
  }
  async function coach(operation: ScriptRequest["operation"], fromSession = false) {
    if (fromSession && (!selectedSession || !baseline)) return;
    if (operation === "generate" && !fromSession && !selectedDocs.length) { setStatus("先选一份资料，或直接在台本中编辑。"); return; }
    setBusy(true); setStatus("");
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    try {
      const body = payload(operation, fromSession);
      const response = await fetch("/api/scripts/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: abort.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "处理失败，原稿未改动。");
      if (!mounted.current || abort.signal.aborted) return;
      if (operation === "learn") {
        setAnalysis(groundedCoaching(coachingSchema.parse(data.analysis), body.original, body.transcript)); setAnalysisSource(data.source === "ai" ? "AI 对照 · 待你确认" : "本地逐句对照 · 未推断个人风格"); setCheckedHabits([]);
        if (data.warning) setStatus(data.warning);
      } else {
        const generated = generatedScriptSchema.parse(data.draft);
        if (replaceDraft(generated.script, fromSession ? "iteration" : "knowledge", generated.cues)) {
          setUsedDocuments([...new Set(body.sources.map(s => s.documentId))]); setUsedMemories(useMemory ? memory.map(m => m.id) : []); setSourceSessionId(fromSession ? selectedSession?.id : undefined);
          setStatus(`AI 草稿：${generated.summary} 尚未替换正在使用的台本。`);
        }
      }
    } catch (error) { if (mounted.current && !abort.signal.aborted) setStatus(error instanceof Error ? error.message : "处理失败。"); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function remember() {
    if (!analysis || !selectedSession || !checkedHabits.length) return;
    setBusy(true);
    try {
      await db.transaction("rw", db.coachMemories, async () => {
        const existing = await db.coachMemories.toArray();
        for (const index of checkedHabits) {
          const habit = analysis.habits[index];
          if (!habit || !selectedSession.transcript.includes(habit.evidence)) continue;
          const old = existing.find(m => m.rule === habit.rule && m.language === p.scenario.language && m.scenarioKind === p.scenario.kind && m.kind === habit.kind);
          const next: CoachMemory = { ...habit, id: old?.id ?? crypto.randomUUID(), language: p.scenario.language, scenarioKind: p.scenario.kind, sourceSessionIds: [...new Set([...(old?.sourceSessionIds ?? []), selectedSession.id])], createdAt: old?.createdAt ?? new Date().toISOString() };
          await db.coachMemories.put(next);
          if (!old) existing.push(next);
        }
      });
      await p.onRefresh();
      if (mounted.current) { setCheckedHabits([]); setStatus("已记入本地记忆。后续生成会使用同场景、同语言的已确认习惯。"); }
    } catch { if (mounted.current) setStatus("记忆保存失败，请重试。"); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function forget(id: string) {
    setBusy(true);
    try { await db.coachMemories.delete(id); await p.onRefresh(); setStatus("已忘记这条习惯，未来生成不再使用。已保存的台本不会被自动重写。"); }
    catch { setStatus("未能删除记忆，请重试。"); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop script-studio-backdrop"><section className="script-studio" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="script-studio-title" onKeyDown={event => {
    if (event.key === "Escape" && !busy) { event.stopPropagation(); close(); }
    if (event.key === "Tab") {
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, input:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header className="studio-heading"><div><p className="section-label">{p.scenario.title} · {p.scenario.language === "en-US" ? "English" : "中文"}</p><h2 id="script-studio-title">我的台本</h2></div><button className="icon-button" title="关闭台本编辑" disabled={busy} onClick={close}><X size={20} /></button></header>
    <nav className="studio-tabs" aria-label="台本工作区">{([{ id: "edit", name: "台本", icon: Pencil }, { id: "sources", name: "知识库", icon: BookOpen }, { id: "learn", name: "练习迭代", icon: GitCompareArrows }, { id: "memory", name: "表达记忆", icon: Brain }] as const).map(({ id, name, icon: Icon }) => <button key={id} disabled={busy} aria-current={tab === id ? "page" : undefined} onClick={() => { setTab(id); setStatus(""); }}><Icon size={17} />{name}</button>)}</nav>
    <div className="studio-body">
      {tab === "edit" && <><textarea className="script-editor" aria-label="编辑完整台本" maxLength={30000} value={draft} disabled={busy} onChange={e => edit(e.target.value)} /><div className="studio-editor-footer"><span>{draft.length} / 30000</span><button className="button primary" disabled={busy || !draft.trim() || !dirty} onClick={() => void save()}><Save size={17} />保存并用于练习</button></div><details className="script-versions"><summary><History size={16} />历史版本 · {versions.length}</summary>{versions.map((v, i) => <div key={v.id}><span>{i === 0 ? "当前" : `历史 ${versions.length - i}`} · {new Date(v.createdAt).toLocaleString("zh-CN")}</span><button className="button ghost" disabled={busy} onClick={() => { if (replaceDraft(v.script, "restore", v.cues)) { setUsedDocuments(v.sourceDocumentIds); setUsedMemories(v.memoryIds); setSourceSessionId(v.sourceSessionId); setStatus("已载入历史稿；保存后会创建新版本，不删除现有版本。"); } }}>载入草稿</button></div>)}</details></>}
      {tab === "sources" && <><h3>这次想用哪些资料？</h3>{!p.documents.length && <p className="helper-text">知识库里还没有资料。</p>}<div className="studio-documents">{p.documents.map(d => <label key={d.id}><input type="checkbox" checked={selectedDocs.includes(d.id)} onChange={e => setSelectedDocs(e.target.checked ? [...selectedDocs, d.id] : selectedDocs.filter(id => id !== d.id))} /><span>{d.title}</span><small>{d.source === "inspiration" ? "灵感" : d.source === "feishu" ? "飞书" : "文档"} · {d.chunks.length} 个片段</small></label>)}</div><button className="button ghost" disabled={busy} onClick={() => { if (!dirty || window.confirm("放弃未保存草稿，前往知识库？")) p.onKnowledge(); }}><BookOpen size={16} />打开知识库</button><textarea className="studio-instruction" aria-label="告诉教练怎么写" placeholder="比如：用这些资料写一个三分钟开场，保留我的说话方式，少一些书面语。" value={instruction} maxLength={2000} onChange={e => setInstruction(e.target.value)} /><label className="studio-memory-toggle"><input type="checkbox" checked={useMemory} onChange={e => setUseMemory(e.target.checked)} />采用已确认表达记忆（{memory.length} 条）</label><p className="helper-text">生成时只发送所选资料中最多 6 个相关片段、当前台本和已确认习惯给所选文本服务；不发送录像。</p><div className="settings-actions"><button className="button primary" disabled={busy || !selectedDocs.length} onClick={() => void coach("generate")}><Sparkles size={17} />整理并生成台本</button><button className="button secondary" disabled={busy || !selectedDocs.length} onClick={() => {
        const sources = selectScriptSources(p.documents, selectedDocs, `${p.scenario.title} ${instruction}`);
        if (!sources.length) { setStatus("所选资料没有可读取的文字。"); return; }
        if (replaceDraft(sources.map(s => s.text).join("\n\n"), "knowledge")) { setUsedDocuments([...new Set(sources.map(s => s.documentId))]); setUsedMemories([]); setSourceSessionId(undefined); setStatus("已载入相关原文片段（最多 6 段），未经 AI 改写。编辑后保存即可练习。"); }
      }}>直接载入原文片段</button></div></>}
      {tab === "learn" && <><h3>从哪次表达继续打磨？</h3><p className="helper-text">保留每次实际使用的原稿。默认按已保存分数排序，你可以另选一次；不同轮次、评分来源的分数不完全可比。</p>{!records.length && <p className="empty-copy">还没有可对照的练习。用当前台本练习并保存后会出现在这里。旧记录若没有原稿快照，不会用今天的稿子冒充当时的原稿。</p>}<div className="studio-sessions">{records.map(s => <button key={s.id} disabled={busy} aria-pressed={s.id === selectedSessionId} onClick={() => { setSelectedSessionId(s.id); setAnalysis(null); setCheckedHabits([]); setStatus(""); }}><strong>{s.review?.overallScore ?? "--"} 分 <small>{s.reviewSource === "ai" ? "AI 复盘" : s.reviewSource === "local" ? "本地估算" : "未保存评分"}</small></strong><span>{new Date(s.startedAt).toLocaleString("zh-CN")} · 第 {s.roundIndex ?? 1} 轮</span><small>{s.metrics.wordsPerMinute} {s.language === "en-US" ? "wpm" : "字/分"} · {s.metrics.fillerCount} 个填充词 · {s.metrics.pauseCount} 次估算停顿</small></button>)}</div>
        {selectedSession && baseline && <><p className="helper-text">同一原稿共有 {peers.length} 次记录。{selectedSession.id === peers[0]?.id && selectedSession.review ? "所选记录在这一原稿的已保存评分中最高。" : ""}转写可能存在识别误差，请结合录像核对。</p><details open><summary>当时的原稿 / 实际发言</summary><div className="script-comparison"><section><h4>原稿快照</h4><p>{baseline}</p></section><section><h4>实际发言</h4><p>{selectedSession.transcript}</p></section></div></details><details><summary>逐句差异</summary><div className="script-diff">{diff?.changes.map((c, i) => <p key={i} className={c.kind}><span>{c.kind === "added" ? "新增 / 改写" : c.kind === "removed" ? "省略 / 改写" : "保留"}</span>{c.text}</p>)}{diff?.truncated && <p>差异列表仅对照前 240 句；上方保留完整文本。</p>}</div></details><div className="settings-actions"><button className="button secondary" disabled={busy} onClick={() => void coach("learn", true)}><GitCompareArrows size={17} />对照并提炼表达习惯</button><button className="button primary" disabled={busy} onClick={() => void coach("generate", true)}><Sparkles size={17} />用这次表现生成下一版</button></div><p className="helper-text">将发送这一次的原稿、转写、评分、语速/填充词/估算停顿，以及已确认记忆。下一版另使用已选择的资料片段，不发送其他录音或全部历史。</p></>}
        {analysis && <section className="coaching-findings"><h3>{analysisSource}</h3><p>{analysis.summary}</p>{analysis.changes.map((c, i) => <div key={i} className="coaching-change">{c.original && <p><span>原稿</span> {c.original}</p>}{c.spoken && <p><span>实说</span> {c.spoken}</p>}<p>{c.observation}</p></div>)}<h4>值得记住的习惯，由你确认</h4>{!analysis.habits.length && <p>本次没有足够依据提出表达记忆。</p>}{analysis.habits.map((h, i) => <label className="habit-candidate" key={i}><input type="checkbox" checked={checkedHabits.includes(i)} disabled={busy} onChange={e => setCheckedHabits(e.target.checked ? [...checkedHabits, i] : checkedHabits.filter(v => v !== i))} /><span><strong>{h.kind === "keep" ? "保留" : "减少"} · {h.rule}</strong><small>本次依据：{h.evidence}</small></span></label>)}<button className="button secondary" disabled={busy || !checkedHabits.length} onClick={() => void remember()}><Brain size={17} />记住选中的习惯</button></section>}
      </>}
      {tab === "memory" && <><h3>本地表达记忆</h3><p className="helper-text">只有你确认过的习惯才会参与生成。按场景与语言区分，不推断人格，也不承诺每次改稿都会提分。</p>{!p.memories.length && <p className="empty-copy">尚未确认任何习惯。在练习迭代中选定一次表现，再勾选值得记住的表达。</p>}{p.memories.map(m => <div className="memory-row" key={m.id}><div><strong>{m.rule}</strong><p>依据：{m.evidence}</p><small>{m.language} · {m.scenarioKind} · {m.sourceSessionIds.length === 1 ? "单次观察，待更多练习验证" : `${m.sourceSessionIds.length} 次已确认来源`}</small></div><button className="icon-button" title="忘记此习惯" disabled={busy} onClick={() => void forget(m.id)}><Trash2 size={17} /></button></div>)}</>}
    </div>
    <footer className="studio-status" role="status">{busy ? "正在处理，请稍候…" : status || (dirty ? "草稿尚未保存" : "台本与记忆保存在本机")} {!busy && !dirty && <Check size={14} />}</footer>
  </section></div>;
}
