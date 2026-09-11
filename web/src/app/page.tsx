"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Segment = { start: number; end: number; text: string; zh?: string };
type Task = {
  id: string;
  status: string;
  progress: number;
  message: string;
  error?: string;
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

  // 编辑后重新生成 SRT：把当前 segs POST 回后端覆盖（简化：直接前端拼 SRT 下载）
  const downloadSrt = () => {
    const fmtT = (sec: number) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      const ms = Math.round((sec % 1) * 1000);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
    };
    const body = segs
      .map((s, i) => `${i + 1}\n${fmtT(s.start)} --> ${fmtT(s.end)}\n${s.text}\n${s.zh || ""}\n`)
      .join("\n");
    const blob = new Blob(["\ufeff" + body], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `subtitle-${task?.id}.srt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const pushEditsAndBurn = async () => {
    if (!task) return;
    setBurning(true);
    // 先把编辑同步到后端，再触发烧录
    await fetch(`/api/segments/${task.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: segs }),
    }).catch(() => {});
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
          <p className="text-sm text-[var(--muted)] mt-2">支持 MP4 / MOV / MKV / WebM，≤ 500MB</p>
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
            <div className="panel p-6 flex flex-col gap-4">
              <div>
                <p className="font-medium">双语字幕已生成 ✓</p>
                <p className="text-sm text-[var(--muted)] mt-1">
                  共 {segs.length} 句 · 可直接编辑下方文字，导出时以编辑内容为准
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button className="btn-primary" onClick={downloadSrt}>
                  ⬇ 下载双语 SRT
                </button>
                <button
                  className="btn-ghost"
                  disabled={burning || task.status === "burning" || task.status === "done"}
                  onClick={pushEditsAndBurn}
                >
                  {task.status === "done"
                    ? "已生成烧录视频"
                    : burning || task.status === "burning"
                      ? `烧录中… ${task.progress}%`
                      : "🎬 生成烧录字幕视频"}
                </button>
                <button className="btn-ghost" onClick={() => setTask(null)}>
                  处理下一个视频
                </button>
              </div>
              {task.status === "done" && (
                <a
                  href={`/api/video/${task.id}/burned`}
                  className="text-sm text-[var(--ok)] mono"
                  download
                >
                  ⬇ 下载烧录版 mp4
                </a>
              )}
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
