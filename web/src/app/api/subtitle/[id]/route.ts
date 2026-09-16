import { NextResponse } from "next/server";
import { getTask, buildSrt } from "@/lib/pipeline";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const t = getTask(params.id);
  if (!t || !t.segments) return NextResponse.json({ error: "字幕尚未生成" }, { status: 404 });

  const safe = (t.title || t.id).replace(/[\\/:*?"<>|]/g, "_");
  // 中文标题必须用 RFC 5987 编码，否则 Node 写 header 时会抛 ByteString 错误
  const disp = (name: string) =>
    `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

  return new NextResponse("\ufeff" + buildSrt(t.segments), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": disp(`subtitle-${safe}.srt`),
    },
  });
}
