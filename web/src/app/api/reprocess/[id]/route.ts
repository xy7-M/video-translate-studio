import { NextResponse } from "next/server";
import { getTask, reprocessSubtitles } from "@/lib/pipeline";
import { captureToken } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 3600;

/** 重跑字幕：用最新断句 + 逐句翻译规则重新生成双语字幕 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  captureToken(req); // 暂存登录 token，供后台重跑的 AI 阶段使用
  const t = getTask(params.id);
  if (!t) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (!t.videoFile) return NextResponse.json({ error: "原始视频已丢失，无法重跑" }, { status: 409 });

  void reprocessSubtitles(t.id); // fire-and-forget，前端轮询 /api/status
  return NextResponse.json({ ok: true });
}
