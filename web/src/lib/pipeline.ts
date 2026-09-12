import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { deepseekJson } from "./deepseek";

export type Segment = { start: number; end: number; text: string; zh?: string };

/** AI 课堂摘要：要点 / 教授强调 / 待办行动项 */
export type Summary = {
  points: string[]; // 本节课核心要点
  emphasis: string[]; // 教授反复强调 / 疑似考点
  actions: string[]; // 作业、deadline、待办
};

/** 专业词表条目（中英对照 + 释义） */
export type GlossaryItem = { en: string; zh: string; note?: string };

export type TaskStatus =
  | "queued"
  | "extracting"
  | "transcribing"
  | "translating"
  | "analyzing"
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
  encoder?: string; // h264_nvenc / libx264
  error?: string;
  createdAt: number;
  // —— 学习增强字段（借鉴 Otter / Notta）——
  title?: string; // 视频文件名（去扩展名）
  course?: string; // 所属课程频道（Channels）
  duration?: number; // 视频时长（秒）
  summary?: Summary; // AI 课堂摘要 + 行动项
  glossary?: GlossaryItem[]; // 专业词表
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

export function newTask(videoFile: string, title?: string): Task {
  const t: Task = {
    id: randomUUID().slice(0, 8),
    status: "queued",
    progress: 0,
    message: "已加入队列",
    videoFile,
    title,
    createdAt: Date.now(),
  };
  fs.writeFileSync(taskPath(t.id), JSON.stringify(t));
  return t;
}

/** 列出所有任务（按时间倒序），用于课程频道与全文搜索 */
export function listTasks(): Task[] {
  if (!fs.existsSync(TASK_DIR)) return [];
  const out: Task[] = [];
  for (const f of fs.readdirSync(TASK_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(TASK_DIR, f), "utf-8")) as Task);
    } catch {
      /* 跳过损坏文件 */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
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

/**
 * 删除任务及其全部磁盘产物（上传视频 / 音轨 / 中间 json / srt / 烧录 mp4 / PDF）。
 * 只清理位于本项目 .data 目录下的文件，用户原始磁盘文件不受影响。
 * task json 损坏（OneDrive 回滚等）时仍按 id 前缀强删，避免产生删不掉的僵尸任务。
 */
export function deleteTask(id: string): boolean {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return false; // 防路径注入
  const t = getTask(id);
  const taskExists = fs.existsSync(taskPath(id));
  if (!t && !taskExists) return false;

  const inData = (p?: string) =>
    !!p && path.resolve(p).startsWith(path.resolve(DATA_DIR) + path.sep);

  const targets = new Set<string>();
  if (t) for (const p of [t.videoFile, t.audioFile, t.srtFile, t.burnedFile]) if (inData(p)) targets.add(path.resolve(p!));

  // 按 id 前缀扫工作目录与输出目录，兜住未在 task 里记录的中间产物
  for (const dir of [UPLOAD_DIR, WORK_DIR, OUT_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f === id || f.startsWith(`${id}.`) || f.startsWith(`${id}_`)) targets.add(path.join(dir, f));
    }
  }

  for (const p of Array.from(targets)) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* 文件被占用（如视频正在播放）时跳过，仍继续删其余产物 */
    }
  }
  fs.rmSync(taskPath(id), { force: true });
  return true;
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

function findFfprobe(): string {
  if (process.env.FFMPEG_BIN) {
    const probe = process.env.FFMPEG_BIN.replace(/ffmpeg\.exe$/i, "ffprobe.exe");
    if (fs.existsSync(probe)) return probe;
  }
  return "ffprobe";
}

/** 用 ffprobe 读取视频时长（秒）；失败返回 null */
export async function probeDuration(videoFile: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(findFfprobe(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoFile], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      const sec = parseFloat(out.trim());
      resolve(code === 0 && Number.isFinite(sec) ? sec : null);
    });
  });
}

export const MAX_DURATION_SEC = 2 * 60 * 60; // 最长导入 2 小时

/** 阶段一：抽取 16kHz 单声道 wav */
export async function extractAudio(taskId: string) {
  const t = getTask(taskId);
  if (!t) throw new Error("task not found");
  updateTask(taskId, { status: "extracting", progress: 5, message: "正在抽取音轨…" });
  const audio = path.join(WORK_DIR, `${t.id}.wav`);
  await run(findFfmpeg(), ["-y", "-i", t.videoFile, "-vn", "-ac", "1", "-ar", "16000", audio], {
    timeoutMs: 30 * 60 * 1000,
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

  const segs = t.segments;
  const BATCH = 20;
  for (let i = 0; i < segs.length; i += BATCH) {
    const batch = segs.slice(i, i + BATCH);
    const payload = batch.map((s, n) => ({ n, en: s.text }));
    const data = await deepseekJson(
      "你是短视频字幕翻译。把英文字幕翻译成简体中文，要求：口语化、贴合原意、简洁（每条不超过20字），保留专有名词原文。只输出 JSON：{\"items\":[{\"n\":序号,\"zh\":\"译文\"}]}",
      JSON.stringify({ items: payload })
    );
    const parsed = data as { items?: { n: number; zh: string }[] };
    for (const item of parsed.items || []) {
      const idx = i + (item.n ?? 0);
      if (segs[idx]) segs[idx].zh = String(item.zh || "").trim();
    }
    updateTask(taskId, {
      progress: 65 + Math.round(((i + BATCH) / segs.length) * 20),
      message: `翻译中 ${Math.min(i + BATCH, segs.length)}/${segs.length}`,
    });
  }
  updateTask(taskId, { segments: segs, progress: 85, message: "翻译完成" });
}

/**
 * 阶段四：AI 课堂摘要 + 专业词表（借鉴 Otter 的 AI 摘要/行动项、Notta 的可视化笔记）
 * 一次调用同时产出要点、教授强调项、待办与中英术语表。
 */
export async function analyze(taskId: string) {
  const t = getTask(taskId);
  if (!t || !t.segments) throw new Error("segments missing");
  updateTask(taskId, { status: "analyzing", progress: 88, message: "AI 生成课堂笔记与词表…" });

  // 全英文课堂 transcript 可能很长，截断到 ~12000 字符避免超上下文
  const transcript = t.segments
    .map((s) => s.text)
    .join(" ")
    .slice(0, 12000);

  const data = await deepseekJson(
    "你是中外合作办学学生的课堂笔记助手。阅读英文课堂逐字稿，输出结构化中文笔记与术语表。" +
      "只输出 JSON：{\"points\":[\"核心要点\"],\"emphasis\":[\"教授反复强调或疑似考点\"]," +
      "\"actions\":[\"作业/deadline/待办，没有则空数组\"]," +
      "\"glossary\":[{\"en\":\"英文术语\",\"zh\":\"中文释义\",\"note\":\"简短说明\"}]}" +
      "。points/emphasis 各 3-6 条，actions 0-5 条，glossary 挑 6-12 个学术/专业术语。",
    JSON.stringify({ transcript }),
    0.2
  );

  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
  const summary: Summary = {
    points: arr(data.points),
    emphasis: arr(data.emphasis),
    actions: arr(data.actions),
  };
  const glossary: GlossaryItem[] = (Array.isArray(data.glossary) ? data.glossary : [])
    .map((g) => {
      const o = (g || {}) as Record<string, unknown>;
      return { en: String(o.en || "").trim(), zh: String(o.zh || "").trim(), note: String(o.note || "").trim() };
    })
    .filter((g) => g.en && g.zh);

  updateTask(taskId, { summary, glossary, status: "ready", progress: 92, message: "双语字幕与课堂笔记已生成" });
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

/** 阶段四：烧录双语字幕（优先 NVENC 显卡编码，失败回退 libx264） */
export async function burnSubtitles(taskId: string) {
  const t = getTask(taskId);
  if (!t) throw new Error("task not found");
  if (!t.segments) throw new Error("segments missing");
  updateTask(taskId, { status: "burning", progress: 95, message: "正在烧录字幕视频（GPU 加速）…" });

  const out = path.join(OUT_DIR, `${t.id}.subtitled.mp4`);
  const srt = t.srtFile || writeSrt(taskId);
  // Windows + ffmpeg9：必须 filename='...' 显式命名，正斜杠路径 + 转义盘符冒号（C\:/），
  // 否则 "C:" 会被当作 original_size 选项解析失败
  const fwd = srt.replace(/\\/g, "/");
  const escaped = `${fwd.slice(0, 1)}\\:${fwd.slice(2)}`.replace(/'/g, "\\'");
  const assStyle =
    "FontName=Microsoft YaHei,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000," +
    "BorderStyle=1,Outline=1.5,Shadow=0.5,Alignment=2,MarginV=60";
  const vf = `subtitles=filename='${escaped}':force_style='${assStyle}'`;

  const nvencArgs = [
    "-y", "-i", t.videoFile, "-vf", vf,
    "-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "23", "-b:v", "0",
    "-c:a", "copy", out,
  ];
  const cpuArgs = [
    "-y", "-i", t.videoFile, "-vf", vf,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
    "-c:a", "copy", out,
  ];

  try {
    await run(findFfmpeg(), nvencArgs, { timeoutMs: 60 * 60 * 1000 });
    updateTask(taskId, { encoder: "h264_nvenc" });
  } catch {
    // 无 NVIDIA 显卡 / 驱动异常时回退 CPU 编码
    updateTask(taskId, { message: "GPU 编码不可用，回退 CPU 编码…" });
    await run(findFfmpeg(), cpuArgs, { timeoutMs: 90 * 60 * 1000 });
    updateTask(taskId, { encoder: "libx264" });
  }

  updateTask(taskId, { burnedFile: out, status: "done", progress: 100, message: "完成" });
}

/** 生成 Markdown 复习笔记（借鉴 Notta Document Builder：转录 + 摘要 → 结构化文档） */
export function buildNotesMarkdown(taskId: string): string {
  const t = getTask(taskId);
  if (!t || !t.segments) throw new Error("segments missing");
  const date = new Date(t.createdAt).toLocaleDateString("zh-CN");
  const L: string[] = [];
  L.push(`# ${t.title || `视频 ${t.id}`} · 课堂笔记`);
  L.push(`> 课程：${t.course || "未分类"} ｜ 日期：${date} ｜ 共 ${t.segments.length} 句`);
  L.push("");
  if (t.summary && (t.summary.points.length || t.summary.emphasis.length || t.summary.actions.length)) {
    L.push("## 本节课要点");
    for (const p of t.summary.points) L.push(`- ${p}`);
    L.push("");
    if (t.summary.emphasis.length) {
      L.push("## ⚠️ 教授强调 / 疑似考点");
      for (const p of t.summary.emphasis) L.push(`- ${p}`);
      L.push("");
    }
    if (t.summary.actions.length) {
      L.push("## ✅ 待办事项");
      for (const p of t.summary.actions) L.push(`- [ ] ${p}`);
      L.push("");
    }
  }
  if (t.glossary?.length) {
    L.push("## 📖 专业词表");
    L.push("| 英文术语 | 中文释义 | 说明 |");
    L.push("| --- | --- | --- |");
    for (const g of t.glossary) L.push(`| ${g.en} | ${g.zh} | ${g.note || ""} |`);
    L.push("");
  }
  L.push("## 双语转录全文");
  for (const s of t.segments) L.push(`**[${fmtClock(s.start)}]** ${s.text}\n\n${s.zh || ""}\n`);
  return L.join("\n");
}

function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 生成纸墨手账风 HTML 复习笔记（可直接浏览器打开 / 打印成 PDF） */
export function buildNotesHtml(taskId: string): string {
  const t = getTask(taskId);
  if (!t || !t.segments) throw new Error("segments missing");
  const date = new Date(t.createdAt).toLocaleDateString("zh-CN");
  const li = (arr: string[]) => arr.map((x) => `<li>${escHtml(x)}</li>`).join("");
  const glossRows = (t.glossary || [])
    .map((g) => `<tr><td class="en">${escHtml(g.en)}</td><td>${escHtml(g.zh)}</td><td class="note">${escHtml(g.note || "")}</td></tr>`)
    .join("");
  const transcript = t.segments
    .map((s) => `<div class="seg"><span class="ts">${fmtClock(s.start)}</span><div><p class="en">${escHtml(s.text)}</p><p class="zh">${escHtml(s.zh || "")}</p></div></div>`)
    .join("");
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(t.title || "课堂笔记")} · 视频快译</title>
<style>
:root{--bg:#f5f0e8;--panel:#faf6ef;--line:#1c1911;--muted:#7a7468;--text:#1c1911;--accent:#e8634a;--note:#fbe8a6}
*{box-sizing:border-box}
body{background:radial-gradient(#e4dccb 1px,transparent 1.5px) 0 0/26px 26px,var(--bg);color:var(--text);font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;padding:48px 24px;line-height:1.6}
.wrap{max-width:820px;margin:0 auto}
h1{font-family:"Kaiti SC","STKaiti","KaiTi",serif;font-size:32px;margin:0 0 8px}
.meta{color:var(--muted);font-size:14px;margin-bottom:36px}
h2{font-family:"Kaiti SC","STKaiti","KaiTi",serif;font-size:20px;margin:36px 0 14px}
.card{background:var(--panel);border:1.5px solid var(--line);border-radius:16px;padding:22px 26px;margin-bottom:18px;box-shadow:3px 4px 0 rgba(28,25,17,.16)}
ul{margin:0;padding-left:20px;line-height:1.8}
.card.warn{background:var(--note)}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px 12px;border-bottom:1.5px solid rgba(28,25,17,.18)}
th{color:var(--muted);font-weight:500}
td.en{color:var(--accent);font-family:ui-monospace,monospace}
td.note{color:var(--muted)}
.seg{display:flex;gap:14px;padding:10px 0;border-bottom:1.5px solid rgba(28,25,17,.12)}
.ts{color:var(--muted);font-family:ui-monospace,monospace;font-size:12px;min-width:52px;padding-top:3px}
.en{margin:0;line-height:1.6}
.zh{margin:4px 0 0;color:var(--accent);line-height:1.6;font-size:14px}
footer{margin-top:48px;color:var(--muted);font-size:12px;text-align:center}
@media print{body{background:#fff}.card{box-shadow:none}}
</style></head><body><div class="wrap">
<h1>${escHtml(t.title || `视频 ${t.id}`)}</h1>
<p class="meta">课程：${escHtml(t.course || "未分类")} ｜ ${date} ｜ ${t.segments.length} 句转录</p>
${t.summary?.points?.length ? `<h2>本节课要点</h2><div class="card"><ul>${li(t.summary.points)}</ul></div>` : ""}
${t.summary?.emphasis?.length ? `<h2>教授强调 / 疑似考点</h2><div class="card warn"><ul>${li(t.summary.emphasis)}</ul></div>` : ""}
${t.summary?.actions?.length ? `<h2>待办事项</h2><div class="card"><ul>${li(t.summary.actions)}</ul></div>` : ""}
${glossRows ? `<h2>专业词表</h2><div class="card"><table><tr><th>英文术语</th><th>中文释义</th><th>说明</th></tr>${glossRows}</table></div>` : ""}
<h2>双语转录全文</h2><div class="card">${transcript}</div>
<footer>由「视频快译」自动生成 · 本地处理 · 视频不出本机</footer>
</div></body></html>`;
}

/**
 * 中英文混合分词：英文按空格取词（≥2 字符），中文取相邻二字组合（bigram）。
 * 「作业什么时候交」→ 作业/业什/什么/么时/时候/候交，可匹配转录里的中文译文。
 */
export function tokenize(q: string): string[] {
  const s = q.toLowerCase();
  const terms = new Set<string>();
  for (const w of s.match(/[a-z0-9'’]{2,}/g) || []) terms.add(w);
  for (const run of s.match(/[\u4e00-\u9fff]+/g) || []) {
    if (run.length === 1) terms.add(run);
    for (let i = 0; i + 1 < run.length; i++) terms.add(run.slice(i, i + 2));
  }
  return Array.from(terms);
}

/** 全文搜索：跨所有任务的转录文本 / 中文译文 / 摘要 / 课程名，命中定位到句级时间戳 */
export type SearchHit = {
  taskId: string;
  title?: string;
  course?: string;
  start: number;
  end: number;
  text: string;
  zh?: string;
  source?: string; // 命中来源：字幕原文（无）/ AI 笔记条目 / 专业词表
};

/** 词组命中计数 */
function countTerms(hay: string, terms: string[]): number {
  let n = 0;
  for (const term of terms) if (hay.includes(term)) n++;
  return n;
}

/** 摘要/词表的可检索块 */
function noteBlocks(t: Task): { label: string; text: string }[] {
  const blocks: { label: string; text: string }[] = [];
  for (const [label, items] of [
    ["本节课要点", t.summary?.points || []],
    ["教授强调 / 疑似考点", t.summary?.emphasis || []],
    ["待办事项", t.summary?.actions || []],
  ] as const) {
    for (const item of items) blocks.push({ label, text: item });
  }
  for (const g of t.glossary || []) blocks.push({ label: "专业词表", text: `${g.en} ${g.zh} ${g.note || ""}` });
  return blocks;
}

export function searchAll(query: string): SearchHit[] {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const hits: (SearchHit & { score: number })[] = [];
  for (const t of listTasks()) {
    const meta = `${t.title || ""} ${t.course || ""}`.toLowerCase();
    for (const s of t.segments || []) {
      const hay = `${s.text} ${s.zh || ""}`.toLowerCase();
      let score = countTerms(hay, terms) * 2;
      if (countTerms(meta, terms)) score += 1;
      if (score > 0) hits.push({ taskId: t.id, title: t.title, course: t.course, start: s.start, end: s.end, text: s.text, zh: s.zh, score });
    }
    // AI 笔记与词表同样可搜（「待办事项有哪些」这类问题命中的是摘要而非字幕）
    // 注意把分类标签也计入检索文本：条目本身常不含「待办」「考点」这类元词
    for (const b of noteBlocks(t)) {
      const score = countTerms(`${b.label} ${b.text}`.toLowerCase(), terms) * 2;
      if (score > 0)
        hits.push({ taskId: t.id, title: t.title, course: t.course, start: 0, end: 0, text: b.text, source: b.label, score });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((h) => ({ taskId: h.taskId, title: h.title, course: h.course, start: h.start, end: h.end, text: h.text, zh: h.zh, source: h.source }));
}

/** 跨课程问答的语料检索（中英混合分词打分，本地零依赖）：返回最相关的若干上下文块 */
export function retrieveCorpus(query: string, course?: string): string {
  const terms = tokenize(query);
  const scored: { text: string; score: number; taskId: string; title?: string }[] = [];
  for (const t of listTasks()) {
    if (course && t.course !== course) continue;
    // AI 笔记与词表块（标签也计入检索文本，支持「待办事项有哪些」这类元提问）
    for (const b of noteBlocks(t)) {
      const score = countTerms(`${b.label} ${b.text}`.toLowerCase(), terms) * 2;
      if (score > 0) scored.push({ text: `（${b.label}）${b.text}`, score, taskId: t.id, title: t.title });
    }
    if (!t.segments) continue;
    // 以 5 句为窗口聚合字幕，给模型足够的上下文
    const win: Segment[] = [];
    for (let i = 0; i < t.segments.length; i++) {
      win.push(t.segments[i]);
      if (win.length === 5) {
        const hay = win.map((s) => `${s.text} ${s.zh || ""}`).join(" ").toLowerCase();
        const score = countTerms(hay, terms);
        if (score > 0) scored.push({ text: win.map((s) => `[${fmtClock(s.start)}] ${s.text}（${s.zh || ""}）`).join("\n"), score, taskId: t.id, title: t.title });
        win.shift();
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, 12)
    .map((x) => `【${x.title || x.taskId}】\n${x.text}`)
    .join("\n\n");
}

/** 总编排：上传后自动跑 抽取→转写→翻译→AI 笔记 */
export async function runPipeline(taskId: string) {
  try {
    await extractAudio(taskId);
    await transcribe(taskId);
    await translate(taskId);
    await analyze(taskId);
  } catch (e) {
    updateTask(taskId, { status: "error", error: e instanceof Error ? e.message : String(e), message: "处理失败" });
  }
}

/* ─────────────────────────────────────────────────────────
 * 奶油风（纸墨手账）字幕 PDF 导出
 * ───────────────────────────────────────────────────────── */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 双语字幕的纸墨手账风 HTML（与全站奶油风一致：点阵纸纹/墨线描边/硬边投影/贴纸倾斜） */
export function buildSubtitleHtml(taskId: string): string {
  const t = getTask(taskId);
  if (!t || !t.segments) throw new Error("segments missing");
  const date = new Date(t.createdAt).toLocaleDateString("zh-CN");
  const rows = t.segments
    .map(
      (s, i) => `
<div class="seg ${i % 2 ? "tilt-r" : "tilt-l"}">
  <span class="no mono">${String(i + 1).padStart(2, "0")}</span>
  <span class="ts mono">${fmtClock(s.start)} → ${fmtClock(s.end)}</span>
  <div class="tx">
    <p class="en">${esc(s.text)}</p>
    <p class="zh">${esc(s.zh || "")}</p>
  </div>
</div>`
    )
    .join("");

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(t.title || `视频 ${t.id}`)} · 双语字幕</title>
<style>
:root{--bg:#F5F0E8;--panel:#FAF6EF;--line:#1C1911;--muted:#7A7468;--text:#1C1911;--accent:#E8634A;--green:#6B9E7A;--note:#FBE8A6}
@page{size:A4;margin:14mm}
*{box-sizing:border-box}
body{background:radial-gradient(#E4DCCB 1px,transparent 1.5px) 0 0/26px 26px,var(--bg);color:var(--text);font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;padding:36px 28px;line-height:1.6}
.wrap{max-width:760px;margin:0 auto}
h1{font-family:"Kaiti SC","STKaiti","KaiTi",serif;font-size:30px;margin:0 0 6px}
.meta{color:var(--muted);font-size:13px;margin-bottom:28px}
.badge{display:inline-block;background:var(--note);border:1.5px solid var(--line);border-radius:999px;padding:3px 14px;font-size:12px;box-shadow:3px 4px 0 rgba(28,25,17,.16);margin-bottom:18px}
.seg{display:flex;gap:14px;background:var(--panel);border:1.5px solid var(--line);border-radius:16px;padding:14px 18px;margin-bottom:14px;box-shadow:3px 4px 0 rgba(28,25,17,.16);break-inside:avoid}
.seg.tilt-l{transform:rotate(-0.6deg)}
.seg.tilt-r{transform:rotate(0.5deg)}
.no{color:#fff;background:var(--accent);border-radius:8px;min-width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;align-self:center;border:1.5px solid var(--line)}
.ts{color:var(--muted);font-size:11px;min-width:96px;padding-top:6px;flex-shrink:0}
.mono{font-family:ui-monospace,Consolas,monospace}
.en{margin:0;font-size:15px;line-height:1.55}
.zh{margin:4px 0 0;color:var(--green);font-size:14px;font-weight:600}
footer{margin-top:36px;color:var(--muted);font-size:12px;text-align:center}
@media print{body{padding:0}.seg{box-shadow:2px 3px 0 rgba(28,25,17,.14)}}
</style></head><body><div class="wrap">
<h1>📽️ ${esc(t.title || `视频 ${t.id}`)}</h1>
<p class="meta">课程：${esc(t.course || "未分类")} ｜ ${date} ｜ 共 ${t.segments.length} 句双语字幕</p>
<span class="badge">✂️ 视频快译 · 中英双语字幕</span>
${rows}
<footer>由「视频快译」自动生成 · 纸墨手账风 · 本地处理</footer>
</div></body></html>`;
}

function findChrome(): string | null {
  const cands = [
    process.env.CHROME_BIN,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean) as string[];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

/** 用本机 Chrome/Edge headless 把 HTML 打印成 PDF（零依赖，样式与奶油风 100% 一致） */
export async function htmlToPdf(html: string, nameHint: string): Promise<Buffer> {
  const chrome = findChrome();
  if (!chrome) throw new Error("未找到 Chrome/Edge，无法生成 PDF");

  const tmpHtml = path.join(WORK_DIR, `${nameHint}.pdfsrc.html`);
  const tmpPdf = path.join(WORK_DIR, `${nameHint}.pdfout.pdf`);
  const tmpProfile = path.join(WORK_DIR, `${nameHint}.chrome-profile`);
  fs.writeFileSync(tmpHtml, html, "utf-8");
  fs.rmSync(tmpPdf, { force: true });

  const url = "file:///" + tmpHtml.replace(/\\/g, "/");
  try {
    // 独立 user-data-dir：防止已运行的 Chrome 实例接管进程而不输出文件
    await run(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--user-data-dir=${tmpProfile}`,
      `--print-to-pdf=${tmpPdf}`,
      "--no-pdf-header-footer",
      "--virtual-time-budget=8000",
      url,
    ], { timeoutMs: 60 * 1000 });
  } finally {
    fs.rmSync(tmpHtml, { force: true });
    fs.rmSync(tmpProfile, { recursive: true, force: true });
  }

  if (!fs.existsSync(tmpPdf)) throw new Error("PDF 生成失败（Chrome 未输出文件）");
  const buf = fs.readFileSync(tmpPdf);
  fs.rmSync(tmpPdf, { force: true });
  return buf;
}
