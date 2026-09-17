import { NextResponse } from "next/server";
import { findCourseVariant, findTitleTaken, listTasks, updateTask } from "@/lib/pipeline";

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

/** 修改任务所属课程（频道归类）和/或自定义名称 */
export async function POST(req: Request) {
  const body = (await req.json()) as { id?: string; course?: string; title?: string };
  if (!body.id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  const MAX_LEN = 200;

  const patch: { course?: string; title?: string } = {};
  if (typeof body.course === "string") {
    if (body.course.length > MAX_LEN) return NextResponse.json({ error: "课程名过长（最多 200 字）" }, { status: 400 });
    const course = body.course.trim();
    // 课程名不可重复：与既有频道只差大小写/空格时拒绝，提示直接复用已有名
    const variant = findCourseVariant(course, body.id);
    if (variant) {
      return NextResponse.json(
        { error: `课程「${variant}」已存在，请直接使用「${variant}」，不要重复命名` },
        { status: 409 }
      );
    }
    patch.course = course || undefined;
  }
  if (typeof body.title === "string") {
    if (body.title.length > MAX_LEN) return NextResponse.json({ error: "标题过长（最多 200 字）" }, { status: 400 });
    const title = body.title.trim();
    // 视频标题不可完全相同：与其他任务的标题重复（忽略大小写/首尾空格）时拒绝
    const taken = findTitleTaken(title, body.id);
    if (taken) {
      return NextResponse.json({ error: `已有视频叫「${taken}」，请换一个名字` }, { status: 409 });
    }
    patch.title = title || undefined;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "缺少修改内容" }, { status: 400 });

  const t = updateTask(body.id, patch);
  if (!t) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  return NextResponse.json({ ok: true, course: t.course, title: t.title });
}
