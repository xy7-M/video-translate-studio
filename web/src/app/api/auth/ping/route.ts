import { NextResponse } from "next/server";
import { captureToken } from "@/lib/session";

export const runtime = "nodejs";

/** 心跳：前端定期上报最新 access token，供后台 AI 管线（转写→翻译）调用 Edge Function 时使用 */
export async function POST(req: Request) {
  captureToken(req);
  return NextResponse.json({ ok: true });
}
