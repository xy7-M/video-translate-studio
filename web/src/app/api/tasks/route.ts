import { NextResponse } from "next/server";
import { listTasks, updateTask } from "@/lib/pipeline";

export const runtime = "nodejs";

/** 任务库：按课程频道（Channels）归档的全部历史视频 */
export async function GET() {
  const tasks = listTasks()
    .filter((t) => t.segments?.length)
    .map((t) => ({
      id: t.id,
      title: t.title,
      course: t.course || "",
      status: t.status,
      createdAt: t.createdAt,
      segCount: t.segments?.length || 0,
      hasBurned: !!t.burnedFile,
      points: t.summary?.points?.length || 0,
    }));
  return NextResponse.json({ tasks });
}

/** 修改任务所属课程（频道归类） */
export async function POST(req: Request) {
  const body = (await req.json()) as { id?: string; course?: string };
  if (!body.id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  const t = updateTask(body.id, { course: (body.course || "").trim() || undefined });
  if (!t) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  return NextResponse.json({ ok: true, course: t.course });
}
