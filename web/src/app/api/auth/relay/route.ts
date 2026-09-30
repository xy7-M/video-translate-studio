import { NextResponse } from "next/server";
import { setPendingSession, takePendingSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * 邮箱验证接力：
 *  POST —— 系统浏览器打开确认链接后，/confirm 页面把 Supabase 回传的 session 交给本地服务暂存
 *  GET  —— 桌面窗口轮询取回 session，写入自身 Supabase 客户端完成登录
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { session?: string };
  if (typeof body.session !== "string" || !body.session) {
    return NextResponse.json({ error: "缺少 session" }, { status: 400 });
  }
  try {
    JSON.parse(body.session); // 仅接受合法 JSON
  } catch {
    return NextResponse.json({ error: "session 格式错误" }, { status: 400 });
  }
  setPendingSession(body.session);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = takePendingSession();
  return NextResponse.json({ session });
}
