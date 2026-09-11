import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

export type Segment = { start: number; end: number; text: string; zh?: string };

export type TaskStatus =
  | "queued"
  | "extracting"
  | "transcribing"
  | "translating"
  | "ready"
  | "burning"
  | "done"
  | "error";

export type Task = {
  id: string;
  status: TaskStatus;
  progress: number; // 0-100
  message: string;
  videoFile: string; // absolute path
  audioFile?: string;
  segments?: Segment[];
  srtFile?: string;
  burnedFile?: string;
  error?: string;
  createdAt: number;
};

const ROOT = path.resolve(process.cwd(), "..");
export const DATA_DIR = path.join(ROOT, ".data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const WORK_DIR = path.join(DATA_DIR, "work");
export const OUT_DIR = path.join(DATA_DIR, "out");
const TASK_DIR = path.join(DATA_DIR, "tasks");
export const MODEL_SIZE = process.env.WHISPER_MODEL || "small";

for (const d of [UPLOAD_DIR, WORK_DIR, OUT_DIR, TASK_DIR]) fs.mkdirSync(d, { recursive: true });

// 任务持久化到磁盘：dev 模式下 Next.js 热重编译会清空模块级内存，必须落盘
function taskPath(id: string) {
  return path.join(TASK_DIR, `${id}.json`);
}

export function newTask(videoFile: string): Task {
  const t: Task = {
    id: randomUUID().slice(0, 8),
    status: "queued",
    progress: 0,
    message: "已加入队列",
    videoFile,
    createdAt: Date.now(),
  };
  fs.writeFileSync(taskPath(t.id), JSON.stringify(t));
  return t;
}

export function getTask(id: string): Task | undefined {
  const p = taskPath(id);
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Task;
  } catch {
    return undefined;
  }
}

export function updateTask(id: string, patch: Partial<Task>) {
  const t = getTask(id);
  if (t) {
    Object.assign(t, patch);
    fs.writeFileSync(taskPath(id), JSON.stringify(t));
  }
  return t;
}

function run(
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false, windowsHide: true, env: opts?.env });
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;
    if (opts?.timeoutMs) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`${cmd} 超时`));
      }, opts.timeoutMs);
    }
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(cmd)} 退出码 ${code}: ${stderr.slice(-800)}`));
    });
  });
}

function findPython(): string {
  const local = path.join(ROOT, "pyenv", "Scripts", "python.exe");
  if (fs.existsSync(local)) return local;
  return process.env.PYTHON_BIN || "python";
}

function findFfmpeg(): string {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  return "ffmpeg";
}

/** 阶段一：抽取 16kHz 单声道 wav */
export async function extractAudio(taskId: string) {
  const t = getTask(taskId);
  if (!t) throw new Error("task not found");
  updateTask(taskId, { status: "extracting", progress: 5, message: "正在抽取音轨…" });
  const audio = path.join(WORK_DIR, `${t.id}.wav`);
  await run(findFfmpeg(), ["-y", "-i", t.videoFile, "-vn", "-ac", "1", "-ar", "16000", audio], {
    timeoutMs: 10 * 60 * 1000,
  });
  updateTask(taskId, { audioFile: audio, progress: 15, message: "音轨抽取完成" });
}

/** 阶段二：faster-whisper 英文转写 */
export async function transcribe(taskId: string) {
  const t = getTask(taskId);
  if (!t || !t.audioFile) throw new Error("audio missing");
  updateTask(taskId, { status: "transcribing", progress: 20, message: "Whisper 转写中（首次运行需下载模型）…" });
  const outJson = path.join(WORK_DIR, `${t.id}.en.json`);
  const script = path.join(ROOT, "scripts", "transcribe.py");
  await run(findPython(), [script, t.audioFile, outJson, MODEL_SIZE], {
    timeoutMs: 60 * 60 * 1000,
    env: {
      ...process.env,
      HF_ENDPOINT: process.env.HF_ENDPOINT || "https://hf-mirror.com", // 国内镜像，防 HuggingFace 下载超时
      HF_HUB_DISABLE_XET: "1", // Xet 协议不走镜像会 401，强制回退普通 HTTP 下载
      HF_HOME: path.join(DATA_DIR, "hf_cache"),
    },
  });
  const segments = JSON.parse(fs.readFileSync(outJson, "utf-8")) as Segment[];
  updateTask(taskId, { segments, progress: 60, message: `转写完成，共 ${segments.length} 句` });
}

/** 阶段三：DeepSeek 批量翻译 */
export async function translate(taskId: string) {
  const t = getTask(taskId);
  if (!t || !t.segments) throw new Error("segments missing");
  updateTask(taskId, { status: "translating", progress: 65, message: "DeepSeek 翻译中…" });

  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || key.startsWith("sk-xxxx")) {
    throw new Error("未配置 DEEPSEEK_API_KEY，请在项目根目录 .env.local 中填写");
  }
  const base = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

  const segs = t.segments;
  const BATCH = 20;
  for (let i = 0; i < segs.length; i += BATCH) {
    const batch = segs.slice(i, i + BATCH);
    const payload = batch.map((s, n) => ({ n, en: s.text }));
    const resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是短视频字幕翻译。把英文字幕翻译成简体中文，要求：口语化、贴合原意、简洁（每条不超过20字），保留专有名词原文。只输出 JSON：{\"items\":[{\"n\":序号,\"zh\":\"译文\"}]}",
          },
          { role: "user", content: JSON.stringify({ items: payload }) },
        ],
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`DeepSeek API ${resp.status}: ${body.slice(0, 300)}`);
    }
    const data = await resp.json();
    const parsed = JSON.parse(data.choices[0].message.content) as { items?: { n: number; zh: string }[] };
    for (const item of parsed.items || []) {
      const idx = i + (item.n ?? 0);
      if (segs[idx]) segs[idx].zh = String(item.zh || "").trim();
    }
    updateTask(taskId, {
      progress: 65 + Math.round(((i + BATCH) / segs.length) * 25),
      message: `翻译中 ${Math.min(i + BATCH, segs.length)}/${segs.length}`,
    });
  }
  updateTask(taskId, { segments: segs, status: "ready", progress: 92, message: "双语字幕已生成" });
}

/** SRT 工具 */
function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function buildSrt(segs: Segment[]): string {
  return segs
    .map((s, i) => `${i + 1}\n${fmtTime(s.start)} --> ${fmtTime(s.end)}\n${s.text}\n${s.zh || ""}\n`)
    .join("\n");
}

export function writeSrt(taskId: string): string {
  const t = getTask(taskId);
  if (!t || !t.segments) throw new Error("segments missing");
  const file = path.join(OUT_DIR, `${t.id}.srt`);
  fs.writeFileSync(file, "\ufeff" + buildSrt(t.segments), "utf-8"); // BOM 兼容剪映/老播放器
  updateTask(taskId, { srtFile: file });
  return file;
}

/** 阶段四：烧录双语字幕（Force Style：白字黑边、底部、双语两行） */
export async function burnSubtitles(taskId: string) {
  const t = getTask(taskId);
  if (!t) throw new Error("task not found");
  const srt = t.srtFile || writeSrt(taskId);
  updateTask(taskId, { status: "burning", progress: 95, message: "正在烧录字幕视频…" });

  const out = path.join(OUT_DIR, `${t.id}.subtitled.mp4`);
  // Windows + ffmpeg9：必须 filename='...' 显式命名，正斜杠路径 + 转义盘符冒号（C\:/），
  // 否则 "C:" 会被当作 original_size 选项解析失败
  const fwd = srt.replace(/\\/g, "/"); // "C:/Users/..."
  const escaped = `${fwd.slice(0, 1)}\\:${fwd.slice(2)}`.replace(/'/g, "\\'"); // "C\:/Users/..."
  const style =
    "FontName=Microsoft YaHei,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000," +
    "BorderStyle=1,Outline=1.5,Shadow=0.5,Alignment=2,MarginV=60";
  await run(findFfmpeg(), [
    "-y",
    "-i",
    t.videoFile,
    "-vf",
    `subtitles=filename='${escaped}':force_style='${style}'`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "21",
    "-c:a",
    "copy",
    out,
  ], { timeoutMs: 30 * 60 * 1000 });

  updateTask(taskId, { burnedFile: out, status: "done", progress: 100, message: "完成" });
}

/** 总编排：上传后自动跑 抽取→转写→翻译 */
export async function runPipeline(taskId: string) {
  try {
    await extractAudio(taskId);
    await transcribe(taskId);
    await translate(taskId);
  } catch (e) {
    updateTask(taskId, { status: "error", error: e instanceof Error ? e.message : String(e), message: "处理失败" });
  }
}
