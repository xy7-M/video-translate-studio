import { NextResponse } from "next/server";
import { burnSubtitles, getTask, updateTask } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const t = getTask(params.id);
  if (!t) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (t.status !== "ready" && t.status !== "done") {
    return NextResponse.json({ error: "当前状态不可烧录" }, { status: 409 });
  }
  const body = await req.json().catch(() => ({}));
  const style: "classic" | "fancy" = body?.style === "fancy" ? "fancy" : "classic";

  void burnSubtitles(t.id, style).catch((e) =>
    updateTask(t.id, {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      message: "烧录失败",
    })
  );
  return NextResponse.json({ ok: true, style });
}
