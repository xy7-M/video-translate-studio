import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getTask } from "@/lib/pipeline";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string; kind: string } }) {
  const t = getTask(params.id);
  if (!t) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const file = params.kind === "burned" ? t.burnedFile : t.videoFile;
  if (!file || !fs.existsSync(file)) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  const stat = fs.statSync(file);
  // 烧录版恒为 mp4；原视频按真实扩展名给 MIME，否则 mov/mkv/webm 预览失败
  const MIME: Record<string, string> = {
    ".mp4": "video/mp4",
    ".m4v": "video/x-m4v",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
  };
  const type = params.kind === "burned" ? "video/mp4" : MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  const range = req.headers.get("range");
  // ?dl=1 时作为附件下载（用中文标题命名），否则供 <video> 预览
  const url = new URL(req.url);
  const dl = url.searchParams.has("dl");
  const safe = (t.title || t.id).replace(/[\\/:*?"<>|]/g, "_");
  const disposition = `attachment; filename="video.mp4"; filename*=UTF-8''${encodeURIComponent(`subtitle-${safe}-烧录版.mp4`)}`;
  const extraHeaders: Record<string, string> = dl ? { "Content-Disposition": disposition } : {};

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const rawStart = m && m[1] ? Number(m[1]) : 0;
    const rawEnd = m && m[2] ? Number(m[2]) : NaN;
    // 非法 Range（如 bytes=abc-）必须回 416，否则 NaN 透传给 Buffer.alloc 会抛异常 → 500
    if (!m || !Number.isFinite(rawStart) || (m[2] !== "" && !Number.isFinite(rawEnd))) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}`, "Accept-Ranges": "bytes" },
      });
    }
    const start = Math.max(0, Math.floor(rawStart));
    // 浏览器（尤其 Chrome 视频流）常发 open-ended range（bytes=N-），
    // 必须封顶到文件末尾，否则 end=NaN → 分配巨型 Buffer → 下载损坏/进程卡死
    const end = Number.isFinite(rawEnd)
      ? Math.min(Math.floor(rawEnd), stat.size - 1)
      : Math.min(start + 8 * 1024 * 1024, stat.size - 1);
    if (start >= stat.size || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}`, "Accept-Ranges": "bytes" },
      });
    }
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

  // 无 Range：流式返回，避免 readFileSync 把最大 2GB 的视频整个读进内存导致 OOM
  const stream = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      ...extraHeaders,
    },
  });
}
