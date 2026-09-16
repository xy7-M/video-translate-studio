import { NextResponse } from "next/server";
import { getTask, buildSrt, buildTxt } from "@/lib/pipeline";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const t = getTask(params.id);
  if (!t || !t.segments) return NextResponse.json({ error: "字幕尚未生成" }, { status: 404 });

  const safe = (t.title || t.id).replace(/[\\/:*?"<>|]/g, "_");
  // 中文标题必须用 RFC 5987 编码，否则 Node 写 header 时会抛 ByteString 错误
  const disp = (name: string) =>
    `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

  // ?fmt=txt 导出纯文本双语对照，记事本/WPS 可直接打开；默认仍是 SRT
  const fmt = new URL(req.url).searchParams.get("fmt");
  const isTxt = fmt === "txt";
  const body = isTxt ? buildTxt(t.title || safe, t.segments) : buildSrt(t.segments);

  return new NextResponse("\ufeff" + body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": disp(`subtitle-${safe}.${isTxt ? "txt" : "srt"}`),
    },
  });
}
