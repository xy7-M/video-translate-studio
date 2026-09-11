"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Segment = { start: number; end: number; text: string; zh?: string };
type Task = {
  id: string;
  status: string;
  progress: number;
  message: string;
  error?: string;
  encoder?: string;
  segments?: Segment[];
  hasVideo?: boolean;
};

const STEPS = ["上传", "抽取音轨", "英文转写", "中文翻译", "双语字幕"];

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Home() {
  const [task, setTask] = useState<Task | null>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [burning, setBurning] = useState(false);
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
      case "ready": case "burning": case "done": return 4;
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

  /** 导出字幕：先把当前编辑同步到后端，再由后端统一生成各格式 */
  const downloadSub = async (fmt: "srt" | "vtt" | "ass" | "assfancy") => {
    if (!task) return;
    // 有编辑时先同步到后端，保证导出内容与界面一致
    if (editedRef.current) {
      await fetch(`/api/segments/${task.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: segs }),
      }).catch(() => {});
    }
    const ext = fmt === "assfancy" ? "ass" : fmt;
    const a = document.createElement("a");
    a.href = `/api/subtitle/${task.id}?fmt=${fmt}`;
    a.download = `subtitle-${task.id}.${ext}`;
    a.click();
  };

  const pushEditsAndBurn = async (style: "classic" | "fancy" = "classic") => {
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
    await fetch(`/api/burn/${task.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ style }),
    }).catch(() => {});
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

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      {/* Header */}
      <header className="mb-10 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-[var(--accent)] mono">&gt;_</span> 视频快译
          </h1>
          <p className="text-[var(--muted)] mt-2">
            英文视频导入 → 自动生成 <span className="text-[var(--text)]">中英双语字幕</span>
          </p>
        </div>
        <div className="mono text-xs text-[var(--muted)] hidden sm:block">
          faster-whisper · DeepSeek · ffmpeg
        </div>
      </header>

      {/* Upload zone */}
      {!task && (
        <div
          className={`panel dashed glow-border p-14 text-center cursor-pointer transition-colors duration-150 ${
            drag ? "border-[var(--accent)] bg-[rgba(56,189,248,0.05)]" : ""
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
          <div className="text-5xl mb-4 mono text-[var(--accent)]">⇪</div>
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
              className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] transition-all duration-500"
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
                  {i < stepIndex ? "✓" : i + 1}
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
            <div className="panel overflow-hidden">
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
                <p className="font-medium">双语字幕已生成 ✓</p>
                <p className="text-sm text-[var(--muted)] mt-1">
                  共 {segs.length} 句 · 可直接编辑下方文字，导出时以编辑内容为准
                </p>
              </div>

              {/* 导出四宫格 */}
              <div>
                <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest mb-2">导出字幕</p>
                <div className="grid grid-cols-4 gap-2">
                  <button className="btn-primary !px-2 !py-2.5 text-sm" onClick={() => downloadSub("srt")}>
                    SRT
                  </button>
                  <button className="btn-ghost !px-2 !py-2.5 text-sm" onClick={() => downloadSub("vtt")}>
                    VTT
                  </button>
                  <button className="btn-ghost !px-2 !py-2.5 text-sm" onClick={() => downloadSub("ass")}>
                    ASS
                  </button>
                  <button className="btn-ghost !px-2 !py-2.5 text-sm" onClick={() => downloadSub("assfancy")}>
                    ASS 花字
                  </button>
                </div>
                <p className="text-[11px] text-[var(--muted)] mt-2">
                  SRT 通用 · VTT 网页播放器 · ASS 花字带描边动画，剪映/AE 可再编辑
                </p>
              </div>

              {/* 烧录 */}
              <div>
                <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest mb-2">烧录进视频</p>
                <div className="flex flex-wrap gap-3">
                  <button
                    className="btn-ghost"
                    disabled={burning || task.status === "burning"}
                    onClick={() => pushEditsAndBurn("classic")}
                  >
                    🎬 经典双语
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={burning || task.status === "burning"}
                    onClick={() => pushEditsAndBurn("fancy")}
                  >
                    ✨ 花字版
                  </button>
                  <button className="btn-ghost" onClick={() => setTask(null)}>
                    下一个视频
                  </button>
                </div>
              </div>

              {task.status === "done" && (
                <div className="flex items-center gap-4">
                  <a href={`/api/video/${task.id}/burned`} className="text-sm text-[var(--ok)] mono" download>
                    ⬇ 下载烧录版 mp4
                  </a>
                  {task.encoder && (
                    <span className="text-[11px] mono px-2 py-1 rounded" style={{ border: "1px solid var(--line-2)", color: task.encoder === "h264_nvenc" ? "var(--warn)" : "var(--muted)" }}>
                      {task.encoder === "h264_nvenc" ? "⚡ NVENC GPU 编码" : "CPU libx264"}
                    </span>
                  )}
                </div>
              )}
              {burning && <p className="text-sm text-[var(--accent)] mono animate-pulse"> {task.message} {task.progress}%</p>}
            </div>
          </div>

          {/* Bilingual table */}
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-[70px_1fr_1fr] bg-[var(--bg-2)] text-xs mono text-[var(--muted)] uppercase">
              <div className="p-3">时间</div>
              <div className="p-3 border-l border-[var(--line)]">English</div>
              <div className="p-3 border-l border-[var(--line)]">中文</div>
            </div>
            <div className="max-h-[420px] overflow-y-auto divide-y divide-[var(--line)]">
              {segs.map((s, i) => (
                <div key={i} className="grid grid-cols-[70px_1fr_1fr] items-start hover:bg-[rgba(56,189,248,0.03)]">
                  <div className="p-3 mono text-xs text-[var(--muted)]">{fmt(s.start)}</div>
                  <textarea
                    className="bg-transparent p-3 text-sm resize-none outline-none border-l border-[var(--line)] focus:bg-[var(--bg-2)] min-h-[44px]"
                    rows={2}
                    value={s.text}
                    onChange={(e) => editSeg(i, "text", e.target.value)}
                  />
                  <textarea
                    className="bg-transparent p-3 text-sm resize-none outline-none border-l border-[var(--line)] text-[var(--accent)] focus:bg-[var(--bg-2)] min-h-[44px]"
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

      <footer className="mt-16 text-center text-xs text-[var(--muted)] mono">
        本地处理 · 密钥仅存于服务端环境变量 · 视频不出本机
      </footer>
    </main>
  );
}
