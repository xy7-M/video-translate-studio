import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline as streamPipeline } from "stream/promises";
import { NextResponse } from "next/server";
import { UPLOAD_DIR, newTask, deleteTask, updateTask, runPipeline, probeDuration, MAX_DURATION_SEC, uniqueTitle } from "@/lib/pipeline";
import { hasOwnKey } from "@/lib/user-config";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB ≈ 2 小时 720p

export async function POST(req: Request) {
  // 严格 BYO-Key：未配置用户自有 Key 一律拦截，且放在收文件之前（免传 2GB 后才失败）
  if (!hasOwnKey()) {
    return NextResponse.json(
      { error: "请先填入你自己的 DeepSeek API Key（设置 → 导入自己 API）", needApiKey: true },
      { status: 400 },
    );
  }
  const form = await req.formData();
  const file = form.get("video");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "未收到视频文件" }, { status: 400 });
  }
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED.has(ext)) {
    return NextResponse.json({ error: `不支持的格式 ${ext}` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "文件超过 2GB（约等于 2 小时 720p）" }, { status: 400 });
  }

  const task = newTask("", uniqueTitle(path.basename(file.name, ext)));
  const dest = path.join(UPLOAD_DIR, `${task.id}${ext}`);

  // 流式写盘：大文件不占内存
  try {
    await streamPipeline(Readable.fromWeb(file.stream() as never), fs.createWriteStream(dest));
  } catch (e) {
    fs.rmSync(dest, { force: true });
    deleteTask(task.id);
    return NextResponse.json({ error: `保存失败：${e instanceof Error ? e.message : e}` }, { status: 500 });
  }
  updateTask(task.id, { videoFile: dest });

  // 时长校验：超过 2 小时直接拒绝并清理（前端收 400 不会轮询，task 记录也一并删除防僵尸任务）
  const dur = await probeDuration(dest);
  if (dur !== null && dur > MAX_DURATION_SEC) {
    fs.rmSync(dest, { force: true });
    deleteTask(task.id);
    return NextResponse.json({ error: `视频时长超过 2 小时上限（当前 ${Math.round(dur / 60)} 分钟）` }, { status: 400 });
  }

  // fire-and-forget：后台跑管线，前端轮询状态
  void runPipeline(task.id);
  return NextResponse.json({ taskId: task.id, duration: dur });
}
