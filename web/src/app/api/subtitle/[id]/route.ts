import { NextResponse } from "next/server";
import { getTask, buildSrt } from "@/lib/pipeline";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const t = getTask(params.id);
  if (!t || !t.segments) return NextResponse.json({ error: "字幕尚未生成" }, { status: 404 });

  return new NextResponse("\ufeff" + buildSrt(t.segments), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="subtitle-${t.id}.srt"`,
    },
  });
}
