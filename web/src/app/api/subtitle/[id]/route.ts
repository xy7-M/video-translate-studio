import { NextResponse } from "next/server";
import { getTask, buildSrt, buildSubtitleHtml, htmlToPdf } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const t = getTask(params.id);
  if (!t || !t.segments) return NextResponse.json({ error: "字幕尚未生成" }, { status: 404 });

  const fmt = new URL(req.url).searchParams.get("fmt") || "srt";
  const safe = (t.title || t.id).replace(/[\\/:*?"<>|]/g, "_");

  if (fmt === "pdf") {
    try {
      const buf = await htmlToPdf(buildSubtitleHtml(params.id), params.id);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="subtitle-${safe}.pdf"`,
        },
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  if (fmt === "html") {
    return new NextResponse(buildSubtitleHtml(params.id), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new NextResponse("\ufeff" + buildSrt(t.segments), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="subtitle-${safe}.srt"`,
    },
  });
}
