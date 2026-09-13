import { NextResponse } from "next/server";
import { addSearchHistory, searchAll } from "@/lib/pipeline";

export const runtime = "nodejs";

/** 全文搜索：q=关键词，命中跨所有已转写视频，定位到句级时间戳 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") || "";
  if (!q.trim()) return NextResponse.json({ hits: [] });
  const hits = searchAll(q);
  addSearchHistory(q, hits.length); // 写入搜索历史库
  return NextResponse.json({ hits });
}
