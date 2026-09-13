import { NextResponse } from "next/server";
import { clearHistory, listHistory } from "@/lib/pipeline";

export const runtime = "nodejs";

/** 历史记录库：搜索词 + AI 问答对 */
export async function GET() {
  return NextResponse.json(listHistory());
}

/** 清空历史：kind = search | chat | all */
export async function DELETE(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind") || "all";
  if (!["search", "chat", "all"].includes(kind)) {
    return NextResponse.json({ error: "kind 只能是 search / chat / all" }, { status: 400 });
  }
  clearHistory(kind as "search" | "chat" | "all");
  return NextResponse.json({ ok: true });
}
