import fs from "fs";
import { NextResponse } from "next/server";
import { getTask } from "@/lib/pipeline";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string; kind: string } }) {
  const t = getTask(params.id);
  if (!t) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const file = params.kind === "burned" ? t.burnedFile : t.videoFile;
  if (!file || !fs.existsSync(file)) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  const stat = fs.statSync(file);
  const type = "video/mp4";
  const range = req.headers.get("range");
  // ?dl=1 时作为附件下载（用中文标题命名），否则供 <video> 预览
  const url = new URL(req.url);
  const dl = url.searchParams.has("dl");
  const safe = (t.title || t.id).replace(/[\\/:*?"<>|]/g, "_");
  const disposition = `attachment; filename="video.mp4"; filename*=UTF-8''${encodeURIComponent(`subtitle-${safe}-烧录版.mp4`)}`;
  const extraHeaders: Record<string, string> = dl ? { "Content-Disposition": disposition } : {};

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : Math.min(start + 8 * 1024 * 1024, stat.size - 1);
    const chunk = Buffer.alloc(end - start + 1);
    const fd = fs.openSync(file, "r");
    fs.readSync(fd, chunk, 0, chunk.length, start);
    fs.closeSync(fd);
    return new NextResponse(chunk, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunk.length),
        ...extraHeaders,
      },
    });
  }

  return new NextResponse(fs.readFileSync(file), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      ...extraHeaders,
    },
  });
}
