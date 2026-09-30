import type { Metadata } from "next";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Check,
  Clapperboard,
  Cpu,
  Download,
  FileText,
  HardDrive,
  Lock,
  MemoryStick,
  MonitorSmartphone,
  MousePointerClick,
  ScanSearch,
  Sparkles,
  Subtitles,
  Timer,
  Upload,
  Wand2,
  Zap,
} from "lucide-react";

export const metadata: Metadata = {
  title: "视频快译 · 介绍与下载",
  description:
    "英文课堂视频 → 中英双语字幕 · AI 课堂笔记 · 复习词表。本地优先，视频不出你的电脑。",
};

/** 墨线细描边图标：与手账风 1.5px 描边同语言 */
const ic = { size: 18, strokeWidth: 1.75, className: "shrink-0" } as const;

const PAINS = [
  {
    icon: <Subtitles {...ic} />,
    title: "英文网课听不懂，字幕全靠猜",
    text: "教授口音重、语速快，暂停反复拖进度条，一小时的视频要看起来三个小时。",
  },
  {
    icon: <FileText {...ic} />,
    title: "手敲字幕笔记，时间全耗在抄写上",
    text: "边看边记，记下来的永远是上一句。考完试翻笔记，发现自己只是在练打字。",
  },
  {
    icon: <ScanSearch {...ic} />,
    title: "学过的课，考前一句都搜不到",
    text: "视频散落在各个网盘文件夹，「教授当时怎么说的来着？」——想不起来，也找不到。",
  },
  {
    icon: <Lock {...ic} />,
    title: "付费课程不敢传云端工具",
    text: "把课程视频交给别人的服务器转写，既担心版权，又担心资料泄露。",
  },
];

const HIGHLIGHTS = [
  {
    icon: <Wand2 {...ic} />,
    title: "全自动五步流水线",
    text: "拖入视频就完事：抽取音轨 → 英文转写 → 中文翻译 → AI 课堂笔记 → 双语字幕，进度条实时可见。",
    tag: "省心",
  },
  {
    icon: <Zap {...ic} />,
    title: "GPU 加速，字幕烧进画面",
    text: "有 NVIDIA 显卡就走 NVENC 硬编码，10 分钟课堂约 2-4 分钟跑完；双语字幕直接烧录进 mp4，离线也能看。",
    tag: "快",
  },
  {
    icon: <BrainCircuit {...ic} />,
    title: "AI 课堂笔记 + 复习词表",
    text: "自动提炼要点、考点和专业词汇表，一键导出 Word 对照稿与 Markdown 复习笔记，直接打印带走。",
    tag: "会总结",
  },
  {
    icon: <ScanSearch {...ic} />,
    title: "课程库：全文搜索 + AI 问答",
    text: "所有学过的课按频道归档。搜一个词直达那句话的时间点；像问学霸一样提问，回答附来源与时间戳。",
    tag: "能复习",
  },
  {
    icon: <Lock {...ic} />,
    title: "本地优先，隐私第一",
    text: "视频与转写全在你自己电脑里完成，不上传任何平台；密钥只存服务端，本机零暴露。",
    tag: "安全",
  },
  {
    icon: <MousePointerClick {...ic} />,
    title: "为学习体验抠过的细节",
    text: "方向键快进退、按住三倍速、空格暂停；视频标题点着就能改，导出文件名自动跟着变。",
    tag: "顺手",
  },
];

const FLOW = [
  {
    step: "1",
    icon: <Upload {...ic} />,
    title: "丢视频进去",
    text: "拖拽或点选，支持 MP4 / MOV / MKV / WebM，2 小时以内。",
  },
  {
    step: "2",
    icon: <Timer {...ic} />,
    title: "等它跑完",
    text: "转写、翻译、笔记、字幕全自动。第一次会下载语音模型，之后就快了。",
  },
  {
    step: "3",
    icon: <Download {...ic} />,
    title: "拿走你需要的",
    text: "双语烧录视频、Word 字幕对照稿、一页纸复习笔记，全进课程库归档。",
  },
];

const REQS = [
  {
    icon: <MonitorSmartphone {...ic} />,
    k: "系统",
    v: "Windows 10 / 11（64 位）",
  },
  {
    icon: <MemoryStick {...ic} />,
    k: "内存",
    v: "≥ 8 GB RAM（转写模型约占 2 GB）",
  },
  {
    icon: <Cpu {...ic} />,
    k: "显卡",
    v: "NVIDIA RTX 系列可选——有则 GPU 加速，没有则 CPU 也能跑",
  },
  {
    icon: <HardDrive {...ic} />,
    k: "磁盘",
    v: "约 3 GB 安装空间（内置 Python / ffmpeg / Node，免装任何环境）",
  },
  {
    icon: <Clapperboard {...ic} />,
    k: "视频",
    v: "单个文件 ≤ 2 小时，MP4 / MOV / MKV / WebM",
  },
  {
    icon: <BookOpen {...ic} />,
    k: "AI 功能",
    v: "使用你自己的 DeepSeek API Key 完成翻译与笔记（按量走你的账户额度，建议设消费上限 100 元）",
  },
];

export default function IntroPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 pb-24 pt-10 sm:px-8">
      {/* ── 顶栏 ── */}
      <header className="mb-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="badge-note grid h-9 w-9 place-items-center">
            <Subtitles size={17} strokeWidth={1.75} />
          </span>
          <span className="text-2xl font-bold">
            视频快译 <span className="text-[var(--muted)] text-base font-normal">VideoTranslate</span>
          </span>
        </div>
        <a href="/" className="btn-ghost !py-1.5 !px-4 text-sm">
          打开工作台 <ArrowRight size={14} strokeWidth={1.75} />
        </a>
      </header>

      {/* ── Hero ── */}
      <section className="panel glow-border relative mb-16 overflow-hidden px-8 py-12 text-center sm:px-14 sm:py-16">
        <span className="badge-note absolute left-6 top-6 px-3 py-0.5 text-sm">
          v0.1.3 · Windows
        </span>
        <span className="badge-note absolute right-6 top-6 px-3 py-0.5 text-sm" style={{ background: "var(--note)" }}>
          本地优先
        </span>

        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
          英文课堂视频，
          <br className="sm:hidden" />
          一键变成<span className="text-[var(--accent)]">双语字幕 + 课堂笔记</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-[var(--muted)]" style={{ fontSize: 17 }}>
          拖进去，等着就好。转写、翻译、笔记、烧录全自动——
          视频只在你自己的电脑里处理，不上传任何平台。
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a href="/api/download" className="btn-hero" download>
            <Download {...ic} /> 下载 Windows 安装包
          </a>
          <span className="text-sm text-[var(--muted)]">
            约 1.3 GB · 内置全部运行环境 · 免安装 Python / Node / ffmpeg
          </span>
        </div>
      </section>

      {/* ── 痛点 ── */}
      <section className="mb-16">
        <h2 className="mb-2 text-3xl font-bold">
          你是不是也<span className="text-[var(--accent)]">被这些折磨过</span>？
        </h2>
        <p className="mb-8 text-[var(--muted)]">视频快译就是为这四件事写的。</p>
        <div className="grid gap-6 sm:grid-cols-2">
          {PAINS.map((p) => (
            <div key={p.title} className="panel flex gap-4 px-6 py-5">
              <span className="badge-note grid h-10 w-10 shrink-0 place-items-center rounded-xl !bg-[var(--panel)]">
                <span className="text-[var(--err)]">{p.icon}</span>
              </span>
              <div>
                <h3 className="font-bold leading-snug">{p.title}</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">{p.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 亮点 ── */}
      <section className="mb-16">
        <h2 className="mb-2 text-3xl font-bold">软件亮点</h2>
        <p className="mb-8 text-[var(--muted)]">每一块都是从自己熬夜上网课的日子里长出来的。</p>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {HIGHLIGHTS.map((h) => (
            <div key={h.title} className="panel px-6 py-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="badge-note grid h-10 w-10 place-items-center rounded-xl !bg-[#fdf3d9]">
                  <span className="text-[var(--accent)]">{h.icon}</span>
                </span>
                <span className="badge-note px-2.5 py-0.5 text-xs">{h.tag}</span>
              </div>
              <h3 className="font-bold leading-snug">{h.title}</h3>
              <p className="mt-1.5 text-sm text-[var(--muted)]">{h.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 使用流程 ── */}
      <section className="mb-16">
        <h2 className="mb-2 text-3xl font-bold">使用流程</h2>
        <p className="mb-8 text-[var(--muted)]">
          三步用完：<span className="font-bold text-[var(--text)]">传视频 → 等进度 → 拿笔记</span>。
        </p>
        <div className="grid gap-6 sm:grid-cols-3">
          {FLOW.map((f, i) => (
            <div key={f.step} className="panel relative px-6 py-6">
              <span className="badge-note absolute -top-3.5 left-6 grid h-8 w-8 place-items-center rounded-full font-bold">
                {f.step}
              </span>
              <div className="mb-2 flex items-center gap-2 text-[var(--accent)]">
                {f.icon}
                <h3 className="font-bold text-[var(--text)]">{f.title}</h3>
              </div>
              <p className="text-sm text-[var(--muted)]">{f.text}</p>
              {i < FLOW.length - 1 && (
                <ArrowRight
                  className="absolute -right-5 top-1/2 z-10 hidden -translate-y-1/2 text-[var(--muted)] sm:block"
                  size={20}
                  strokeWidth={1.75}
                />
              )}
            </div>
          ))}
        </div>
        <div className="panel dashed mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 px-6 py-4 text-sm text-[var(--muted)]">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles size={14} strokeWidth={1.75} className="text-[var(--accent-2)]" />
            自动流水线：抽取音轨 → 英文转写 → 中文翻译 → AI 课堂笔记 → 双语字幕
          </span>
          <span>10 分钟视频，GPU 约 2-4 分钟跑完</span>
        </div>
      </section>

      {/* ── 电脑要求 ── */}
      <section className="mb-16">
        <h2 className="mb-2 text-3xl font-bold">电脑要求</h2>
        <p className="mb-8 text-[var(--muted)]">
          普通学习本就能跑；有 RTX 显卡会更快。装之前对一眼就行。
        </p>
        <div className="panel overflow-hidden !rotate-0">
          <ul className="divide-y divide-[var(--hair)]">
            {REQS.map((r) => (
              <li key={r.k} className="flex items-start gap-4 px-6 py-4">
                <span className="mt-0.5 text-[var(--accent)]">{r.icon}</span>
                <span className="w-16 shrink-0 font-bold">{r.k}</span>
                <span className="text-[var(--muted)]">{r.v}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-4 flex items-center gap-2 text-sm text-[var(--muted)]">
          <AlertTriangle size={15} strokeWidth={1.75} className="text-[var(--warn)]" />
          提示：AI 翻译与笔记需要你自己的 DeepSeek API Key（注册后会引导填写）；转写与字幕烧录完全本地、免费。
        </p>
      </section>

      {/* ── 下载 CTA ── */}
      <section className="panel glow-border px-8 py-12 text-center">
        <Check className="mx-auto mb-3 text-[var(--ok)]" size={28} strokeWidth={1.75} />
        <h2 className="text-3xl font-bold">现在，把网课变成你的复习军火库</h2>
        <p className="mx-auto mt-3 max-w-md text-[var(--muted)]">
          下载安装包 → 双击安装 → 打开即用。所有环境已打包在内，不碰你的系统。
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a href="/api/download" className="btn-hero" download>
            <Download {...ic} /> 下载 VideoTranslate-Setup（Windows x64）
          </a>
        </div>
        <p className="mt-4 text-xs text-[var(--muted)]">
          v0.1.3 · 约 1.3 GB · 卸载时保留你的视频与笔记数据
        </p>
      </section>

      {/* ── 页脚 ── */}
      <footer className="mt-14 text-center text-sm text-[var(--muted)]">
        视频快译 · mengxiaoyao — 做给每一个在英文网课里挣扎的人。
      </footer>
    </main>
  );
}
