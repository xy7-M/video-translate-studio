import { NextResponse } from "next/server";
import { buildNotesMarkdown, getTask } from "@/lib/pipeline";

export const runtime = "nodejs";

/** 复习笔记导出：Markdown */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const t = getTask(params.id);
  if (!t || !t.segments) return NextResponse.json({ error: "笔记尚未生成" }, { status: 404 });

  const safe = (t.title || t.id).replace(/[\\/:*?"<>|]/g, "_");
  // 中文标题必须用 RFC 5987 编码，否则 Node 写 header 时会抛 ByteString 错误
  const disp = (name: string) =>
    `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

  return new NextResponse("\ufeff" + buildNotesMarkdown(t.id), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": disp(`notes-${safe}.md`),
    },
  });
}
