import { NextResponse } from "next/server";
import { getTask } from "@/lib/pipeline";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const t = getTask(params.id);
  if (!t) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  return NextResponse.json({
    id: t.id,
    status: t.status,
    progress: t.progress,
    message: t.message,
    error: t.error,
    encoder: t.encoder,
    segments: t.segments,
    hasVideo: !!t.burnedFile,
  });
}
