import { NextResponse } from "next/server";
import { getTask, updateTask } from "@/lib/pipeline";
import type { Segment } from "@/lib/pipeline";

export const runtime = "nodejs";

/** 保存前端人工修正后的双语字幕 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const t = getTask(params.id);
  if (!t) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const body = (await req.json()) as { segments?: Segment[] };
  if (!Array.isArray(body.segments)) return NextResponse.json({ error: "参数错误" }, { status: 400 });
  updateTask(params.id, { segments: body.segments, srtFile: undefined }); // 使旧 SRT 失效
  return NextResponse.json({ ok: true });
}
