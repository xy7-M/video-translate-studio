"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clapperboard,
  Download,
  FileDown,
  FileText,
  ListChecks,
  Printer,
  Sparkles,
  Square,
  Upload,
  Zap,
} from "lucide-react";
import Library from "@/components/Library";
import SettingsModal from "@/components/SettingsModal";

/** 墨线细描边图标：与手账风 1.5px 描边同语言 */
const ic = { size: 15, strokeWidth: 1.75, className: "shrink-0" } as const;

type Segment = { start: number; end: number; text: string; zh?: string };
type Summary = { points: string[]; emphasis: string[]; actions: string[] };
type GlossaryItem = { en: string; zh: string; note?: string };
type Task = {
  id: string;
  status: string;
  progress: number;
  message: string;
  error?: string;
  encoder?: string;
  segments?: Segment[];
  hasVideo?: boolean;
  title?: string;
  course?: string;
  summary?: Summary;
  glossary?: GlossaryItem[];
};

const STEPS = ["上传", "抽取音轨", "英文转写", "中文翻译", "AI 课堂笔记", "双语字幕"];

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Home() {
  const [view, setView] = useState<"work" | "library">("work");
  const [task, setTask] = useState<Task | null>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [burning, setBurning] = useState(false);
  const [pdfing, setPdfing] = useState(false);
  const [pdfErr, setPdfErr] = useState("");
  const [courseErr, setCourseErr] = useState("");
  const [courseKey, setCourseKey] = useState(0); // 归类失败时重挂载输入框，回滚显示值
  const [segs, setSegs] = useState<Segment[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const editedRef = useRef(false); // 用户手动改过字幕后，停止用后端数据覆盖前端

  const stepIndex = (() => {
    if (!task) return -1;
    switch (task.status) {
      case "queued": return 0;
      case "extracting": return 1;
      case "transcribing": return 2;
      case "translating": return 3;
      case "analyzing": return 4;
      case "ready": case "burning": case "done": return 5;
      default: return -1;
    }
  })();

  const poll = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/status/${id}`);
        const t: Task = await r.json();
        setTask(t);
        // 用户未编辑时，始终以后端最新数据为准（转写→翻译会逐步补上 zh）
        if (t.segments && !editedRef.current) setSegs(t.segments);
        if (["ready", "error", "done"].includes(t.status)) {
          clearInterval(pollRef.current);
        }
      } catch {
        /* ignore transient */
      }
    }, 1500);
  }, []);
  useEffect(() => () => pollRef.current && clearInterval(pollRef.current), []);

  const upload = async (file: File) => {
    setUploading(true);
    setTask(null);
    setSegs([]);
    editedRef.current = false;
    const form = new FormData();
    form.append("video", file);
    try {
      const r = await fetch("/api/upload", { method: "POST", body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "上传失败");
      setTask({ id: j.taskId, status: "queued", progress: 0, message: "已加入队列" });
      poll(j.taskId);
    } catch (e) {
      setTask({ id: "", status: "error", progress: 0, message: "失败", error: e instanceof Error ? e.message : String(e) });
    } finally {
      setUploading(false);
    }
  };

  const editSeg = (i: number, field: "text" | "zh", v: string) => {
    editedRef.current = true; // 用户开始编辑，冻结后端覆盖
    setSegs((prev) => prev.map((s, n) => (n === i ? { ...s, [field]: v } : s)));
  };

  /** 导出双语 SRT：有编辑时先同步到后端，保证导出内容与界面一致 */
  const syncEdits = async () => {
    if (!task) return;
    if (editedRef.current) {
      await fetch(`/api/segments/${task.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: segs }),
      }).catch(() => {});
    }
  };

  const downloadSrt = async () => {
    if (!task) return;
    await syncEdits();
    const a = document.createElement("a");
    a.href = `/api/subtitle/${task.id}`;
    a.download = `subtitle-${task.title || task.id}.srt`;
    a.click();
  };

  /** 导出奶油风（纸墨手账）PDF 字幕 */
  const downloadPdf = async () => {
    if (!task) return;
    setPdfing(true);
    try {
      await syncEdits();
      const r = await fetch(`/api/subtitle/${task.id}?fmt=pdf`);
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error || `PDF 生成失败 (${r.status})`);
      }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `subtitle-${task.title || task.id}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setPdfErr(e instanceof Error ? e.message : String(e));
      setTimeout(() => setPdfErr(""), 5000);
    } finally {
      setPdfing(false);
    }
  };

  const pushEditsAndBurn = async () => {
    if (!task) return;
    setBurning(true);
    // 先把编辑同步到后端，再触发烧录
    if (editedRef.current) {
      await fetch(`/api/segments/${task.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: segs }),
      }).catch(() => {});
    }
    await fetch(`/api/burn/${task.id}`, { method: "POST" }).catch(() => {});
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const r = await fetch(`/api/status/${task.id}`);
      const t: Task = await r.json();
      setTask(t);
      if (["done", "error"].includes(t.status)) {
        clearInterval(pollRef.current);
        setBurning(false);
      }
    }, 2000);
  };

  /** 从课程库打开历史任务 */
  const openTask = async (id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      const r = await fetch(`/api/status/${id}`);
      const t: Task = await r.json();
      if (!r.ok) return;
      editedRef.current = false;
      setTask(t);
      setSegs(t.segments || []);
      setView("work");
      if (!["ready", "error", "done"].includes(t.status)) poll(id);
    } catch {
      /* ignore */
    }
  };

  const saveCourse = async (course: string) => {
    if (!task) return;
    setCourseErr("");
    const prev = task.course || "";
    setTask((p) => p && { ...p, course: course.trim() });
    try {
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, course }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setCourseErr(j.error || "课程归类失败");
        setTask((p) => p && { ...p, course: prev }); // 回滚
        setCourseKey((k) => k + 1); // 重挂载非受控输入框，恢复旧值
      }
    } catch {
      /* ignore */
    }
  };

  const saveTitle = async (title: string) => {
    if (!task) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, title }),
    }).catch(() => {});
  };

  const downloadNotes = (fmt: "md" | "html") => {
    if (!task) return;
    const a = document.createElement("a");
    a.href = `/api/notes/${task.id}?fmt=${fmt}`;
    a.download = `notes-${task.title || task.id}.${fmt}`;
    a.click();
  };

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      {/* Header */}
      <header className="mb-10 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-[var(--accent)] mono">&gt;_</span> 视频快译
          </h1>
          <p className="text-[var(--muted)] mt-2">
            英文课堂视频 → <span className="text-[var(--text)]">双语字幕 · AI 笔记 · 复习词表</span>
          </p>
        </div>
        <nav className="flex items-center gap-2">
          <button
            onClick={() => setView("work")}
            className={`px-5 py-2 rounded-full text-sm transition-all duration-200 ${
              view === "work" ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            工作台
          </button>
          <button
            onClick={() => setView("library")}
            className={`px-5 py-2 rounded-full text-sm transition-all duration-200 ${
              view === "library" ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            课程库
          </button>
          <SettingsModal />
        </nav>
      </header>
      {view === "library" && (
        <Library
          onOpen={openTask}
          onDeleted={(id) => {
            if (task?.id === id) {
              if (pollRef.current) clearInterval(pollRef.current);
              setTask(null);
              setSegs([]);
            }
          }}
        />
      )}

      {view === "work" && (
      <>

      {/* Upload zone */}
      {!task && (
        <div
          className={`panel dashed glow-border p-14 text-center cursor-pointer transition-colors duration-150 ${
            drag ? "border-[var(--accent)] bg-[rgba(232,99,74,0.06)]" : ""
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) upload(f);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".mp4,.mov,.mkv,.webm,.avi,.m4v"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <div className="flex justify-center mb-4 text-[var(--accent)]">
            <Upload size={40} strokeWidth={1.5} />
          </div>
          <p className="text-lg font-medium">{uploading ? "上传中…" : "拖入或点击选择英文视频"}</p>
          <p className="text-sm text-[var(--muted)] mt-2">支持 MP4 / MOV / MKV / WebM · ≤ 2GB · 最长 2 小时</p>
        </div>
      )}

      {/* Progress */}
      {task && task.status !== "ready" && task.status !== "done" && task.status !== "error" && (
        <div className="panel p-8">
          <div className="flex items-center justify-between mb-6">
            <span className="mono text-sm text-[var(--muted)]">TASK #{task.id}</span>
            <span className="mono text-2xl text-[var(--accent)]">{task.progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--bg-2)] overflow-hidden mb-8">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-500"
              style={{ width: `${task.progress}%` }}
            />
          </div>
          <ol className="space-y-3">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-3 text-sm">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center mono text-xs ${
                    i < stepIndex
                      ? "bg-[var(--ok)] text-black"
                      : i === stepIndex
                        ? "bg-[var(--accent)] text-black animate-pulse"
                        : "border border-[var(--line-2)] text-[var(--muted)]"
                  }`}
                >
                  {i < stepIndex ? <Check size={13} strokeWidth={2.5} /> : i + 1}
                </span>
                <span className={i === stepIndex ? "text-[var(--text)] font-medium" : "text-[var(--muted)]"}>{s}</span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-[var(--muted)] mono">⎯ {task.message}</p>
        </div>
      )}

      {/* Error */}
      {task?.status === "error" && (
        <div className="panel p-8" style={{ borderColor: "var(--err)" }}>
          <p className="text-[var(--err)] font-medium mb-2">处理失败</p>
          <p className="text-sm text-[var(--muted)] mono break-all">{task.error}</p>
          <button className="btn-ghost mt-6" onClick={() => setTask(null)}>
            重新上传
          </button>
        </div>
      )}

      {/* Result */}
      {(task?.status === "ready" || task?.status === "burning" || task?.status === "done") && (
        <div className="space-y-6">
          <div className="grid md:grid-cols-[280px_1fr] gap-6">
            {/* Player */}
            <div className="panel overflow-hidden self-start">
              <video
                key={task.status === "done" ? "burned" : "src"}
                controls
                className="w-full max-h-[520px] bg-black"
                src={`/api/video/${task.id}/${task.status === "done" ? "burned" : "src"}`}
              />
              <div className="p-3 text-xs text-[var(--muted)] mono">
                {task.status === "done" ? "烧录版预览" : "原视频预览"}
              </div>
            </div>

            {/* Actions */}
            <div className="panel p-6 flex flex-col gap-5">
              <div>
                <input
                  value={task.title || ""}
                  placeholder={`视频 ${task.id}`}
                  onChange={(e) => setTask((p) => p && { ...p, title: e.target.value })}
                  onBlur={(e) => saveTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  aria-label="自定义视频名称"
                  className="font-medium text-lg bg-transparent w-full border-b border-dashed border-[var(--line-2)] focus:border-[var(--accent)] outline-none transition-colors duration-150 placeholder:text-[var(--muted)]"
                />
                <p className="text-sm text-[var(--muted)] mt-1 inline-flex items-center gap-1.5">
                  双语字幕已生成
                  <Check size={14} strokeWidth={2.5} className="text-[var(--ok)]" />
                  · 共 {segs.length} 句 · 名称与文字均可编辑，导出时以编辑内容为准
                </p>
              </div>

              {/* 课程归类 */}
              <div>
                <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest mb-2">归入课程频道</p>
                <input
                  key={courseKey}
                  placeholder="如：Math101 / CS210 / 经济学原理…"
                  defaultValue={task.course || ""}
                  onBlur={(e) => saveCourse(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="w-full bg-transparent border border-[var(--line)] rounded-full px-4 py-2 text-sm outline-none focus:border-[var(--accent)] transition-colors duration-150"
                />
                {courseErr && <p className="text-xs mt-1.5 px-1" style={{ color: "var(--err)" }}>{courseErr}</p>}
              </div>

              {/* 导出 + 烧录 */}
              <div>
                <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest mb-2">导出与烧录</p>
                <div className="flex flex-wrap gap-3">
                  <button className="btn-primary" onClick={downloadSrt}>
                    <Download {...ic} /> 下载双语 SRT
                  </button>
                  <button className="btn-ghost" onClick={downloadPdf} disabled={pdfing}>
                    <FileDown {...ic} /> {pdfing ? "PDF 生成中…" : "奶油风 PDF"}
                  </button>
                  {pdfErr && <p className="w-full text-xs" style={{ color: "var(--err)" }}>{pdfErr}</p>}
                  <button className="btn-ghost" onClick={() => downloadNotes("md")}>
                    <FileText {...ic} /> 复习笔记 MD
                  </button>
                  <button className="btn-ghost" onClick={() => downloadNotes("html")}>
                    <Printer {...ic} /> 笔记 HTML·PDF
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={burning || task.status === "burning"}
                    onClick={pushEditsAndBurn}
                  >
                    <Clapperboard {...ic} /> 烧录双语视频
                  </button>
                  <button className="btn-ghost" onClick={() => setTask(null)}>
                    下一个视频
                  </button>
                </div>
              </div>

              {task.status === "done" && (
                <div className="flex items-center gap-4">
                  <a
                    href={`/api/video/${task.id}/burned?dl=1`}
                    className="text-sm text-[var(--ok)] inline-flex items-center gap-1.5 underline underline-offset-4"
                    download
                  >
                    <Download size={14} strokeWidth={1.75} /> 下载烧录版 mp4
                  </a>
                  {task.encoder && (
                    <span
                      className="text-[11px] mono inline-flex items-center gap-1 px-2 py-1 rounded-full"
                      style={{ border: "1.5px solid var(--line)", color: task.encoder === "h264_nvenc" ? "var(--warn)" : "var(--muted)" }}
                    >
                      {task.encoder === "h264_nvenc" ? <><Zap size={12} strokeWidth={2} /> NVENC GPU 编码</> : "CPU libx264"}
                    </span>
                  )}
                </div>
              )}
              {burning && <p className="text-sm text-[var(--accent)] mono animate-pulse"> {task.message} {task.progress}%</p>}
            </div>
          </div>

          {/* AI 课堂笔记 + 专业词表 */}
          {(task.summary || task.glossary) && (
            <div className="grid md:grid-cols-2 gap-6">
              {task.summary && (task.summary.points.length || task.summary.emphasis.length || task.summary.actions.length) > 0 && (
                <div className="panel p-6 space-y-5">
                  <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest inline-flex items-center gap-1.5">
                    <Sparkles size={13} strokeWidth={1.75} /> AI 课堂摘要
                  </p>
                  {task.summary.points.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2">本节课要点</p>
                      <ul className="space-y-1.5 text-sm text-[var(--muted)] list-disc pl-5 marker:text-[var(--accent)]">
                        {task.summary.points.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                    </div>
                  )}
                  {task.summary.emphasis.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2 inline-flex items-center gap-1.5" style={{ color: "var(--warn)" }}>
                        <AlertTriangle size={14} strokeWidth={1.75} /> 教授强调 / 疑似考点
                      </p>
                      <ul className="space-y-1.5 text-sm text-[var(--muted)] list-disc pl-5 marker:text-[var(--warn)]">
                        {task.summary.emphasis.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                    </div>
                  )}
                  {task.summary.actions.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2 inline-flex items-center gap-1.5" style={{ color: "var(--ok)" }}>
                        <ListChecks size={14} strokeWidth={1.75} /> 待办事项
                      </p>
                      <ul className="space-y-1.5 text-sm text-[var(--muted)]">
                        {task.summary.actions.map((p, i) => (
                          <li key={i} className="flex gap-2 items-start">
                            <Square size={14} strokeWidth={1.75} className="mt-1 shrink-0" style={{ color: "var(--ok)" }} />
                            <span>{p}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {task.glossary && task.glossary.length > 0 && (
                <div className="panel p-6 flex flex-col">
                  <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest mb-4">
                    专业词表 · {task.glossary.length} 个术语
                  </p>
                  <div className="flex-1 flex flex-col justify-between divide-y divide-[var(--hair)]">
                    {task.glossary.map((g, i) => (
                      <div key={i} className="py-3 flex flex-col gap-0.5">
                        <p className="text-sm">
                          <span className="mono text-[var(--accent)]">{g.en}</span>
                          <span className="text-[var(--text)] ml-3">{g.zh}</span>
                        </p>
                        {g.note && <p className="text-xs text-[var(--muted)]">{g.note}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bilingual table */}
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-[70px_1fr_1fr] bg-[var(--bg-2)] text-xs mono text-[var(--muted)] uppercase">
              <div className="p-3">时间</div>
              <div className="p-3 border-l border-[var(--hair)]">English</div>
              <div className="p-3 border-l border-[var(--hair)]">中文</div>
            </div>
            <div className="max-h-[420px] overflow-y-auto divide-y divide-[var(--hair)]">
              {segs.map((s, i) => (
                <div key={i} className="grid grid-cols-[70px_1fr_1fr] items-start hover:bg-[rgba(232,99,74,0.05)]">
                  <div className="p-3 mono text-xs text-[var(--muted)]">{fmt(s.start)}</div>
                  <textarea
                    className="bg-transparent p-3 text-sm resize-none outline-none border-l border-[var(--hair)] focus:bg-[var(--bg-2)] min-h-[44px]"
                    rows={2}
                    value={s.text}
                    onChange={(e) => editSeg(i, "text", e.target.value)}
                  />
                  <textarea
                    className="bg-transparent p-3 text-sm resize-none outline-none border-l border-[var(--hair)] focus:bg-[var(--bg-2)] min-h-[44px]"
                    rows={2}
                    value={s.zh || ""}
                    onChange={(e) => editSeg(i, "zh", e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      </>
      )}

      <footer className="mt-16 text-center text-xs text-[var(--muted)] mono">
        本地处理 · 密钥仅存于服务端环境变量 · 视频不出本机
      </footer>
    </main>
  );
}
