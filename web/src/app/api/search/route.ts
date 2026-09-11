import { NextResponse } from "next/server";
import { searchAll } from "@/lib/pipeline";

export const runtime = "nodejs";

/** 全文搜索：q=关键词，命中跨所有已转写视频，定位到句级时间戳 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") || "";
  if (!q.trim()) return NextResponse.json({ hits: [] });
  return NextResponse.json({ hits: searchAll(q) });
}
