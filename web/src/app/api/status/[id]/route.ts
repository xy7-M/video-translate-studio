import { NextResponse } from "next/server";
import { getTask } from "@/lib/pipeline";
import { captureToken } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  captureToken(req); // 轮询即心跳：持续刷新后台管线所需的最新 token
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
    title: t.title,
    course: t.course,
    summary: t.summary,
    glossary: t.glossary,
    timeline: t.timeline,
  });
}
