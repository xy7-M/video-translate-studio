"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clapperboard,
  Download,
  FileText,
  RefreshCw,
  Scissors,
  Sparkles,
  SkipForward,
  Table,
  Upload,
  Zap,
} from "lucide-react";
import Library from "@/components/Library";
import SettingsModal from "@/components/SettingsModal";
import { authedFetch } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

/** 墨线细描边图标：与手账风 1.5px 描边同语言 */
const ic = { size: 15, strokeWidth: 1.75, className: "shrink-0" } as const;

type Segment = { start: number; end: number; text: string; zh?: string };
type Summary = { points: string[]; emphasis: string[] };
type TimelineSeg = { start: number; end: number; title: string; summary: string };
type GlossaryItem = { en: string; zh: string; note?: string; examples?: string[] };
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
  timeline?: TimelineSeg[];
};

const STEPS = ["上传", "抽取音轨", "英文转写", "中文翻译", "AI 课堂笔记", "双语字幕"];

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Home() {
  const { session, openLogin, signOut } = useAuth();
  const [view, setView] = useState<"work" | "library">("work");
  const [task, setTask] = useState<Task | null>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [burning, setBurning] = useState(false);
  const [courseErr, setCourseErr] = useState("");
  const [titleErr, setTitleErr] = useState("");
  const [courseKey, setCourseKey] = useState(0); // 归类失败时重挂载输入框，回滚显示值
  const [segs, setSegs] = useState<Segment[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

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
        const r = await authedFetch(`/api/status/${id}`);
        const t: Task = await r.json();
        setTask(t);
        // 以后端最新数据为准（转写→翻译会逐步补上 zh）
        if (t.segments) setSegs(t.segments);
        if (["ready", "error", "done"].includes(t.status)) {
          clearInterval(pollRef.current);
        }
      } catch {
        /* ignore transient */
      }
    }, 1500);
  }, []);
  useEffect(() => () => pollRef.current && clearInterval(pollRef.current), []);

  // 播放快捷键（全屏与结果页内嵌播放器均生效）：← 后退 5s｜→ 快进 5s（按住＝三倍速）｜↑↓ 音量｜空格 暂停/继续
  // 用 document capture 阶段拦截：既保证收键（目标可能是 body 而非 video），
  // 又能在浏览器原生控件执行自己的 ±5s / 音量逻辑之前 preventDefault 掉
  const rightHeldAt = useRef(0);
  // 仅文本输入框（标题、课程归类）里放行键盘，保证正常打字；
  // 其余焦点（body / video / 按钮）一律拦截，空格永远走暂停/继续而非浏览器默认的滚动或缩放
  const isTextFocus = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    if (!el || !el.tagName) return false;
    return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable;
  };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v) return;
      if (document.fullscreenElement !== v && isTextFocus(e.target)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        v.currentTime = Math.max(0, v.currentTime - 5);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!e.repeat) {
          rightHeldAt.current = performance.now();
          v.playbackRate = 3;
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        v.volume = Math.min(1, v.volume + 0.05);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        v.volume = Math.max(0, v.volume - 0.05);
      } else if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        if (v.paused) void v.play().catch(() => {});
        else v.pause();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v || e.key !== "ArrowRight" || !rightHeldAt.current) return;
      const held = performance.now() - rightHeldAt.current;
      rightHeldAt.current = 0;
      v.playbackRate = 1;
      // 轻按（<250ms）＝快进 5s；按住不放＝三倍速回放，松手即恢复常速
      if (held < 250) {
        const d = v.duration;
        v.currentTime = Math.min(Number.isFinite(d) ? d : v.currentTime + 5, v.currentTime + 5);
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
    };
  }, []);

  // 退出全屏时兜底恢复倍速，避免按住→的过程中按 Esc 卡在 3 倍速
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && videoRef.current) videoRef.current.playbackRate = 1;
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const upload = async (file: File) => {
    if (!session) {
      openLogin();
      return;
    }
    setUploading(true);
    setTask(null);
    setSegs([]);
    const form = new FormData();
    form.append("video", file);
    try {
      const r = await authedFetch("/api/upload", { method: "POST", body: form });
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


  const downloadDocx = async () => {
    if (!task) return;
    const a = document.createElement("a");
    a.href = `/api/subtitle/${task.id}?fmt=docx`;
    a.download = `subtitle-${task.title || task.id}.docx`;
    a.click();
  };

  const burnVideo = async () => {
    if (!task) return;
    setBurning(true);
    // 启动失败（网络断/服务挂）要解除 burning 态，不能傻等轮询
    const started = await fetch(`/api/burn/${task.id}`, { method: "POST" })
      .then((r) => r.ok)
      .catch(() => false);
    if (!started) {
      setBurning(false);
      return;
    }
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/status/${task.id}`);
        if (!r.ok) throw new Error("status failed");
        const t: Task = await r.json();
        setTask(t);
        if (["done", "error"].includes(t.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          setBurning(false);
        }
      } catch {
        // 轮询异常：停止轮询并解除按钮 loading，避免永久卡在「烧录中」
        if (pollRef.current) clearInterval(pollRef.current);
        setBurning(false);
      }
    }, 2000);
  };

  /** 重跑字幕：用最新断句 + 逐句翻译规则重新生成（AI 笔记保留） */
  const reworkSubtitles = async () => {
    if (!task) return;
    if (!session) {
      openLogin();
      return;
    }
    const r = await authedFetch(`/api/reprocess/${task.id}`, { method: "POST" }).catch(() => null);
    if (!r?.ok) return;
    poll(task.id);
  };

  /** 从课程库打开历史任务 */
  const openTask = async (id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      const r = await fetch(`/api/status/${id}`);
      const t: Task = await r.json();
      if (!r.ok) return;
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
    const prev = task.title || "";
    const t = title.trim();
    setTitleErr("");
    if (!t || t === prev) return;
    try {
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, title: t }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTitleErr(j.error || "重命名失败");
        setTask((p) => p && { ...p, title: prev }); // 回滚显示值
      }
    } catch {
      /* ignore */
    }
  };

  const downloadNotes = () => {
    if (!task) return;
    const a = document.createElement("a");
    a.href = `/api/notes/${task.id}`;
    a.download = `notes-${task.title || task.id}.md`;
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
          {session ? (
            <button
              onClick={() => signOut()}
              title={session.user.email || "已登录"}
              className="px-4 py-2 rounded-full text-sm text-[var(--muted)] hover:text-[var(--text)] border border-[var(--line)] transition-all duration-200 inline-flex items-center gap-1.5"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: "var(--ok)" }}
              />
              {session.user.email?.split("@")[0] || "已登录"}
            </button>
          ) : (
            <button
              onClick={openLogin}
              className="px-5 py-2 rounded-full text-sm bg-[var(--note)] text-[var(--text)] border-[1.5px] border-[var(--line)] shadow-[2px_2px_0_rgba(28,25,17,.16)] hover:translate-y-[-1px] transition-all duration-150"
            >
              登录
            </button>
          )}
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
          <div className="grid md:grid-cols-[380px_1fr] items-stretch gap-6">
            {/* 左栏：视频预览 + AI 课堂摘要（摘要卡片自动补满剩余高度） */}
            <div className="flex flex-col gap-6">
            {/* Player */}
            <div className="panel overflow-hidden">
              <video
                key={task.status === "done" ? "burned" : "src"}
                ref={videoRef}
                controls
                className="w-full max-h-[520px] bg-black"
                src={`/api/video/${task.id}/${task.status === "done" ? "burned" : "src"}`}
              />
              <div className="p-3 text-xs text-[var(--muted)] mono">
                {task.status === "done" ? "烧录版预览" : "原视频预览"}
              </div>
            </div>

            {/* AI 课堂摘要：紧跟视频下方 */}
            {task.summary && (task.summary.points.length || task.summary.emphasis.length) > 0 && (
              <div className="panel p-6 space-y-5 flex-1">
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
              </div>
            )}
            </div>

            {/* Actions */}
            <div className="panel p-6 flex flex-col gap-5">
              <div>
                <div className="flex items-center gap-2">
                  <input
                    value={task.title || ""}
                    placeholder={`视频 ${task.id}`}
                    onChange={(e) => setTask((p) => p && { ...p, title: e.target.value })}
                    onBlur={(e) => saveTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    aria-label="自定义视频名称"
                    className="flex-1 min-w-0 font-medium text-lg bg-transparent border-b border-dashed border-[var(--line-2)] focus:border-[var(--accent)] outline-none transition-colors duration-150 placeholder:text-[var(--muted)]"
                  />
                  <button
                    className="btn-ghost !px-3 !py-2 shrink-0 inline-flex items-center gap-1.5"
                    title="处理下一个视频"
                    aria-label="处理下一个视频"
                    onClick={() => setTask(null)}
                  >
                    <SkipForward {...ic} /> 下一条
                  </button>
                </div>
                <p className="text-sm text-[var(--muted)] mt-1 inline-flex items-center gap-1.5">
                  双语字幕已生成
                  <Check size={14} strokeWidth={2.5} className="text-[var(--ok)]" />
                  · 共 {segs.length} 句 · 标题可直接修改
                </p>
                {titleErr && <p className="text-xs mt-1.5" style={{ color: "var(--err)" }}>{titleErr}</p>}
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

              {/* 主行动：烧录双语视频（核心功能，独立贴纸条） */}
              <div
                className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-[16px] px-5 pt-5 pb-4"
                style={{
                  border: "1.5px solid var(--line)",
                  background: "var(--panel)",
                  boxShadow: "4px 4px 0 rgba(28,25,17,.14)",
                  transform: "rotate(-0.4deg)",
                }}
              >
                <span
                  className="badge-note absolute -top-3 left-5 mono px-2.5 py-0.5 text-[11px]"
                  style={{ transform: "rotate(3deg)" }}
                >
                  ★ 核心功能
                </span>
                <div className="min-w-0">
                  <p className="font-medium">一键烧录双语字幕视频</p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    中英字幕压进画面，导出后可直接在手机、课堂回放
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {burning || task.status === "burning" ? (
                    <button className="btn-hero" disabled>
                      <RefreshCw size={16} strokeWidth={1.75} className="shrink-0 animate-spin" />
                      烧录中 {task.progress}%
                    </button>
                  ) : (
                    <button className="btn-hero" disabled={stepIndex < 5} onClick={burnVideo}>
                      <Clapperboard size={17} strokeWidth={1.75} className="shrink-0" />
                      {task.status === "done" ? "重新烧录双语视频" : "烧录双语视频"}
                    </button>
                  )}
                  {task.status === "done" ? (
                    <a
                      href={`/api/video/${task.id}/burned?dl=1`}
                      className="text-sm text-[var(--ok)] inline-flex items-center gap-1.5 underline underline-offset-4"
                      download
                    >
                      <Download size={14} strokeWidth={1.75} /> 下载烧录版 mp4
                    </a>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">
                      {task.encoder
                        ? task.encoder === "h264_nvenc"
                          ? "GPU 加速已就绪"
                          : "CPU 编码，耗时稍长"
                        : "生成后可在预览区播放"}
                    </span>
                  )}
                </div>
              </div>
              {burning && <p className="text-sm text-[var(--accent)] mono animate-pulse -mt-2"> {task.message}</p>}

              {/* 导出 */}
              <div>
                <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest mb-2">导出与重跑</p>
                <div className="flex flex-wrap gap-3">
                  <button className="btn-primary" onClick={downloadDocx} title="中英字幕对照表格，Word / WPS 可直接打开">
                    <Table {...ic} /> 字幕 Word
                  </button>
                  <button className="btn-ghost" onClick={downloadNotes}>
                    <FileText {...ic} /> 复习笔记 MD
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={stepIndex < 5 || stepIndex === -1}
                    title="用最新的断句与逐句翻译规则重新生成双语字幕（AI 笔记保留）"
                    onClick={reworkSubtitles}
                  >
                    <RefreshCw {...ic} /> 重跑字幕
                  </button>
                </div>
              </div>
              {task.encoder && task.status === "done" && (
                <span
                  className="text-[11px] mono inline-flex items-center gap-1 px-2 py-1 rounded-full"
                  style={{ border: "1.5px solid var(--line)", color: task.encoder === "h264_nvenc" ? "var(--warn)" : "var(--muted)" }}
                >
                  {task.encoder === "h264_nvenc" ? <><Zap size={12} strokeWidth={2} /> NVENC GPU 编码</> : "CPU libx264"}
                </span>
              )}
            </div>
          </div>

          {/* 视频剖析：按主题切分的时间线，点击跳转到对应片段 */}
          {(task.timeline?.length ?? 0) > 0 && (
            <div className="panel p-6">
              <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest mb-4 inline-flex items-center gap-1.5">
                <Scissors size={13} strokeWidth={1.75} /> 视频剖析 · {task.timeline!.length} 个片段，点击快速回看
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                {task.timeline!.map((tl, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      const v = videoRef.current;
                      if (!v) return;
                      v.currentTime = tl.start;
                      v.play().catch(() => {});
                      v.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                    className="text-left border border-[var(--line)] rounded-2xl px-4 py-3 hover:border-[var(--accent)] hover:-translate-y-[1px] transition-all duration-150 bg-[var(--bg-2)]"
                    style={{ transform: `rotate(${i % 2 ? 0.4 : -0.4}deg)` }}
                  >
                    <p className="text-xs mono text-[var(--accent)] mb-1">
                      {fmt(tl.start)} → {fmt(tl.end)}
                    </p>
                    <p className="text-sm font-medium">{tl.title}</p>
                    {tl.summary && <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">{tl.summary}</p>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* 专业词表：通栏全宽，术语双列排布 */}
          {task.glossary && task.glossary.length > 0 && (
            <div className="panel p-6">
              <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest mb-4">
                专业词表 · {task.glossary.length} 个术语
              </p>
              <div className="grid md:grid-cols-2 gap-x-10">
                {task.glossary.map((g, i) => (
                  <div key={i} className="py-3 flex flex-col gap-0.5 border-b border-[var(--hair)]">
                    <p className="text-sm">
                      <span className="mono text-[var(--accent)]">{g.en}</span>
                      <span className="text-[var(--text)] ml-3">{g.zh}</span>
                    </p>
                    {g.note && <p className="text-xs text-[var(--muted)]">{g.note}</p>}
                    {(g.examples?.length ?? 0) > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {g.examples!.map((e, j) => (
                          <li key={j} className="text-xs text-[var(--text)] leading-relaxed flex gap-1.5">
                            <span className="mono text-[var(--muted)] shrink-0">{j + 1}.</span>
                            <span>{e}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
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
