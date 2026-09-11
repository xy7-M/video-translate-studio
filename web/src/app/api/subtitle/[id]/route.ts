import { NextResponse } from "next/server";
import { getTask, buildSrt, buildVtt, buildAss } from "@/lib/pipeline";

export const runtime = "nodejs";

const FORMATS: Record<string, { ext: string; mime: string; label: string }> = {
  srt: { ext: "srt", mime: "text/plain; charset=utf-8", label: "双语 SRT" },
  vtt: { ext: "vtt", mime: "text/vtt; charset=utf-8", label: "双语 VTT" },
  ass: { ext: "ass", mime: "text/plain; charset=utf-8", label: "双语 ASS 经典" },
  assfancy: { ext: "ass", mime: "text/plain; charset=utf-8", label: "双语 ASS 花字" },
};

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const t = getTask(params.id);
  if (!t || !t.segments) return NextResponse.json({ error: "字幕尚未生成" }, { status: 404 });

  const fmt = new URL(req.url).searchParams.get("fmt") || "srt";
  const meta = FORMATS[fmt];
  if (!meta) return NextResponse.json({ error: `不支持的格式 ${fmt}` }, { status: 400 });

  let body: string;
  if (fmt === "srt") body = "\ufeff" + buildSrt(t.segments);
  else if (fmt === "vtt") body = buildVtt(t.segments);
  else body = buildAss(t.segments, fmt === "assfancy");

  return new NextResponse(body, {
    headers: {
      "Content-Type": meta.mime,
      "Content-Disposition": `attachment; filename="subtitle-${t.id}.${meta.ext}"`,
    },
  });
}
