import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

/** 安装包候选目录（按优先级），可用环境变量 SETUP_DIR 覆盖首位 */
const CANDIDATE_DIRS = [
  process.env.SETUP_DIR || "",
  "D:\\Item AI\\Claude Code\\视频快译安装包",
  "D:\\vts-build",
  path.join(process.cwd(), "..", "desktop", "dist"),
].filter(Boolean);

/** 只认 electron-builder 产物命名，防目录穿越 */
const EXE_RE = /^VideoTranslate-Setup-[\d.]+\.exe$/;

function cmpVersion(a: string, b: string) {
  const va = a.match(/[\d.]+/)![0].split(".").map(Number);
  const vb = b.match(/[\d.]+/)![0].split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((va[i] ?? 0) !== (vb[i] ?? 0)) return (vb[i] ?? 0) - (va[i] ?? 0);
  return 0;
}

/** 在 dir（及其一级子目录，electron-builder 按版本分目录）中找版本号最高的安装包 */
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
  found.sort((a, b) => cmpVersion(path.basename(a), path.basename(b)));
  return found[0];
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
