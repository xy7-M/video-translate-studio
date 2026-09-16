import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { deepseekJson } from "./deepseek";

export type Segment = {
  start: number;
  end: number;
  text: string;
  zh?: string;
  words?: { w: string; s: number; e: number }[]; // whisper 词级时间戳（断句后即剥离，不入库）
};

/** AI 课堂摘要：要点 / 教授强调 / 待办行动项 */
export type Summary = {
  points: string[]; // 本节课核心要点
  emphasis: string[]; // 教授反复强调 / 疑似考点
};

/** 视频剖析：把整条视频按主题切成若干时间段，供快速回看跳转 */
export type TimelineSeg = { start: number; end: number; title: string; summary: string };

/** 专业词表条目（中英对照 + 释义 + 3 个例句） */
export type GlossaryItem = { en: string; zh: string; note?: string; examples?: string[] };

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
  summary?: Summary; // AI 课堂摘要
  glossary?: GlossaryItem[]; // 专业词表
  timeline?: TimelineSeg[]; // 视频剖析：按主题切分的时间线段
};

// 开发态：web/ 的上级项目根；桌面版：由 Electron 通过 VIDEOTRANS_ROOT 指定 resources 目录
const ROOT = process.env.VIDEOTRANS_ROOT
  ? path.resolve(process.env.VIDEOTRANS_ROOT)
  : path.resolve(process.cwd(), "..");
// 桌面版数据写入用户目录（%APPDATA%/视频快译/vtdata），开发态仍在项目根 .data
export const DATA_DIR = process.env.VIDEOTRANS_HOME
  ? path.resolve(process.env.VIDEOTRANS_HOME)
  : path.join(ROOT, ".data");
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

// —— 历史记录库：全文搜索词 + AI 问答对（落盘 .data/history.json，仿 config.json 单文件模式）——
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const MAX_SEARCH_HISTORY = 50;
const MAX_CHAT_HISTORY = 100;

export type SearchHistoryItem = { id: string; q: string; ts: number; hits: number };
export type ChatHistoryItem = { id: string; question: string; answer: string; course?: string; ts: number };
export type History = { searches: SearchHistoryItem[]; chats: ChatHistoryItem[] };

function readHistory(): History {
  try {
    const h = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")) as Partial<History>;
    return { searches: h.searches || [], chats: h.chats || [] };
  } catch {
    return { searches: [], chats: [] };
  }
}

function writeHistory(h: History) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2), "utf-8");
}

export function listHistory(): History {
  return readHistory();
}

/** 记录一次搜索：同词去重置顶，超出上限裁尾 */
export function addSearchHistory(q: string, hits: number) {
  const h = readHistory();
  const term = q.trim();
  if (!term) return;
  h.searches = [
    { id: randomUUID().slice(0, 8), q: term, ts: Date.now(), hits },
    ...h.searches.filter((s) => s.q !== term),
  ].slice(0, MAX_SEARCH_HISTORY);
  writeHistory(h);
}

/** 记录一次问答（含 DeepSeek 回答），同问题去重置顶 */
export function addChatHistory(question: string, answer: string, course?: string) {
  const h = readHistory();
  const q = question.trim();
  if (!q) return;
  h.chats = [
    { id: randomUUID().slice(0, 8), question: q, answer, course: course?.trim() || undefined, ts: Date.now() },
    ...h.chats.filter((c) => c.question !== q),
  ].slice(0, MAX_CHAT_HISTORY);
  writeHistory(h);
}

export function clearHistory(kind: "search" | "chat" | "all") {
  const h = readHistory();
  if (kind === "search" || kind === "all") h.searches = [];
  if (kind === "chat" || kind === "all") h.chats = [];
  writeHistory(h);
}

/**
 * 课程名查重：与既有频道 trim 后完全一致 → 正常归类，返回 null；
 * 仅大小写/首尾空格等变体重名（如已有「Math」又输入「math」）→ 返回已有频道名，供前端提示复用。
 */
export function findCourseVariant(newCourse: string, exceptTaskId?: string): string | null {
  const norm = (s: string) => s.trim().toLowerCase();
  const target = newCourse.trim();
  if (!target) return null; // 清空归类（回到未分类）不算新建
  let variant: string | null = null;
  for (const t of listTasks()) {
    if (t.id === exceptTaskId || !t.course) continue;
    if (t.course.trim() === target) return null; // 精确同名 = 归入已有频道
    if (norm(t.course) === norm(target)) variant = t.course.trim();
  }
  return variant;
}

/** 视频标题查重：trim 后与其他任务完全相同（忽略大小写）→ 返回冲突标题 */
export function findTitleTaken(newTitle: string, exceptTaskId?: string): string | null {
  const norm = (s: string) => s.trim().toLowerCase();
  const target = newTitle.trim();
  if (!target) return null;
  for (const t of listTasks()) {
    if (t.id === exceptTaskId) continue;
    const title = (t.title || "").trim();
    if (title && norm(title) === norm(target)) return title;
  }
  return null;
}

/** 导入时生成不冲突的默认标题：重名则追加 " (2)"、" (3)"… */
export function uniqueTitle(base: string): string {
  const clean = base.trim() || "未命名视频";
  if (!findTitleTaken(clean)) return clean;
  for (let n = 2; n < 1000; n++) {
    const cand = `${clean} (${n})`;
    if (!findTitleTaken(cand)) return cand;
  }
  return `${clean} (${Date.now()})`;
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
  // 桌面版优先使用安装包内置的便携 Python（Electron 通过 PYTHON_BIN 注入）
  if (process.env.PYTHON_BIN && fs.existsSync(process.env.PYTHON_BIN)) return process.env.PYTHON_BIN;
  const local = path.join(ROOT, "pyenv", "Scripts", "python.exe");
  if (fs.existsSync(local)) return local;
  return "python";
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
  const segments = resegmentSegments(JSON.parse(fs.readFileSync(outJson, "utf-8")) as Segment[]);
  updateTask(taskId, { segments, progress: 60, message: `转写完成，共 ${segments.length} 句` });
}

/**
 * 按句号/问号、逗号与语音停顿，把 whisper 的长段重切成「有呼吸感」的短句。
 * 依赖词级时间戳（transcribe.py 已开启）；无词级时间戳的旧数据原样保留。
 * 输出不含 words 字段，顺带完成标点归一（" foo ." → "foo."）。
 */
export function resegmentSegments(segs: Segment[]): Segment[] {
  const MIN_CHARS = 10; // 短于此不断句（避免 "OK." 独占一行）
  const MAX_CHARS = 46; // 硬上限：无标点也要换气
  // 以这些词结尾的行语义未完，停顿再大也不断行（防止 "using physical / properties" 式腰斩）
  const DANGLE = new Set([
    "the", "a", "an", "of", "and", "or", "but", "to", "in", "on", "at", "for", "with", "by", "as",
    "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
    "will", "would", "can", "could", "may", "might", "should",
    "we", "you", "they", "it", "i", "he", "she",
    "this", "that", "these", "those", "there", "here",
    "my", "our", "your", "their", "his", "her", "its",
    "using", "like", "from", "into", "about", "what", "which", "who",
  ]);
  const raw: Segment[] = [];

  for (const seg of segs) {
    const words = seg.words;
    if (!words || words.length === 0) {
      const text = seg.text.trim();
      if (text) raw.push({ start: seg.start, end: seg.end, text });
      continue;
    }
    let cur: { w: string; s: number; e: number }[] = [];
    const flush = () => {
      if (!cur.length) return;
      const text = cur
        .map((x) => x.w)
        .join(" ")
        .replace(/\s+([,.!?;:])/g, "$1")
        .replace(/([,.!?;:])(?=\S)/g, "$1 ")
        .trim();
      if (text) raw.push({ start: cur[0].s, end: cur[cur.length - 1].e, text });
      cur = [];
    };
    for (let i = 0; i < words.length; i++) {
      const wd = words[i];
      cur.push(wd);
      const len = cur.reduce((a, x) => a + x.w.length + 1, 0);
      const gap = i + 1 < words.length ? words[i + 1].s - wd.e : 99;
      const dangling = DANGLE.has(wd.w.replace(/[.,!?;:]$/, "").toLowerCase());
      if (
        (/[.!?]$/.test(wd.w) && len >= MIN_CHARS) ||
        len >= MAX_CHARS ||
        (/[,;]$/.test(wd.w) && len >= 26) ||
        (gap >= 0.6 && len >= MIN_CHARS && !dangling)
      ) {
        flush();
      }
    }
    flush();
  }

  // 碎片并入上一行，避免一闪而过的半句；但合并后不得超过 54 字符
  const out: Segment[] = [];
  for (const s of raw) {
    const prev = out[out.length - 1];
    if (prev && (s.text.length < 18 || s.end - s.start < 0.6) && prev.text.length + s.text.length <= 54) {
      prev.text = `${prev.text} ${s.text}`;
      prev.end = Math.max(prev.end, s.end);
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/**
 * 标点补全：whisper small 常漏句号/逗号，按行批量交给 DeepSeek 复原。
 * 只加标点与首字母大写，严禁改词、增删词，保证行数与英文内容不变。
 */
export async function punctuate(segs: Segment[], onProgress?: (done: number) => void): Promise<Segment[]> {
  const BATCH = 30;
  const out = segs.map((s) => ({ ...s }));
  for (let i = 0; i < out.length; i += BATCH) {
    const batch = out.slice(i, i + BATCH);
    try {
      const data = await deepseekJson(
        "你是英文字幕标点校对员。输入是带序号的字幕行数组。为每一行补上正确的英文标点：" +
          "完整句子结尾加句号（问句用问号），从句与列举之间加逗号，句首字母大写。" +
          "严格禁止：改写、增加、删除任何单词，改变行序或行数。" +
          "只输出 JSON：{\"items\":[{\"n\":序号,\"en\":\"加好标点的原句\"}]}",
        JSON.stringify({ items: batch.map((s, n) => ({ n, en: s.text })) }),
        0
      );
      const items = (data.items || []) as { n: number; en: string }[];
      for (const it of items) {
        const idx = i + (it.n ?? 0);
        const next = String(it.en || "").trim();
        // 仅在词数一致时接受，防止模型擅自改写
        if (idx < out.length && next && next.split(/\s+/).length === out[idx].text.split(/\s+/).length) {
          out[idx].text = next;
        }
      }
    } catch {
      /* 单批失败保留原标点，继续下一批 */
    }
    onProgress?.(Math.min(i + BATCH, out.length));
  }
  return out;
}

/** 阶段三：DeepSeek 批量翻译 */
export async function translate(taskId: string) {
  const t = getTask(taskId);
  if (!t || !t.segments) throw new Error("segments missing");
  updateTask(taskId, { status: "translating", progress: 62, message: "DeepSeek 校对英文标点…" });

  // 先复原英文标点（只加标点不改词），再逐行翻译
  const segs = await punctuate(t.segments);
  updateTask(taskId, { segments: segs, progress: 68, message: "标点校对完成，中文翻译中…" });

  const BATCH = 20;
  for (let i = 0; i < segs.length; i += BATCH) {
    const batch = segs.slice(i, i + BATCH);
    const payload = batch.map((s, n) => ({ n, en: s.text }));
    const data = await deepseekJson(
      "你是短视频双语字幕翻译。输入是按时间顺序切分的英文字幕短句（每行可能只有半句，上一行与下一行连读成完整句子）。要求：" +
        "1) 严格逐行对应：每个 n 输出一条 zh，不得合并、拆分或遗漏行；" +
        "2) 只翻译该行英文的内容，不要借用相邻行的信息，也不要自行补全半句；" +
        "3) 口语化、贴合原意、简洁（每条不超过 18 字），保留专有名词原文；" +
        "4) 中文标点用全角，句内该断则断（逗号、顿号），行尾不加句号。" +
        "只输出 JSON：{\"items\":[{\"n\":序号,\"zh\":\"译文\"}]}",
      JSON.stringify({ items: payload })
    );
    const parsed = data as { items?: { n: number; zh: string }[] };
    for (const item of parsed.items || []) {
      const idx = i + (item.n ?? 0);
      if (segs[idx]) segs[idx].zh = String(item.zh || "").trim();
    }
    updateTask(taskId, {
      progress: 68 + Math.round(((i + BATCH) / segs.length) * 17),
      message: `翻译中 ${Math.min(i + BATCH, segs.length)}/${segs.length}`,
    });
  }
  updateTask(taskId, { segments: segs, progress: 85, message: "翻译完成" });
}

/**
 * 阶段四：AI 课堂摘要 + 专业词表 + 视频剖析（时间线分段）
 * 一次调用产出：要点、教授强调、中英术语表，以及按主题切分的时间线段。
 */
export async function analyze(taskId: string) {
  const t = getTask(taskId);
  if (!t || !t.segments) throw new Error("segments missing");
  updateTask(taskId, { status: "analyzing", progress: 88, message: "AI 生成课堂笔记、词表与视频剖析…" });

  // 全英文课堂 transcript 可能很长，截断到 ~12000 字符避免超上下文
  const transcript = t.segments
    .map((s) => s.text)
    .join(" ")
    .slice(0, 12000);

  // 带序号与时间戳的转录，供模型按行号切分时间段
  const segLines = t.segments
    .map((s, i) => `${i}|${Math.floor(s.start / 60)}:${String(Math.floor(s.start % 60)).padStart(2, "0")}|${s.text}`)
    .join("\n")
    .slice(0, 12000);

  const data = await deepseekJson(
    "你是中外合作办学学生的课堂笔记助手。阅读英文课堂逐字稿，输出结构化中文笔记、术语表与视频剖析。" +
      "只输出 JSON：{\"points\":[\"核心要点\"],\"emphasis\":[\"教授反复强调或疑似考点\"]," +
      "\"glossary\":[{\"en\":\"英文术语\",\"zh\":\"中文释义\",\"note\":\"简明扼要的诠释说明\",\"examples\":[\"含该术语的简单英文例句1\",\"例句2\",\"例句3\"]}]," +
      "\"timeline\":[{\"from\":起始行号,\"to\":结束行号,\"title\":\"该段主题（≤12字）\",\"summary\":\"这段讲了什么（≤40字）\"}]}" +
      "。points/emphasis 各 3-6 条，glossary 挑 6-12 个学术/专业术语。" +
      "glossary 每个术语必须配 3 个结构简单、语义清晰的英文例句（≤15 词，帮助学习者理解、记忆和应用该词）。" +
      "timeline 把整条转录按主题变化切成若干段（≥1 段），段与段首尾相接覆盖全部行号，from/to 必须取自输入的行号。",
    JSON.stringify({ transcript, segments: segLines }),
    0.2
  );

  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
  const summary: Summary = {
    points: arr(data.points),
    emphasis: arr(data.emphasis),

  };
  const glossary: GlossaryItem[] = (Array.isArray(data.glossary) ? data.glossary : [])
    .map((g) => {
      const o = (g || {}) as Record<string, unknown>;
      const ex = Array.isArray(o.examples) ? o.examples.map((x) => String(x).trim()).filter(Boolean).slice(0, 3) : [];
      return { en: String(o.en || "").trim(), zh: String(o.zh || "").trim(), note: String(o.note || "").trim(), examples: ex };
    })
    .filter((g) => g.en && g.zh);

  // 视频剖析：行号 → 时间戳；越界/倒挂的段丢弃，title 为空的段丢弃
  const segs = t.segments;
  const timeline: TimelineSeg[] = (Array.isArray(data.timeline) ? data.timeline : [])
    .map((x) => {
      const o = (x || {}) as Record<string, unknown>;
      const from = Math.max(0, Math.min(segs.length - 1, Math.trunc(Number(o.from ?? 0))));
      const rawTo = Number.isFinite(Number(o.to)) ? Math.trunc(Number(o.to)) : from;
      const to = Math.max(from, Math.min(segs.length - 1, rawTo));
      return {
        start: segs[from]?.start ?? 0,
        end: segs[to]?.end ?? 0,
        title: String(o.title || "").trim(),
        summary: String(o.summary || "").trim(),
      };
    })
    .filter((s) => s.title)
    .sort((a, b) => a.start - b.start);

  updateTask(taskId, { summary, glossary, timeline, status: "ready", progress: 92, message: "双语字幕与课堂笔记已生成" });
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
  if (t.summary && (t.summary.points.length || t.summary.emphasis.length)) {
    L.push("## 本节课要点");
    for (const p of t.summary.points) L.push(`- ${p}`);
    L.push("");
    if (t.summary.emphasis.length) {
      L.push("## ⚠️ 教授强调 / 疑似考点");
      for (const p of t.summary.emphasis) L.push(`- ${p}`);
      L.push("");
    }
  }
  if (t.glossary?.length) {
    L.push("## 📖 专业词表");
    for (const g of t.glossary) {
      L.push(`### ${g.en} ｜ ${g.zh}`);
      if (g.note) L.push(`${g.note}`);
      L.push("");
      for (const e of g.examples || []) L.push(`- ${e}`);
      L.push("");
    }
  }
  return L.join("\n");
}

function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
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
  ] as const) {
    for (const item of items) blocks.push({ label, text: item });
  }
  for (const g of t.glossary || []) blocks.push({ label: "专业词表", text: `${g.en} ${g.zh} ${g.note || ""} ${(g.examples || []).join(" ")}` });
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

/**
 * 重跑字幕：用当前最新的断句/翻译规则重新转写+翻译（音轨已抽取则跳过 ffmpeg）。
 * AI 笔记与词表不受影响；旧烧录视频失效，需重新烧录。
 */
export async function reprocessSubtitles(taskId: string) {
  const t = getTask(taskId);
  if (!t) throw new Error("task not found");
  if (["queued", "extracting", "transcribing", "translating", "analyzing", "burning"].includes(t.status)) {
    throw new Error("任务正在处理中，请稍后再试");
  }
  try {
    if (!t.audioFile || !fs.existsSync(t.audioFile)) await extractAudio(taskId);
    await transcribe(taskId);
    await translate(taskId);
    updateTask(taskId, {
      status: "ready",
      progress: 92,
      srtFile: undefined,
      burnedFile: undefined,
      message: "双语字幕已按新规则重新生成",
    });
  } catch (e) {
    updateTask(taskId, { status: "error", error: e instanceof Error ? e.message : String(e), message: "重跑字幕失败" });
  }
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
