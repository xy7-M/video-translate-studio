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
  if (body.segments.length > 5000) {
    return NextResponse.json({ error: "字幕条数超过上限（5000 条）" }, { status: 400 });
  }
  // 逐条校验：客户端可能传入任意 JSON（含 Infinity / 嵌套对象），直接落盘会污染任务文件
  const clean: Segment[] = [];
  for (const raw of body.segments) {
    const s = (raw || {}) as Record<string, unknown>;
    const start = Number(s.start);
    const end = Number(s.end);
    const text = typeof s.text === "string" ? s.text : null;
    const zh = typeof s.zh === "string" ? s.zh : "";
    if (
      !Number.isFinite(start) || !Number.isFinite(end) ||
      start < 0 || end < start ||
      text === null || text.length > 5000 || zh.length > 5000
    ) {
      return NextResponse.json({ error: "字幕数据格式错误" }, { status: 400 });
    }
    clean.push({ start, end, text, zh: zh || undefined });
  }
  updateTask(params.id, { segments: clean, srtFile: undefined, burnedFile: undefined }); // 使旧 SRT/烧录视频失效
  return NextResponse.json({ ok: true });
}
