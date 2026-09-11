import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { UPLOAD_DIR, newTask, runPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("video");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "未收到视频文件" }, { status: 400 });
  }
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED.has(ext)) {
    return NextResponse.json({ error: `不支持的格式 ${ext}` }, { status: 400 });
  }
  if (file.size > 500 * 1024 * 1024) {
    return NextResponse.json({ error: "文件超过 500MB" }, { status: 400 });
  }

  const task = newTask("");
  const dest = path.join(UPLOAD_DIR, `${task.id}${ext}`);
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(dest, buf);
  task.videoFile = dest;

  // fire-and-forget：后台跑管线，前端轮询状态
  void runPipeline(task.id);
  return NextResponse.json({ taskId: task.id });
}
