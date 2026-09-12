import { NextResponse } from "next/server";
import { deleteTask } from "@/lib/pipeline";

export const runtime = "nodejs";

/** 删除任务及其全部磁盘产物 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!deleteTask(params.id)) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
