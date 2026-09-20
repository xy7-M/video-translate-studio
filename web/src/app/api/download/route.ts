import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
// 安装包在磁盘上随时可能替换，绝不能在 next build 时预渲染本路由——
// 否则 Next 会把当时的安装包（1.2GB）整个缓存成 download.body 打进安装包，
// 既让产物虚胖 1.2GB，又会撑爆 32 位 makensis 的 mmap 导致打包失败。
export const dynamic = "force-dynamic";

/** 安装包候选目录（按优先级），可用环境变量 SETUP_DIR 覆盖首位 */
const CANDIDATE_DIRS = [
  process.env.SETUP_DIR || "",
  "D:\\Item AI\\Claude Code\\视频快译安装包",
  "D:\\vts-build",
  path.join(process.cwd(), "..", "desktop", "dist"),
].filter(Boolean);

/** 只认 electron-builder 产物命名，防目录穿越 */
const EXE_RE = /^VideoTranslate-Setup-[\d.]+\.exe$/;

/** 健康安装包最小体积（NSIS + Electron + Python + faster-whisper 模型 ≈ 1.2GB，留 50MB 下限） */
const MIN_HEALTHY_BYTES = 50 * 1024 * 1024;

function cmpVersion(a: string, b: string) {
  const va = a.match(/[\d.]+/)![0].split(".").map(Number);
  const vb = b.match(/[\d.]+/)![0].split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((va[i] ?? 0) !== (vb[i] ?? 0)) return (vb[i] ?? 0) - (va[i] ?? 0);
  return 0;
}

/** 在 dir（及其一级子目录，electron-builder 按版本分目录）中找版本号最高的健康安装包 */
function findLatestSetup(): string | null {
  const found: string[] = [];
  for (const dir of CANDIDATE_DIRS) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isFile() && EXE_RE.test(e.name)) found.push(full);
        else if (e.isDirectory() && /^[\d.]+$/.test(e.name)) {
          // 版本子目录：dist/0.1.2/VideoTranslate-Setup-0.1.2.exe
          for (const f of fs.readdirSync(full)) {
            if (EXE_RE.test(f)) found.push(path.join(full, f));
          }
        }
      }
    } catch {
      /* 目录不存在则跳过 */
    }
  }
  if (!found.length) return null;
  // 过滤掉损坏的安装包（断电/OneDrive 同步未完成等导致 < 50MB）
  const healthy = found.filter((p) => {
    try {
      return fs.statSync(p).size >= MIN_HEALTHY_BYTES;
    } catch {
      return false;
    }
  });
  if (!healthy.length) return null;
  healthy.sort((a, b) => cmpVersion(path.basename(a), path.basename(b)));
  return healthy[0];
}

export async function GET() {
  const file = findLatestSetup();
  if (!file || !fs.existsSync(file)) {
    return NextResponse.json(
      { error: "未找到安装包。请在打包机上将 SETUP_DIR 指向安装包目录，或先运行 desktop\\一键打包.bat。" },
      { status: 404 },
    );
  }

  const name = path.basename(file);
  const size = fs.statSync(file).size;
  const stream = fs.createReadStream(file);

  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Accept-Ranges": "none",
      "Cache-Control": "no-store",
    },
  });
}
