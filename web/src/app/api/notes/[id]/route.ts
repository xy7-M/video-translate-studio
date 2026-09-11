import { NextResponse } from "next/server";
import { buildNotesHtml, buildNotesMarkdown, getTask } from "@/lib/pipeline";

export const runtime = "nodejs";

/** 复习笔记导出（借鉴 Notta Document Builder）：?fmt=md | html */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const t = getTask(params.id);
  if (!t || !t.segments) return NextResponse.json({ error: "笔记尚未生成" }, { status: 404 });

  const fmt = new URL(req.url).searchParams.get("fmt") || "md";
  const safe = (t.title || t.id).replace(/[\\/:*?"<>|]/g, "_");
  if (fmt === "html") {
    return new NextResponse(buildNotesHtml(t.id), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="notes-${safe}.html"`,
      },
    });
  }
  return new NextResponse("\ufeff" + buildNotesMarkdown(t.id), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="notes-${safe}.md"`,
    },
  });
}
